// Acesso ao D1 e utilitários de resposta, compartilhados pelas rotas.

export const SITE_URL = "https://www.hookengenharia.com.br";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);

export function rowToItem(row) {
  return { ...JSON.parse(row.data), id: row.id, publishedAt: row.published_at || undefined };
}

export async function listItems(env, status) {
  const { results } = await env.DB
    .prepare("SELECT id, data, published_at FROM items WHERE status = ? ORDER BY COALESCE(published_at, created_at) DESC")
    .bind(status)
    .all();
  return results.map(rowToItem);
}

export async function getItem(env, id) {
  const row = await env.DB.prepare("SELECT id, status, data, published_at FROM items WHERE id = ?").bind(id).first();
  return row ? { status: row.status, item: rowToItem(row) } : null;
}

export function insertItem(env, status, item) {
  return env.DB
    .prepare("INSERT OR IGNORE INTO items (id, status, link, data, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(item.id, status, item.link || null, JSON.stringify(item), item.createdAt || now(), item.publishedAt || null);
}

// Atualiza só os campos informados, na própria instrução SQL (json_set /
// json_remove): duas atualizações de campos diferentes da mesma notícia nunca
// se sobrescrevem.
export function patchItem(env, id, set = {}, remove = []) {
  let expr = "data";
  const binds = [];
  const keys = Object.keys(set).filter((k) => set[k] !== undefined);
  if (keys.length) {
    expr = `json_set(${expr}, ${keys.map(() => "?, json(?)").join(", ")})`;
    keys.forEach((k) => binds.push(`$.${k}`, JSON.stringify(set[k])));
  }
  if (remove.length) {
    expr = `json_remove(${expr}, ${remove.map(() => "?").join(", ")})`;
    remove.forEach((k) => binds.push(`$.${k}`));
  }
  return env.DB.prepare(`UPDATE items SET data = ${expr} WHERE id = ?`).bind(...binds, id);
}

export async function viewsMap(env) {
  const { results } = await env.DB.prepare("SELECT id, count FROM views").all();
  return Object.fromEntries(results.map((r) => [r.id, r.count]));
}

export async function getJson(env, key) {
  const raw = await env.NEWS_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT value, updated_at, updated_by FROM settings WHERE key = ?").bind(key).first();
  return row || null;
}
