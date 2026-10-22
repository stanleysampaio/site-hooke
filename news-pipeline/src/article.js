import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { config } from './config.js';

// Sites de notícia costumam ter CSS/JS que o jsdom não entende; sem isso o
// console fica cheio de erros irrelevantes.
const quietConsole = new VirtualConsole();

function meta(doc, name) {
  const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
  return el ? el.getAttribute('content') || '' : '';
}

function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

// Autor da matéria como o próprio site publica (JSON-LD, metatags ou a linha
// "Por Fulano"). Nunca inventado: sem dado confiável, fica vazio.
// Empresas/agências que costumam aparecer na metatag "author" (quem fez o site).
const NOT_A_PERSON = /\b(labs?|ag[êe]ncia|digital|studio|web|design|ltda|s\.?a\.?|comunica[çc][ãa]o|marketing|tecnologia|sites?|group|grupo|media|m[íi]dia|press|news|not[íi]cias|reda[çc][ãa]o|equipe|portal|admin)\b/i;

// Só aceita algo com cara de nome de pessoa: 2 a 5 palavras, cada uma
// começando com maiúscula (partículas "de/da/do/dos/e" permitidas).
function looksLikePersonName(a) {
  const words = a.split(' ');
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^(de|da|do|dos|das|e)$/i.test(w) || /^[A-ZÀ-Ý][a-zà-ÿ'’.-]+$/.test(w));
}

function cleanAuthor(raw, siteName) {
  let a = String(raw || '').replace(/\s+/g, ' ').trim();
  a = a.replace(/^(por|by|de)\s*[:\-–]?\s+/i, '').replace(/\s*[|–-]\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}.*$/, '').trim();
  // "Fulano e Beltrano": valida cada nome.
  const names = a.split(/\s+e\s+|\s*,\s*/).map((n) => n.trim()).filter(Boolean);
  if (!names.length || names.some((n) => !looksLikePersonName(n) || NOT_A_PERSON.test(n))) return '';
  if (siteName && a.toLowerCase() === siteName.toLowerCase()) return '';
  return names.slice(0, 2).join(' e ');
}

// "Título da matéria - Nome do Portal" -> "Título da matéria"
function cleanTitle(title, siteName) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (siteName) {
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\s*[|–—-]\\s*${esc}\\s*$`, 'i'), '').trim();
  }
  return t.slice(0, 200);
}

// Autor declarado no JSON-LD de um Article/NewsArticle (o dado mais confiável).
function authorFromJsonLd(doc) {
  const byId = {};
  const nodes = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try { data = JSON.parse(s.textContent); } catch { continue; }
    for (const n of [].concat(data, (data && data['@graph']) || []).flat()) {
      if (!n || typeof n !== 'object') continue;
      if (n['@id']) byId[n['@id']] = n;
      nodes.push(n);
    }
  }
  const isArticle = (n) => /Article|BlogPosting|Report/i.test([].concat(n['@type'] || '').join(' '));
  for (const n of nodes.filter(isArticle)) {
    const names = [].concat(n.author || [])
      .map((x) => (typeof x === 'string' ? x : x && (x.name || (byId[x['@id']] && byId[x['@id']].name))))
      .filter(Boolean);
    if (names.length) return names.slice(0, 2).join(' e ');
  }
  return '';
}

function readMeta(doc, url, parsed) {
  const siteName = (meta(doc, 'og:site_name') || (parsed && parsed.siteName) || hostOf(url)).trim();
  const title = cleanTitle(meta(doc, 'og:title') || (parsed && parsed.title) || doc.title, siteName);
  // Ordem de confiança: JSON-LD do artigo > linha "Por Fulano" > metatags.
  const author = cleanAuthor(authorFromJsonLd(doc), siteName)
    || cleanAuthor(parsed && parsed.byline, siteName)
    || cleanAuthor(meta(doc, 'article:author') || meta(doc, 'parsely-author') || meta(doc, 'sailthru.author'), siteName)
    || cleanAuthor(meta(doc, 'author'), siteName);
  return { siteName, title, author };
}

async function fetchDom(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return { dom: new JSDOM(html, { url: res.url, virtualConsole: quietConsole }), finalUrl: res.url };
}

// Baixa a matéria original e extrai só o texto principal (sem menu, anúncios,
// "leia também"), usando o mesmo algoritmo do modo leitura do Firefox.
export async function fetchArticle(url) {
  const { dom, finalUrl } = await fetchDom(url, 25000);
  const doc = dom.window.document;
  const publishedTime = meta(doc, 'article:published_time');
  const jsonLdAuthor = authorFromJsonLd(doc);
  const parsed = new Readability(doc.cloneNode(true)).parse();
  const info = readMeta(doc, finalUrl, parsed);
  if (!info.author) info.author = cleanAuthor(jsonLdAuthor, info.siteName);
  dom.window.close();

  if (!parsed || !parsed.content) return { text: '', ...info, publishedTime };

  const content = new JSDOM(parsed.content, { virtualConsole: quietConsole }).window.document;
  const blocks = [...content.querySelectorAll('p, li, h2, h3, blockquote')]
    .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 30);
  // Remove repetições (alguns temas duplicam o lead dentro do corpo).
  const unique = [...new Set(blocks)];

  return { text: unique.join('\n\n').slice(0, 12000), ...info, publishedTime };
}

// Só título, portal e autor de uma fonte (para a lista de fontes da matéria).
export async function fetchSourceMeta(url) {
  try {
    const { dom, finalUrl } = await fetchDom(url, 15000);
    const doc = dom.window.document;
    const parsed = new Readability(doc.cloneNode(true)).parse();
    const info = readMeta(doc, finalUrl, parsed);
    dom.window.close();
    return info;
  } catch {
    return { siteName: hostOf(url), title: '', author: '' };
  }
}
