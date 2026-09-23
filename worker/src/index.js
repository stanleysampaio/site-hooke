import { SOURCES } from "./sources.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------- KV helpers ----------

async function getList(env, key) {
  const raw = await env.NEWS_KV.get(key);
  return raw ? JSON.parse(raw) : [];
}

async function putList(env, key, list) {
  await env.NEWS_KV.put(key, JSON.stringify(list));
}

// ---------- Auth (HMAC token, no session store) ----------

async function sign(env, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_PASSWORD),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function makeToken(env) {
  const exp = Date.now() + 1000 * 60 * 60 * 8; // 8h
  const payload = String(exp);
  const sig = await sign(env, payload);
  return `${payload}.${sig}`;
}

async function verifyToken(env, token) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (Number(payload) < Date.now()) return false;
  const expected = await sign(env, payload);
  return expected === sig;
}

async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return verifyToken(env, token);
}

// ---------- RSS parsing (regex-based, no DOM parser in Workers runtime) ----------

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseFeed(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    let link = extractTag(block, "link");
    if (!link) {
      const hrefMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      if (hrefMatch) link = hrefMatch[1];
    }
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated");
    const description = extractTag(block, "description") || extractTag(block, "summary");
    if (title && link) {
      items.push({ title, link, pubDate, description: description.slice(0, 500) });
    }
  }
  return items;
}

// Imagem por setor: as mesmas fotos já usadas na página de Serviços (uma por
// setor, próprias da Hooke — sem custo, sem depender de direitos de terceiros).
const DEFAULT_IMAGE = "/img/atuacao.jpg";
const SECTOR_IMAGES = {
  "Mineração": "/img/services-1.png",
  "Cimento": "/img/services-2.png",
  "Petróleo e Gás": "/img/services-3.png",
  "Fertilizantes": "/img/services-4.png",
  "Metalurgia": "/img/services-5.png",
  "Refrigeração": "/img/services-6.png",
  "Alimentícia": "/img/services-7.png",
  "Siderurgia": "/img/services-8.png",
};
function imageForSector(sector) {
  return SECTOR_IMAGES[sector] || DEFAULT_IMAGE;
}

// ---------- Extração do texto completo do artigo original ----------
// Sem parser de DOM disponível no runtime do Worker: removemos script/style e
// tags, e ficamos só com o texto visível. É heurístico (funciona bem o
// suficiente pra alimentar a reescrita da IA, não precisa ser perfeito).
function extractArticleText(html) {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const paragraphs = noScripts.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  const text = paragraphs
    .map((p) => p.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim())
    .filter((p) => p.length > 40)
    .join("\n\n");
  return text.slice(0, 6000);
}

async function fetchArticleText(link) {
  try {
    const res = await fetch(link, {
      headers: { "User-Agent": "HookeNewsBot/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    return extractArticleText(html);
  } catch (err) {
    console.log(`Falha ao buscar artigo ${link}: ${err.message}`);
    return "";
  }
}

// ---------- Redação da matéria completa (nossa própria, baseada na fonte) ----------
// Uma chamada só à Gemini pro lote inteiro de itens escolhidos, pelo mesmo
// motivo da curadoria: a cota free é de poucas requisições por dia.
async function writeFullArticles(env, items) {
  if (items.length === 0) return items;

  const sourceTexts = await Promise.all(
    items.map((it) => fetchArticleText(it.link))
  );

  const payload = items.map((it, i) => ({
    id: it.id,
    sector: it.sector,
    title: it.title,
    summary: it.summary,
    sourceText: sourceTexts[i] || "(não foi possível extrair o texto da fonte; baseie-se só no título e resumo)",
  }));

  const prompt = `Você é um redator da Hooke Engenharia escrevendo matérias originais para o blog
de notícias do setor industrial. Para cada item abaixo (título, setor, resumo e o texto extraído
da matéria original), escreva uma matéria própria em português, com 3 a 5 parágrafos, baseada
EXCLUSIVAMENTE nas informações fornecidas em "sourceText" (não invente fatos, números ou citações
que não estejam lá). Se "sourceText" estiver vazio ou insuficiente, escreva um texto mais curto
(1-2 parágrafos) baseado só no título e resumo, sem inventar detalhes. Escreva num tom
informativo e profissional, parafraseando (não copie frases inteiras da fonte).

Responda APENAS com um JSON array, sem texto adicional, no formato:
[{"id": "<id>", "excerpt": "<1-2 frases de chamada para o card>", "body": ["<parágrafo 1>", "<parágrafo 2>", "..."]}]

Itens:
${JSON.stringify(payload)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );

  if (!res.ok) {
    console.log(`Gemini falhou ao escrever matérias: ${res.status} ${await res.text()}`);
    return items.map((it) => ({ ...it, excerpt: it.summary, body: [it.summary], image: imageForSector(it.sector) }));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const cleaned = text.replace(/```json|```/g, "").trim();

  let written;
  try {
    written = JSON.parse(cleaned);
  } catch {
    console.log(`Resposta da Gemini (matérias) não é JSON válido: ${cleaned.slice(0, 300)}`);
    written = [];
  }

  const writtenById = Object.fromEntries(written.map((w) => [w.id, w]));

  return items.map((it) => {
    const w = writtenById[it.id];
    return {
      ...it,
      excerpt: w?.excerpt || it.summary,
      body: Array.isArray(w?.body) && w.body.length ? w.body : [it.summary],
      image: imageForSector(it.sector),
    };
  });
}

// Vários setores compartilham o feed genérico da Agência Brasil. Buscamos
// cada URL de feed uma única vez (mesmo que apareça em vários setores) pra
// não desperdiçar sub-requisições, que no plano free da Cloudflare são
// limitadas a 50 por execução do Worker.
async function fetchFeed(feedUrl) {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "HookeNewsBot/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml);
  } catch (err) {
    console.log(`Falha ao buscar feed ${feedUrl}: ${err.message}`);
    return [];
  }
}

async function fetchAllSectorItems() {
  const uniqueFeeds = [...new Set(Object.values(SOURCES).flat())];
  const entries = await Promise.all(uniqueFeeds.map(async (url) => [url, await fetchFeed(url)]));
  const itemsByFeed = Object.fromEntries(entries);

  const itemsBySector = {};
  for (const [sector, feeds] of Object.entries(SOURCES)) {
    itemsBySector[sector] = feeds.flatMap((url) => itemsByFeed[url] || []);
  }
  return itemsBySector;
}

// ---------- Gemini curation ----------

// O plano free da Gemini API limita a 5 requisições/minuto por modelo. Com 8
// setores, chamar a IA uma vez por setor estoura essa cota (a maioria volta
// 429 RESOURCE_EXHAUSTED). Por isso agrupamos todos os setores num único
// prompt e fazemos UMA chamada só por execução da curadoria.
async function curateAllSectors(env, itemsBySector) {
  const bySector = {};
  let candidateId = 0;
  const candidateIndex = {};

  for (const [sector, rawItems] of Object.entries(itemsBySector)) {
    if (rawItems.length === 0) continue;
    bySector[sector] = rawItems.slice(0, 20).map((it) => {
      const id = candidateId++;
      candidateIndex[id] = { sector, ...it };
      return {
        id,
        title: it.title,
        description: it.description,
        link: it.link,
        pubDate: it.pubDate,
      };
    });
  }

  if (Object.keys(bySector).length === 0) return [];

  const prompt = `Você é um curador de notícias para setores industriais no Brasil.
Abaixo está um objeto JSON com candidatos a notícia agrupados por setor. Para CADA setor,
escolha até 2 notícias que sejam realmente relevantes, recentes e específicas daquele setor
(descarte itens genéricos, duplicados ou fora do tema). Para cada uma escolhida, escreva um
título curto e um resumo de 1-2 frases em português, SEM copiar frases inteiras da fonte
(parafraseie).

Responda APENAS com um JSON array, sem texto adicional, no formato:
[{"sector": "<nome exato do setor>", "id": <id do candidato original>, "title": "...", "summary": "..."}]

Candidatos por setor:
${JSON.stringify(bySector)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );

  if (!res.ok) {
    console.log(`Gemini falhou na curadoria: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const cleaned = text.replace(/```json|```/g, "").trim();

  let picked;
  try {
    picked = JSON.parse(cleaned);
  } catch {
    console.log(`Resposta da Gemini não é JSON válido: ${cleaned.slice(0, 300)}`);
    return [];
  }

  const bySectorCount = {};
  return picked
    .filter((p) => candidateIndex[p.id])
    .filter((p) => {
      const count = bySectorCount[p.sector] || 0;
      if (count >= 2) return false;
      bySectorCount[p.sector] = count + 1;
      return true;
    })
    .map((p) => {
      const source = candidateIndex[p.id];
      return {
        id: crypto.randomUUID(),
        sector: source.sector,
        title: p.title || source.title,
        summary: p.summary || source.description,
        link: source.link,
        sourceDate: source.pubDate || null,
        createdAt: new Date().toISOString(),
      };
    });
}

async function runDailyCuration(env) {
  const itemsBySector = await fetchAllSectorItems();

  const picked = await curateAllSectors(env, itemsBySector);
  if (picked.length === 0) return;

  // Se a redação da matéria completa falhar (ex: estourou o limite de
  // sub-requisições do plano free), ainda assim salva os itens escolhidos
  // com um resumo básico, em vez de perder a curadoria inteira.
  let withFullArticles;
  try {
    withFullArticles = await writeFullArticles(env, picked);
  } catch (err) {
    console.log(`writeFullArticles falhou, salvando com resumo básico: ${err.message}`);
    withFullArticles = picked.map((it) => ({
      ...it,
      excerpt: it.summary,
      body: [it.summary],
      image: imageForSector(it.sector),
    }));
  }

  const pending = await getList(env, "pending");
  await putList(env, "pending", [...pending, ...withFullArticles]);
}

// ---------- HTTP routes ----------

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (url.pathname === "/api/news" && request.method === "GET") {
    const published = await getList(env, "published");
    return json(published);
  }

  if (url.pathname.startsWith("/api/news/") && request.method === "GET") {
    const id = url.pathname.slice("/api/news/".length);
    const published = await getList(env, "published");
    const item = published.find((it) => it.id === id);
    if (!item) return json({ error: "Notícia não encontrada" }, 404);
    return json(item);
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    const { password } = await request.json().catch(() => ({}));
    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: "Senha inválida" }, 401);
    }
    const token = await makeToken(env);
    return json({ token });
  }

  if (url.pathname === "/api/admin/pending" && request.method === "GET") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    const pending = await getList(env, "pending");
    return json(pending);
  }

  if (url.pathname === "/api/admin/approve" && request.method === "POST") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    const { id } = await request.json().catch(() => ({}));
    const pending = await getList(env, "pending");
    const item = pending.find((it) => it.id === id);
    if (!item) return json({ error: "Item não encontrado" }, 404);

    const published = await getList(env, "published");
    published.unshift({ ...item, publishedAt: new Date().toISOString() });
    await putList(env, "published", published);
    await putList(env, "pending", pending.filter((it) => it.id !== id));
    return json({ ok: true });
  }

  if (url.pathname === "/api/admin/reject" && request.method === "POST") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    const { id } = await request.json().catch(() => ({}));
    const pending = await getList(env, "pending");
    await putList(env, "pending", pending.filter((it) => it.id !== id));
    return json({ ok: true });
  }

  if (url.pathname === "/api/admin/published" && request.method === "GET") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    const published = await getList(env, "published");
    return json(published);
  }

  if (url.pathname === "/api/admin/unpublish" && request.method === "POST") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    const { id } = await request.json().catch(() => ({}));
    const published = await getList(env, "published");
    await putList(env, "published", published.filter((it) => it.id !== id));
    return json({ ok: true });
  }

  if (url.pathname === "/api/admin/edit" && request.method === "POST") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    const { list, id, title, summary, excerpt, body, sector, link, image } = await request.json().catch(() => ({}));
    if (list !== "pending" && list !== "published") {
      return json({ error: "list precisa ser 'pending' ou 'published'" }, 400);
    }
    const items = await getList(env, list);
    const item = items.find((it) => it.id === id);
    if (!item) return json({ error: "Item não encontrado" }, 404);

    if (title !== undefined) item.title = title;
    if (summary !== undefined) item.summary = summary;
    if (excerpt !== undefined) item.excerpt = excerpt;
    if (body !== undefined) item.body = Array.isArray(body) ? body : String(body).split("\n\n").filter(Boolean);
    if (sector !== undefined) item.sector = sector;
    if (link !== undefined) item.link = link;
    if (image !== undefined) item.image = image;

    await putList(env, list, items);
    return json({ ok: true, item });
  }

  // Rota manual pra disparar a curadoria fora do horário do cron (testes)
  if (url.pathname === "/api/admin/run-now" && request.method === "POST") {
    if (!(await requireAuth(request, env))) return json({ error: "Não autorizado" }, 401);
    ctx.waitUntil(runDailyCuration(env));
    return json({ ok: true, started: true });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx),
  scheduled: async (event, env, ctx) => {
    ctx.waitUntil(runDailyCuration(env));
  },
};
