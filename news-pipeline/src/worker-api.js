import { config } from './config.js';

async function api(pathname, init = {}) {
  if (!config.ingestToken) throw new Error('INGEST_TOKEN não configurado');
  const res = await fetch(`${config.workerUrl}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.ingestToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Worker ${pathname} ${res.status}: ${body.error || 'erro'}`);
  return body;
}

// Links já pendentes ou publicados (para não gerar a mesma notícia de novo).
export async function getKnownLinks() {
  const { links = [] } = await api('/api/ingest/known');
  return links;
}

// Notícias publicadas (para os links internos entre matérias relacionadas).
export async function getPublished() {
  const res = await fetch(`${config.workerUrl}/api/news`, { signal: AbortSignal.timeout(30000) });
  return res.ok ? res.json() : [];
}

export async function pushItems(items) {
  return api('/api/ingest/items', { method: 'POST', body: JSON.stringify({ items }) });
}

// O botão "Gerar notícias agora" do painel só deixa um pedido no worker; o
// cron da EC2 consome esse pedido aqui. Devolve true se havia pedido.
export async function takeRunRequest() {
  const { requested } = await api('/api/ingest/run-request', { method: 'POST' });
  return Boolean(requested);
}

// Pedidos feitos no painel: imagens por IA e traduções (feitas ao aprovar).
export async function getQueue() {
  const { images = [], translations = [] } = await api('/api/ingest/queue');
  return { images, translations };
}

// Regras editoriais editadas no painel (texto vazio = usar o arquivo local).
export async function getRules() {
  const { text = '' } = await api('/api/ingest/rules');
  return text;
}

// Editorias e temas de pauta editados no painel.
export async function getThemes() {
  const { editorias = [], themes = [] } = await api('/api/ingest/themes');
  return { editorias, themes };
}

export async function getAllItems() {
  return api('/api/ingest/all');
}

export async function saveSources(id, sources) {
  return api('/api/ingest/sources', { method: 'POST', body: JSON.stringify({ id, sources }) });
}

export async function getUnwatermarked() {
  const { items = [] } = await api('/api/ingest/unwatermarked');
  return items;
}

export async function saveTranslation(result) {
  return api('/api/ingest/translation', { method: 'POST', body: JSON.stringify(result) });
}

export async function saveImage(result) {
  return api('/api/ingest/image', { method: 'POST', body: JSON.stringify(result) });
}

export async function reportRun(summary) {
  return api('/api/ingest/report', { method: 'POST', body: JSON.stringify(summary) });
}
