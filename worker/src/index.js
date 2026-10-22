// API do feed de notícias da Hooke: guarda as matérias no D1 (SQL da
// Cloudflare), serve as publicadas para o site e o painel /admin/news.html
// (rotas em admin.js). Quem gera as matérias (pesquisa + IA + imagem +
// tradução) é o news-pipeline, que roda na EC2 e conversa pelas rotas
// /api/ingest/* (token próprio). O KV ficou só para o pedido "gerar agora" e o
// resumo da última execução (uma chave cada, sem disputa).
import {
  SITE_URL, CORS_HEADERS, json, now, today, listItems, getItem, insertItem, patchItem, viewsMap, getSetting,
} from "./db.js";
import { handleAdmin } from "./admin.js";

// Token fixo do pipeline (secret INGEST_TOKEN). Comparação em tempo constante.
function requireIngest(request, env) {
  const given = new TextEncoder().encode((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
  const expected = new TextEncoder().encode(env.INGEST_TOKEN || "");
  if (!expected.length || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
  return diff === 0;
}

// ---------- Ingest (news-pipeline na EC2) ----------

const ITEM_FIELDS = [
  "id", "sector", "themeId", "title", "summary", "excerpt", "body", "link", "sourceName", "sources",
  "sourceDate", "verification", "image", "imageAlt", "imageGenerated", "imagePrompt", "imagePromptAlt", "createdAt",
];

function sanitizeItem(raw) {
  const item = {};
  for (const f of ITEM_FIELDS) if (raw[f] !== undefined) item[f] = raw[f];
  if (!item.id) item.id = crypto.randomUUID();
  if (!item.createdAt) item.createdAt = now();
  if (!Array.isArray(item.body)) item.body = item.body ? [String(item.body)] : [];
  return item;
}

const DAY = 24 * 3600 * 1000;
const retry = (failedAt) => !failedAt || Date.now() - Date.parse(failedAt) > DAY;

async function handleIngest(request, env, url) {
  if (!requireIngest(request, env)) return json({ error: "Não autorizado" }, 401);

  if (url.pathname === "/api/ingest/known" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT link FROM items WHERE link IS NOT NULL").all();
    return json({ links: results.map((r) => r.link) });
  }

  if (url.pathname === "/api/ingest/items" && request.method === "POST") {
    const { items } = await request.json().catch(() => ({}));
    if (!Array.isArray(items)) return json({ error: "items precisa ser uma lista" }, 400);
    const { results } = await env.DB.prepare("SELECT link FROM items WHERE link IS NOT NULL").all();
    const known = new Set(results.map((r) => r.link));
    const fresh = items.filter((it) => it && it.title && it.link && !known.has(it.link)).map(sanitizeItem);
    if (fresh.length) await env.DB.batch(fresh.map((it) => insertItem(env, "pending", it)));
    return json({ ok: true, added: fresh.length });
  }

  // Regras editoriais editadas no painel (o pipeline usa o arquivo local se vier vazio).
  if (url.pathname === "/api/ingest/rules" && request.method === "GET") {
    const s = await getSetting(env, "rules");
    return json({ text: s ? s.value : "", updatedAt: s ? s.updated_at : null });
  }

  // Editorias e temas de pauta (tela "Temas e fontes" do painel).
  if (url.pathname === "/api/ingest/themes" && request.method === "GET") {
    const [eds, ths] = await Promise.all([
      env.DB.prepare("SELECT name, max_per_run, active FROM editorias ORDER BY sort, name").all(),
      env.DB.prepare("SELECT id, editoria, kind, value, priority, active FROM themes").all(),
    ]);
    return json({
      editorias: eds.results.map((e) => ({ name: e.name, maxPerRun: e.max_per_run, active: !!e.active })),
      themes: ths.results.map((t) => ({ id: t.id, editoria: t.editoria, kind: t.kind, value: t.value, priority: !!t.priority, active: !!t.active })),
    });
  }

  // Consome o pedido feito pelo botão do painel (devolve e apaga).
  if (url.pathname === "/api/ingest/run-request" && request.method === "POST") {
    const requestedAt = await env.NEWS_KV.get("run-request");
    if (requestedAt) await env.NEWS_KV.delete("run-request");
    return json({ requested: Boolean(requestedAt), requestedAt });
  }

  // Pedidos de imagem e de tradução. Além dos pedidos marcados, toda notícia
  // PUBLICADA sem tradução (ou sem imagem própria) entra na fila: um pedido
  // perdido se corrige sozinho na rodada seguinte. Falhas voltam após 24 h.
  if (url.pathname === "/api/ingest/queue" && request.method === "GET") {
    const pending = await listItems(env, "pending");
    const published = await listItems(env, "published");
    const brief = (it) => ({
      id: it.id, sector: it.sector, title: it.title, excerpt: it.excerpt || it.summary,
      body: it.body, imageAlt: it.imageAlt, imagePrompt: it.imagePrompt, imagePromptAlt: it.imagePromptAlt,
    });
    const needsImage = (it) => it.imageStatus === "requested" ||
      (!it.imageGenerated && (it.imageStatus !== "failed" || retry(it.imageFailedAt)));
    const needsTranslation = (it) => it.translationStatus === "requested" ||
      (!it.translations && (it.translationStatus !== "failed" || retry(it.translationFailedAt)));
    return json({
      images: [...pending.filter((it) => it.imageStatus === "requested"), ...published.filter(needsImage)].map(brief),
      translations: published.filter(needsTranslation).map(brief),
    });
  }

  if (url.pathname === "/api/ingest/image" && request.method === "POST") {
    const { id, image, imageAlt, failed, error } = await request.json().catch(() => ({}));
    if (!(await getItem(env, id))) return json({ error: "Item não encontrado" }, 404);
    if (failed) {
      await patchItem(env, id, { imageStatus: "failed", imageError: error || "", imageFailedAt: now() }).run();
    } else {
      await patchItem(env, id,
        { image, imageAlt: imageAlt || undefined, imageGenerated: true, watermarked: true, imageStatus: "done" },
        ["imageError", "imageFailedAt"]).run();
    }
    return json({ ok: true });
  }

  if (url.pathname === "/api/ingest/translation" && request.method === "POST") {
    const { id, translations, failed, error } = await request.json().catch(() => ({}));
    if (!(await getItem(env, id))) return json({ error: "Item não encontrado" }, 404);
    if (failed) {
      await patchItem(env, id, { translationStatus: "failed", translationError: error || "", translationFailedAt: now() }).run();
    } else {
      await patchItem(env, id, { translations, translationStatus: "done" }, ["translationError", "translationFailedAt"]).run();
    }
    return json({ ok: true });
  }

  // Fontes com título/portal/autor (news-pipeline --enrich-sources).
  if (url.pathname === "/api/ingest/sources" && request.method === "POST") {
    const { id, sources } = await request.json().catch(() => ({}));
    if (!Array.isArray(sources) || !(await getItem(env, id))) return json({ error: "Item não encontrado" }, 404);
    await patchItem(env, id, { sources }).run();
    return json({ ok: true });
  }

  // Todas as notícias (para manutenções do pipeline, ex.: --enrich-sources).
  if (url.pathname === "/api/ingest/all" && request.method === "GET") {
    return json({ pending: await listItems(env, "pending"), published: await listItems(env, "published") });
  }

  // Imagens por IA geradas antes da marca d'água (news-pipeline --watermark-existing).
  if (url.pathname === "/api/ingest/unwatermarked" && request.method === "GET") {
    const all = [...(await listItems(env, "pending")), ...(await listItems(env, "published"))];
    return json({
      items: all
        .filter((it) => it.imageGenerated && !it.watermarked && /^\/img\/noticias\//.test(it.image || ""))
        .map((it) => ({ id: it.id, title: it.title, image: it.image })),
    });
  }

  if (url.pathname === "/api/ingest/report" && request.method === "POST") {
    const report = await request.json().catch(() => null);
    if (!report) return json({ error: "JSON inválido" }, 400);
    await env.NEWS_KV.put("last-run", JSON.stringify(report));
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

// ---------- Página de compartilhamento ----------
// noticia.html é estática e monta a matéria via JS, então WhatsApp/LinkedIn/
// Facebook não veem título nem imagem. O botão de compartilhar usa este link:
// ele devolve as tags de prévia (Open Graph) e redireciona para o site.

function escapeAttr(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function handleShare(env, id) {
  const found = await getItem(env, id);
  const item = found && found.status === "published" ? found.item : null;
  const target = item ? `${SITE_URL}/noticia.html?id=${encodeURIComponent(id)}` : `${SITE_URL}/news.html`;
  if (!item) return Response.redirect(target, 302);

  const image = /^https?:\/\//.test(item.image || "") ? item.image : SITE_URL + (item.image || "/img/atuacao.jpg");
  const description = String(item.excerpt || item.summary || "").replace(/\*\*/g, "");
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<title>${escapeAttr(item.title)} — Hooke Notícias</title>
<meta name="description" content="${escapeAttr(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Hooke Soluções em Engenharia">
<meta property="og:title" content="${escapeAttr(item.title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${escapeAttr(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta property="og:url" content="${escapeAttr(target)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${escapeAttr(target)}">
<meta http-equiv="refresh" content="0; url=${escapeAttr(target)}">
</head><body>
<script>location.replace(${JSON.stringify(target)});</script>
<p><a href="${escapeAttr(target)}">${escapeAttr(item.title)}</a></p>
</body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

// ---------- HTTP routes ----------

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (url.pathname.startsWith("/api/ingest/")) return handleIngest(request, env, url);
  if (url.pathname.startsWith("/api/admin/")) return handleAdmin(request, env, url);

  if (url.pathname.startsWith("/share/") && request.method === "GET") {
    return handleShare(env, decodeURIComponent(url.pathname.slice("/share/".length)));
  }

  // Newsletter quinzenal. Guarda e-mail, idioma, data e o registro do
  // consentimento (LGPD); o link de cancelamento usa um token por inscrito.
  if (url.pathname === "/api/newsletter/subscribe" && request.method === "POST") {
    const { email, consent, lang } = await request.json().catch(() => ({}));
    const clean = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) || clean.length > 150) return json({ error: "E-mail inválido" }, 400);
    if (consent !== true) return json({ error: "Consentimento obrigatório" }, 400);
    await env.DB
      .prepare("INSERT OR IGNORE INTO subscribers (email, token, lang, consent, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(clean, crypto.randomUUID(), String(lang || "pt-BR").slice(0, 10),
        "Aceito receber a newsletter da Hooke por e-mail. Posso cancelar a qualquer momento pelo link no próprio e-mail.", now())
      .run();
    return json({ ok: true });
  }

  if (url.pathname === "/api/newsletter/unsubscribe" && request.method === "GET") {
    const token = url.searchParams.get("t") || "";
    const { meta } = await env.DB.prepare("DELETE FROM subscribers WHERE token = ?").bind(token).run();
    const removed = meta && meta.changes > 0;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter Hooke</title><style>body{font-family:system-ui,sans-serif;background:#f4f6f8;color:#1b2025;display:grid;place-items:center;min-height:100vh;margin:0}
.box{background:#fff;padding:40px;border-radius:18px;max-width:440px;text-align:center;box-shadow:0 10px 40px rgba(20,23,26,.1)}a{color:#14171a}</style></head>
<body><div class="box"><h1>Inscrição cancelada</h1><p>${removed ? "Você não vai mais receber a newsletter da Hooke." : "Este link já foi usado ou não é válido."}</p>
<p><a href="${SITE_URL}/news.html">Voltar para as notícias</a></p></div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Contador de leituras (bloco "Mais lidas", gráficos do painel e newsletter).
  if (url.pathname === "/api/views" && request.method === "GET") {
    return json(await viewsMap(env));
  }

  if (url.pathname.startsWith("/api/views/") && request.method === "POST") {
    const id = decodeURIComponent(url.pathname.slice("/api/views/".length));
    const found = await getItem(env, id);
    if (!found || found.status !== "published") return json({ error: "Notícia não encontrada" }, 404);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO views (id, count) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET count = count + 1").bind(id),
      env.DB.prepare("INSERT INTO views_daily (day, id, count) VALUES (?, ?, 1) ON CONFLICT(day, id) DO UPDATE SET count = count + 1").bind(today(), id),
    ]);
    return json({ ok: true });
  }

  if (url.pathname === "/api/news" && request.method === "GET") {
    return json(await listItems(env, "published"));
  }

  if (url.pathname.startsWith("/api/news/") && request.method === "GET") {
    const found = await getItem(env, url.pathname.slice("/api/news/".length));
    if (!found || found.status !== "published") return json({ error: "Notícia não encontrada" }, 404);
    return json(found.item);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};
