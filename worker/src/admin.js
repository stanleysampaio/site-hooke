// Rotas do painel /admin/news.html. Todas exigem sessão (exceto o login); as
// de usuários, regras e histórico exigem perfil "admin". Toda ação que muda
// algo fica registrada em audit_log.
import { json, now, listItems, getItem, patchItem, viewsMap, getJson, getSetting } from "./db.js";
import {
  hashPassword, verifyPassword, passwordProblem, makeToken, userFromRequest, publicUser,
  allowIp, registerFailure, isLocked, LOCK_MINUTES,
} from "./auth.js";

// Seções obrigatórias do arquivo de regras (o news-pipeline depende delas).
export const RULE_SECTIONS = ["Perfil", "Curadoria", "Pesquisa", "Redação", "Fontes", "Verificação", "Formatação", "Links internos", "Imagem", "Tradução"];

const NO_STORE = { "Cache-Control": "no-store" };
const ok = (data = { ok: true }, status = 200) => json(data, status, NO_STORE);
const fail = (error, status = 400) => json({ error }, status, NO_STORE);

async function audit(env, user, action, targetId = null, details = null) {
  await env.DB
    .prepare("INSERT INTO audit_log (at, user_id, username, action, target_id, details) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(now(), user ? user.id : null, user ? user.username : null, action, targetId,
      details == null ? null : typeof details === "string" ? details : JSON.stringify(details))
    .run();
}

const titleOf = (found) => (found && found.item && found.item.title ? found.item.title.slice(0, 120) : null);

// Mesma busca do news-pipeline (src/sources.js): Bing Notícias, por data, Brasil.
function bingUrl(query) {
  const params = new URLSearchParams({ q: query, format: "rss", setlang: "pt-BR", cc: "BR", qft: 'sortbydate="1"' });
  return `https://www.bing.com/news/search?${params}`;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// Série diária completa (dias sem dado = 0), do mais antigo para hoje.
function fillDays(rows, days) {
  const map = Object.fromEntries(rows.map((r) => [r.d, r.c]));
  return Array.from({ length: days }, (_, i) => {
    const d = daysAgo(days - 1 - i);
    return { day: d, count: map[d] || 0 };
  });
}

async function metrics(env, days) {
  const since = daysAgo(days - 1);
  const monthStart = now().slice(0, 7) + "-01";
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results);
  const one = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();

  const [statusRows, viewsTotal, viewsByDay, topWeek, topMonth, bySector, generated, approved,
    subsTotal, subsByDay, monthGenerated, monthApproved] = await Promise.all([
    q("SELECT status, COUNT(*) AS n FROM items GROUP BY status"),
    one("SELECT COALESCE(SUM(count), 0) AS n FROM views"),
    q("SELECT day AS d, SUM(count) AS c FROM views_daily WHERE day >= ? GROUP BY day", since),
    q(`SELECT v.id, SUM(v.count) AS c, json_extract(i.data, '$.title') AS title, json_extract(i.data, '$.sector') AS sector
       FROM views_daily v JOIN items i ON i.id = v.id AND i.status = 'published'
       WHERE v.day >= ? GROUP BY v.id ORDER BY c DESC LIMIT 5`, daysAgo(6)),
    q(`SELECT v.id, SUM(v.count) AS c, json_extract(i.data, '$.title') AS title, json_extract(i.data, '$.sector') AS sector
       FROM views_daily v JOIN items i ON i.id = v.id AND i.status = 'published'
       WHERE v.day >= ? GROUP BY v.id ORDER BY c DESC LIMIT 5`, daysAgo(29)),
    q(`SELECT json_extract(i.data, '$.sector') AS sector, COUNT(*) AS items, COALESCE(SUM(v.count), 0) AS views
       FROM items i LEFT JOIN views v ON v.id = i.id WHERE i.status = 'published' GROUP BY sector ORDER BY views DESC, items DESC`),
    q("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c FROM items WHERE created_at >= ? GROUP BY d", since),
    q("SELECT substr(published_at, 1, 10) AS d, COUNT(*) AS c FROM items WHERE status = 'published' AND published_at >= ? GROUP BY d", since),
    one("SELECT COUNT(*) AS n FROM subscribers"),
    q("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c FROM subscribers WHERE created_at >= ? GROUP BY d", since),
    one("SELECT COUNT(*) AS n FROM items WHERE created_at >= ?", monthStart),
    one("SELECT COUNT(*) AS n FROM items WHERE status = 'published' AND published_at >= ?", monthStart),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  // Estimativa de custo da IA no mês (tabela Gemini de out/2026): ~US$ 0,02
  // por matéria gerada (pesquisa + checagem) e ~US$ 0,09 por aprovada
  // (imagem US$ 0,067 + tradução ~US$ 0,025).
  const costUsd = monthGenerated.n * 0.02 + monthApproved.n * 0.092;

  return {
    days,
    totals: {
      published: byStatus.published || 0,
      pending: byStatus.pending || 0,
      rejected: byStatus.rejected || 0,
      views: viewsTotal.n,
      subscribers: subsTotal.n,
    },
    viewsByDay: fillDays(viewsByDay, days),
    generatedByDay: fillDays(generated, days),
    approvedByDay: fillDays(approved, days),
    subscribersByDay: fillDays(subsByDay, days),
    topWeek,
    topMonth,
    bySector,
    month: { generated: monthGenerated.n, approved: monthApproved.n, estimatedCostUsd: Math.round(costUsd * 100) / 100 },
    lastRun: await getJson(env, "last-run"),
    runRequestedAt: await env.NEWS_KV.get("run-request"),
  };
}

function validateRules(text) {
  const t = String(text || "");
  if (t.length < 200) return "O texto das regras está curto demais.";
  if (t.length > 40000) return "O texto das regras está longo demais (máx. 40.000 caracteres).";
  const missing = RULE_SECTIONS.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, "mi").test(t));
  if (missing.length) return `Faltam as seções: ${missing.map((s) => `"## ${s}"`).join(", ")}. Mantenha os títulos das seções.`;
  return null;
}

export async function handleAdmin(request, env, url) {
  const path = url.pathname.slice("/api/admin".length);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  // ---------- Login ----------
  if (path === "/login" && request.method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!(await allowIp(env, ip))) return fail(`Muitas tentativas a partir desta rede. Aguarde ${LOCK_MINUTES} minutos.`, 429);
    const username = String(body.username || "").trim().toLowerCase();
    const user = username && (await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first());
    // Mesma resposta para usuário inexistente e senha errada (não revela quem existe).
    if (!user || !user.active) {
      if (user) await audit(env, user, "login_negado", null, "usuário desativado");
      return fail("Usuário ou senha inválidos.", 401);
    }
    if (isLocked(user)) return fail(`Usuário bloqueado por excesso de tentativas. Tente de novo em até ${LOCK_MINUTES} minutos.`, 423);
    if (!(await verifyPassword(String(body.password || ""), user))) {
      const locked = await registerFailure(env, user);
      await audit(env, user, locked ? "login_bloqueado" : "login_falhou", null, { ip });
      return fail(locked ? `Senha incorreta. Usuário bloqueado por ${LOCK_MINUTES} minutos.` : "Usuário ou senha inválidos.", 401);
    }
    await env.DB.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").bind(now(), user.id).run();
    await audit(env, user, "login", null, { ip });
    return ok({ token: await makeToken(env, user), user: publicUser(user) });
  }

  const user = await userFromRequest(request, env);
  if (!user) return fail("Sessão expirada. Entre de novo.", 401);
  const isAdmin = user.role === "admin";

  // ---------- Conta ----------
  if (path === "/me" && request.method === "GET") return ok({ user: publicUser(user) });

  if (path === "/password" && request.method === "POST") {
    if (!(await verifyPassword(String(body.current || ""), user))) return fail("A senha atual não confere.");
    const problem = passwordProblem(body.next, user.username);
    if (problem) return fail(problem);
    if (body.next === body.current) return fail("A nova senha precisa ser diferente da atual.");
    const h = await hashPassword(String(body.next));
    await env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iterations = ?, must_change = 0, token_version = token_version + 1 WHERE id = ?")
      .bind(h.hash, h.salt, h.iterations, user.id).run();
    await audit(env, user, "senha_alterada");
    const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    return ok({ token: await makeToken(env, fresh), user: publicUser(fresh) });
  }

  // Com senha provisória, só dá para trocar a senha.
  if (user.must_change) return fail("Troque a senha provisória para continuar.", 403);

  if (path === "/logout-all" && request.method === "POST") {
    await env.DB.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").bind(user.id).run();
    await audit(env, user, "sessoes_encerradas");
    return ok();
  }

  // ---------- Métricas ----------
  if (path === "/metrics" && request.method === "GET") {
    const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));
    return ok(await metrics(env, days));
  }

  // Compatível com o painel antigo.
  if (path === "/status" && request.method === "GET") {
    const subs = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers").first();
    return ok({ lastRun: await getJson(env, "last-run"), runRequestedAt: await env.NEWS_KV.get("run-request"), subscribers: subs.n, views: await viewsMap(env) });
  }

  // ---------- Notícias ----------
  if (path === "/pending" && request.method === "GET") return ok(await listItems(env, "pending"));
  if (path === "/published" && request.method === "GET") {
    const [items, views] = await Promise.all([listItems(env, "published"), viewsMap(env)]);
    return ok(items.map((it) => ({ ...it, views: views[it.id] || 0 })));
  }

  // Ao aprovar, a imagem por IA (se ainda não tem) e a tradução são pedidas.
  if (path === "/approve" && request.method === "POST") {
    const found = await getItem(env, body.id);
    if (!found || found.status !== "pending") return fail("Notícia não encontrada.", 404);
    const set = { translationStatus: "requested", approvedBy: user.name };
    if (!found.item.imageGenerated) set.imageStatus = "requested";
    if (body.reviewedBy) set.reviewedBy = String(body.reviewedBy).slice(0, 120);
    await env.DB.batch([
      env.DB.prepare("UPDATE items SET status = 'published', published_at = ? WHERE id = ? AND status = 'pending'").bind(now(), body.id),
      patchItem(env, body.id, set),
    ]);
    await audit(env, user, "noticia_aprovada", body.id, titleOf(found));
    return ok();
  }

  // "Excluir": some do painel e do site, mas o link continua registrado
  // (status 'rejected') para o gerador não refazer a mesma pauta.
  if (path === "/reject" && request.method === "POST") {
    const found = await getItem(env, body.id);
    await env.DB.prepare("UPDATE items SET status = 'rejected' WHERE id = ? AND status = 'pending'").bind(body.id).run();
    await audit(env, user, "noticia_excluida", body.id, titleOf(found));
    return ok();
  }

  if (path === "/unpublish" && request.method === "POST") {
    const found = await getItem(env, body.id);
    await env.DB.batch([
      env.DB.prepare("UPDATE items SET status = 'rejected' WHERE id = ? AND status = 'published'").bind(body.id),
      env.DB.prepare("DELETE FROM views WHERE id = ?").bind(body.id),
    ]);
    await audit(env, user, "noticia_despublicada", body.id, titleOf(found));
    return ok();
  }

  if (path === "/edit" && request.method === "POST") {
    const found = await getItem(env, body.id);
    if (!found) return fail("Notícia não encontrada.", 404);
    const item = found.item;
    const set = {};
    const remove = [];
    for (const f of ["title", "summary", "excerpt", "sector", "link", "imageAlt", "imagePrompt"]) {
      if (body[f] !== undefined && body[f] !== item[f]) set[f] = body[f];
    }
    if (body.body !== undefined) {
      const paragraphs = Array.isArray(body.body) ? body.body : String(body.body).split("\n\n").filter(Boolean);
      if (JSON.stringify(paragraphs) !== JSON.stringify(item.body)) set.body = paragraphs;
    }
    if (body.reviewedBy !== undefined && body.reviewedBy !== item.reviewedBy) set.reviewedBy = String(body.reviewedBy).slice(0, 120);
    if (body.image !== undefined && body.image !== item.image) {
      // Imagem trocada à mão: não sobrescrever com a da IA.
      set.image = body.image;
      set.imageGenerated = true;
      remove.push("imageStatus");
    }
    // Texto de notícia publicada mudou: refaz a tradução.
    const textChanged = ["title", "excerpt", "body", "imageAlt"].some((f) => f in set);
    if (found.status === "published" && textChanged) set.translationStatus = "requested";
    if (!Object.keys(set).length && !remove.length) return ok();
    await patchItem(env, body.id, set, remove).run();
    await audit(env, user, "noticia_editada", body.id, { titulo: titleOf(found), campos: Object.keys(set) });
    return ok();
  }

  if (path === "/request-image" && request.method === "POST") {
    const found = await getItem(env, body.id);
    if (!found) return fail("Notícia não encontrada.", 404);
    await patchItem(env, body.id, { imageStatus: "requested" }).run();
    await audit(env, user, "imagem_pedida", body.id, titleOf(found));
    return ok();
  }

  // O cron da EC2 (a cada 5 min) consome o pedido em /api/ingest/run-request.
  if (path === "/run-now" && request.method === "POST") {
    const requestedAt = now();
    await env.NEWS_KV.put("run-request", requestedAt);
    await audit(env, user, "geracao_pedida");
    return ok({ ok: true, requestedAt });
  }

  // ---------- Temas e fontes (todos veem; só administradores mudam) ----------
  if (path === "/themes" && request.method === "GET") {
    const since = daysAgo(29);
    const [eds, ths, stats, sectorStats] = await Promise.all([
      env.DB.prepare("SELECT * FROM editorias ORDER BY sort, name").all(),
      env.DB.prepare("SELECT * FROM themes ORDER BY created_at").all(),
      env.DB.prepare(`SELECT json_extract(data, '$.themeId') AS tid, COUNT(*) AS generated,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS approved
        FROM items WHERE created_at >= ? GROUP BY tid`).bind(since).all(),
      env.DB.prepare(`SELECT json_extract(data, '$.sector') AS sector, COUNT(*) AS generated,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS approved
        FROM items WHERE created_at >= ? GROUP BY sector`).bind(since).all(),
    ]);
    const byTheme = Object.fromEntries(stats.results.filter((s) => s.tid).map((s) => [s.tid, s]));
    const bySector = Object.fromEntries(sectorStats.results.map((s) => [s.sector, s]));
    return ok({
      editorias: eds.results.map((e) => ({
        name: e.name, maxPerRun: e.max_per_run, active: !!e.active,
        generated30: (bySector[e.name] || {}).generated || 0, approved30: (bySector[e.name] || {}).approved || 0,
      })),
      themes: ths.results.map((t) => ({
        id: t.id, editoria: t.editoria, kind: t.kind, value: t.value, priority: !!t.priority, active: !!t.active,
        createdAt: t.created_at, createdBy: t.created_by,
        generated30: (byTheme[t.id] || {}).generated || 0, approved30: (byTheme[t.id] || {}).approved || 0,
      })),
    });
  }

  // Testa um tema antes de salvar: quantas notícias ele traz hoje.
  if (path === "/themes/test" && request.method === "POST") {
    const kind = body.kind === "rss" ? "rss" : "busca";
    const value = String(body.value || "").trim();
    if (!value) return fail("Informe o termo de busca ou o endereço do RSS.");
    const feedUrl = kind === "busca" ? bingUrl(value) : value;
    if (kind === "rss" && !/^https?:\/\//i.test(value)) return fail("O endereço do RSS precisa começar com http:// ou https://");
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HookeNewsBot/2.0; +https://hookengenharia.com.br)", Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return ok({ ok: false, message: `O endereço respondeu erro ${res.status}.` });
      const xml = await res.text();
      const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
      const titles = blocks.slice(0, 3).map((b) => {
        const m = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
          .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim() : "";
      }).filter(Boolean);
      if (!blocks.length) return ok({ ok: false, message: kind === "rss" ? "O endereço não parece ser um RSS (nenhuma notícia encontrada)." : "A busca não encontrou notícias recentes com esse termo." });
      return ok({ ok: true, count: blocks.length, titles });
    } catch (err) {
      return ok({ ok: false, message: "Não foi possível acessar o endereço (tempo esgotado ou bloqueio)." });
    }
  }

  if (path.startsWith("/themes/") || path.startsWith("/editorias/")) {
    if (!isAdmin) return fail("Apenas administradores podem alterar temas e editorias.", 403);

    if (path === "/themes/add" && request.method === "POST") {
      const kind = body.kind === "rss" ? "rss" : "busca";
      const value = String(body.value || "").trim().slice(0, 300);
      const ed = await env.DB.prepare("SELECT name FROM editorias WHERE name = ?").bind(body.editoria).first();
      if (!ed) return fail("Editoria não encontrada.");
      if (value.length < 3) return fail("O tema precisa ter pelo menos 3 caracteres.");
      if (kind === "rss" && !/^https?:\/\//i.test(value)) return fail("O endereço do RSS precisa começar com http:// ou https://");
      const dup = await env.DB.prepare("SELECT 1 FROM themes WHERE editoria = ? AND lower(value) = lower(?)").bind(ed.name, value).first();
      if (dup) return fail("Esse tema já existe nessa editoria.");
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO themes (id, editoria, kind, value, priority, active, created_at, created_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(id, ed.name, kind, value, body.priority ? 1 : 0, now(), user.name).run();
      await audit(env, user, "tema_adicionado", id, { editoria: ed.name, tema: value });
      return ok({ ok: true, id });
    }

    if (path === "/themes/update" && request.method === "POST") {
      const th = await env.DB.prepare("SELECT * FROM themes WHERE id = ?").bind(body.id).first();
      if (!th) return fail("Tema não encontrado.", 404);
      const sets = [];
      const binds = [];
      const changes = [];
      if (body.active !== undefined) { sets.push("active = ?"); binds.push(body.active ? 1 : 0); changes.push(body.active ? "reativado" : "pausado"); }
      if (body.priority !== undefined) { sets.push("priority = ?"); binds.push(body.priority ? 1 : 0); changes.push(body.priority ? "prioritário" : "normal"); }
      if (!sets.length) return ok();
      await env.DB.prepare(`UPDATE themes SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, th.id).run();
      await audit(env, user, "tema_alterado", th.id, { editoria: th.editoria, tema: th.value, mudancas: changes });
      return ok();
    }

    if (path === "/themes/delete" && request.method === "POST") {
      const th = await env.DB.prepare("SELECT * FROM themes WHERE id = ?").bind(body.id).first();
      if (!th) return fail("Tema não encontrado.", 404);
      await env.DB.prepare("DELETE FROM themes WHERE id = ?").bind(th.id).run();
      await audit(env, user, "tema_excluido", th.id, { editoria: th.editoria, tema: th.value });
      return ok();
    }

    // Cria uma editoria ou altera o limite diário / situação de uma existente.
    if (path === "/editorias/save" && request.method === "POST") {
      const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (name.length < 3) return fail("O nome da editoria precisa ter pelo menos 3 caracteres.");
      const max = Math.max(0, Math.min(5, Number.isFinite(Number(body.maxPerRun)) ? Number(body.maxPerRun) : 1));
      const existing = await env.DB.prepare("SELECT * FROM editorias WHERE name = ?").bind(name).first();
      if (existing) {
        const active = body.active === undefined ? existing.active : body.active ? 1 : 0;
        await env.DB.prepare("UPDATE editorias SET max_per_run = ?, active = ?, updated_at = ? WHERE name = ?").bind(max, active, now(), name).run();
        await audit(env, user, "editoria_alterada", null, { editoria: name, por_dia: max, situacao: active ? "ativa" : "pausada" });
      } else {
        if (!body.create) return fail("Editoria não encontrada.", 404);
        const { n } = await env.DB.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM editorias").first();
        await env.DB.prepare("INSERT INTO editorias (name, max_per_run, active, sort, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)").bind(name, max, n, now(), now()).run();
        await audit(env, user, "editoria_criada", null, { editoria: name, por_dia: max });
      }
      return ok();
    }

    return fail("Not found", 404);
  }

  // ---------- Newsletter (e-mails são dados pessoais: só administradores) ----------
  if (path.startsWith("/subscribers") && !isAdmin) return fail("Apenas administradores podem ver os inscritos.", 403);
  if (path === "/subscribers" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT email, lang, created_at FROM subscribers ORDER BY created_at DESC").all();
    return ok(results);
  }

  if (path === "/subscribers/remove" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM subscribers WHERE email = ?").bind(String(body.email || "").toLowerCase()).run();
    await audit(env, user, "inscrito_removido", null, body.email);
    return ok();
  }

  // ---------- Regras editoriais (lidas pelo news-pipeline) ----------
  if (path === "/rules" && request.method === "GET") {
    const s = await getSetting(env, "rules");
    return ok({ text: s ? s.value : "", updatedAt: s ? s.updated_at : null, updatedBy: s ? s.updated_by : null, sections: RULE_SECTIONS });
  }

  if (path === "/rules/history" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, at, username, length(value) AS size FROM settings_history WHERE key = 'rules' ORDER BY id DESC LIMIT 30").all();
    return ok(results);
  }

  if (path === "/rules/version" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT value, at, username FROM settings_history WHERE id = ? AND key = 'rules'").bind(Number(url.searchParams.get("id"))).first();
    return row ? ok(row) : fail("Versão não encontrada.", 404);
  }

  if (!isAdmin) return fail("Apenas administradores podem fazer isso.", 403);

  if (path === "/rules" && request.method === "POST") {
    const problem = validateRules(body.text);
    if (problem) return fail(problem);
    const at = now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by) VALUES ('rules', ?, ?, ?)").bind(body.text, at, user.name),
      env.DB.prepare("INSERT INTO settings_history (key, value, at, username) VALUES ('rules', ?, ?, ?)").bind(body.text, at, user.name),
    ]);
    await audit(env, user, "regras_alteradas", null, `${String(body.text).length} caracteres`);
    return ok();
  }

  // ---------- Usuários (somente admin) ----------
  if (path === "/users" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY created_at").all();
    return ok(results.map(publicUser));
  }

  if (path === "/users" && request.method === "POST") {
    const username = String(body.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return fail("Nome de usuário: 3 a 40 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.");
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return fail("Informe o nome da pessoa.");
    const role = body.role === "admin" ? "admin" : "editor";
    const problem = passwordProblem(body.password, username);
    if (problem) return fail(`Senha provisória: ${problem}`);
    if (await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) return fail("Já existe um usuário com esse nome.");
    const h = await hashPassword(String(body.password));
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users (id, username, name, email, role, pass_hash, pass_salt, pass_iterations, must_change, active, token_version, failed_attempts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 0, ?)`)
      .bind(id, username, name, String(body.email || "").trim().slice(0, 150) || null, role, h.hash, h.salt, h.iterations, now()).run();
    await audit(env, user, "usuario_criado", id, { username, role });
    return ok({ ok: true, id });
  }

  if (path === "/users/update" && request.method === "POST") {
    const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(body.id).first();
    if (!target) return fail("Usuário não encontrado.", 404);
    const changes = [];
    const sets = [];
    const binds = [];
    if (body.name !== undefined) { sets.push("name = ?"); binds.push(String(body.name).trim().slice(0, 120)); changes.push("nome"); }
    if (body.email !== undefined) { sets.push("email = ?"); binds.push(String(body.email).trim().slice(0, 150) || null); changes.push("e-mail"); }
    if (body.role !== undefined) {
      if (target.id === user.id && body.role !== "admin") return fail("Você não pode tirar o seu próprio perfil de administrador.");
      sets.push("role = ?"); binds.push(body.role === "admin" ? "admin" : "editor"); changes.push("perfil");
    }
    if (body.active !== undefined) {
      if (target.id === user.id && !body.active) return fail("Você não pode desativar o seu próprio usuário.");
      sets.push("active = ?", "token_version = token_version + 1"); binds.push(body.active ? 1 : 0); changes.push(body.active ? "reativado" : "desativado");
    }
    if (body.unlock) { sets.push("failed_attempts = 0", "locked_until = NULL"); changes.push("desbloqueado"); }
    if (body.password !== undefined) {
      const problem = passwordProblem(body.password, target.username);
      if (problem) return fail(`Senha provisória: ${problem}`);
      const h = await hashPassword(String(body.password));
      sets.push("pass_hash = ?", "pass_salt = ?", "pass_iterations = ?", "must_change = 1", "token_version = token_version + 1");
      binds.push(h.hash, h.salt, h.iterations);
      changes.push("senha redefinida");
    }
    if (!sets.length) return ok();
    // Nunca deixar o painel sem nenhum administrador ativo.
    if ((body.role === "editor" || body.active === false) && target.role === "admin") {
      const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").bind(target.id).first();
      if (!admins.n) return fail("É preciso ter pelo menos um administrador ativo.");
    }
    await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, target.id).run();
    await audit(env, user, "usuario_alterado", target.id, { username: target.username, mudancas: changes });
    return ok();
  }

  // ---------- Histórico ----------
  if (path === "/audit" && request.method === "GET") {
    const limit = Math.min(500, Number(url.searchParams.get("limit")) || 200);
    const { results } = await env.DB.prepare("SELECT at, username, action, target_id, details FROM audit_log ORDER BY id DESC LIMIT ?").bind(limit).all();
    return ok(results);
  }

  return fail("Not found", 404);
}
