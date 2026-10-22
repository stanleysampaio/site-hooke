import { config } from './config.js';

// GEMINI_BASE_URL só existe para testes com um servidor falso.
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;

async function request(pathname, init = {}, apiKey = config.geminiApiKey) {
  return fetch(`${BASE}/${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(init.headers || {}) },
  });
}

// Chamada com espaçamento mínimo entre requisições (cota do plano free) e
// novas tentativas em 429/5xx.
async function generate(model, body, timeoutMs = 120000, apiKey = config.geminiApiKey) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + config.geminiDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    const res = await request(`models/${model}:generateContent`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }, apiKey);
    if (res.ok) return res.json();

    const detail = (await res.text()).slice(0, 400);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      console.log(`  Gemini ${model} respondeu ${res.status}, tentando de novo em ${30 * (attempt + 1)}s...`);
      await sleep(30000 * (attempt + 1));
      continue;
    }
    throw new Error(`Gemini ${model} ${res.status}: ${detail}`);
  }
  throw new Error(`Gemini ${model}: tentativas esgotadas`);
}

function partsOf(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error(`Gemini sem resposta (${data?.promptFeedback?.blockReason || 'motivo desconhecido'})`);
  return candidate.content?.parts || [];
}

export async function generateJson(prompt, { temperature = 0.4, apiKey } = {}) {
  const data = await generate(config.textModel, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  }, 180000, apiKey || config.geminiApiKey);
  const text = partsOf(data).map((p) => p.text || '').join('').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini devolveu JSON inválido: ${text.slice(0, 200)}`);
  }
}

// Mesma coisa, mas com a ferramenta de busca do Google ligada: o modelo pesquisa
// o tema antes de responder. Devolve também as fontes que ele consultou
// (links de redirecionamento do Google; resolva com resolveSourceUrl).
export async function generateGroundedJson(prompt, { temperature = 0.4 } = {}) {
  const data = await generate(config.textModel, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  }, 180000);
  const parts = partsOf(data);
  const text = parts.map((p) => p.text || '').join('').replace(/```json|```/g, '').trim();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini devolveu JSON inválido: ${text.slice(0, 200)}`);
  }
  const meta = data.candidates[0].groundingMetadata || {};
  const sources = (meta.groundingChunks || [])
    .map((c) => c.web)
    .filter((w) => w && w.uri)
    .map((w) => ({ title: w.title || '', uri: w.uri }));
  return { json, sources, queries: meta.webSearchQueries || [] };
}

// Os links das fontes vêm como redirecionamento do Google (que expira);
// guardamos o endereço final da página.
export async function resolveSourceUrl(uri) {
  if (!/grounding-api-redirect/.test(uri)) return uri;
  try {
    const res = await fetch(uri, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    return res.headers.get('location') || null;
  } catch {
    return null;
  }
}

let imageModelPromise = null;

// Os nomes dos modelos de imagem mudam com frequência; sem GEMINI_IMAGE_MODEL
// pegamos o mais recente com "image" no nome (preferindo os "flash", mais baratos).
async function resolveImageModel() {
  if (config.imageModel) return config.imageModel;
  const res = await request('models?pageSize=200');
  if (!res.ok) throw new Error(`Não foi possível listar modelos da Gemini: ${res.status}`);
  const { models = [] } = await res.json();
  const names = models
    .filter((m) => /image/i.test(m.name) && !/imagen/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort((a, b) => (/flash/.test(b) - /flash/.test(a)) || b.localeCompare(a, 'en', { numeric: true }));
  if (!names.length) throw new Error('Nenhum modelo de geração de imagem disponível para esta API key');
  return names[0];
}

export async function generateImage(prompt) {
  imageModelPromise = imageModelPromise || resolveImageModel();
  const model = await imageModelPromise;
  const data = await generate(model, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  }, 180000);
  const img = partsOf(data).find((p) => p.inlineData?.data);
  if (!img) throw new Error(`${model} não devolveu imagem`);
  return { buffer: Buffer.from(img.inlineData.data, 'base64'), model };
}
