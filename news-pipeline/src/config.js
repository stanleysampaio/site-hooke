import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(name, fallback) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  root: ROOT,

  // Gemini (https://aistudio.google.com/apikey)
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // Opcional: chave de um projeto Google SEM faturamento (plano gratuito), usada
  // só nas traduções para elas não custarem nada. Vazio = usa GEMINI_API_KEY.
  geminiTranslateKey: process.env.GEMINI_FREE_API_KEY || process.env.GEMINI_API_KEY || '',
  textModel: process.env.GEMINI_TEXT_MODEL || 'gemini-3.6-flash',
  // Vazio = escolhe automaticamente um modelo com "image" no nome que aceite generateContent.
  imageModel: process.env.GEMINI_IMAGE_MODEL || '',
  // Intervalo mínimo entre chamadas à Gemini (plano free: ~5 req/min por modelo).
  geminiDelayMs: int('GEMINI_DELAY_MS', 13000),

  // Worker da Cloudflare que guarda pendentes/publicadas e serve o site.
  workerUrl: (process.env.WORKER_URL || 'https://hooke-news.yelnalts1993.workers.dev').replace(/\/$/, ''),
  ingestToken: process.env.INGEST_TOKEN || '',

  siteUrl: (process.env.SITE_URL || 'https://www.hookengenharia.com.br').replace(/\/$/, ''),

  // Imagens vão para o bucket do site; o caminho salvo na notícia é relativo ao site.
  s3Bucket: process.env.S3_BUCKET || '',
  s3Region: process.env.S3_REGION || 'sa-east-1',
  s3Prefix: (process.env.S3_PREFIX || 'img/noticias/').replace(/^\//, ''),

  // Volume e qualidade
  maxPerSector: int('MAX_PER_SECTOR', 1),
  maxPerRun: int('MAX_PER_RUN', 10),
  maxItemAgeDays: int('MAX_ITEM_AGE_DAYS', 7),

  stateFile: path.join(ROOT, 'data', 'state.json'),
  lockFile: path.join(ROOT, 'data', 'run.lock'),
  outDir: path.join(ROOT, 'out'),

  userAgent: 'Mozilla/5.0 (compatible; HookeNewsBot/2.0; +https://hookengenharia.com.br)',
};
