import { XMLParser } from 'fast-xml-parser';
import { config } from './config.js';
import { bing } from './sources.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  htmlEntities: true,
});

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
}

export function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove parâmetros de rastreamento para a mesma matéria não entrar duas vezes.
// Links do Bing Notícias (apiclick.aspx?url=...) viram o link direto da matéria.
export function normalizeLink(link) {
  try {
    let u = new URL(link);
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.searchParams.get('url')) {
      u = new URL(u.searchParams.get('url'));
    }
    u.hash = '';
    [...u.searchParams.keys()].forEach((k) => { if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); });
    return u.toString();
  } catch {
    return link;
  }
}

function atomLink(entry) {
  const links = asArray(entry.link);
  const alt = links.find((l) => typeof l === 'object' && (!l.rel || l.rel === 'alternate')) || links[0];
  return typeof alt === 'object' ? alt.href || '' : text(alt);
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const rssItems = asArray(doc?.rss?.channel?.item);
  const atomEntries = asArray(doc?.feed?.entry);

  const items = [
    ...rssItems.map((it) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link) || text(it.guid),
      date: text(it.pubDate) || text(it['dc:date']),
      description: stripHtml(text(it.description) || text(it['content:encoded'])),
    })),
    ...atomEntries.map((it) => ({
      title: stripHtml(text(it.title)),
      link: atomLink(it),
      date: text(it.published) || text(it.updated),
      description: stripHtml(text(it.summary) || text(it.content)),
    })),
  ];

  return items
    .filter((it) => it.title && /^https?:\/\//.test(it.link))
    .map((it) => {
      const d = new Date(it.date);
      return {
        ...it,
        link: normalizeLink(it.link),
        date: Number.isNaN(d.getTime()) ? null : d.toISOString(),
        description: it.description.slice(0, 400),
      };
    });
}

async function download(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: res.ok ? await res.text() : '' };
}

function looksLikeFeed(body) {
  const head = body.slice(0, 1000).toLowerCase();
  return /<rss|<feed|<rdf:rdf/.test(head) && !/<html/.test(head);
}

// Um mesmo feed pode servir a vários temas (ex.: o RSS geral do gov.br): baixa
// uma vez só por execução. Devolve null quando o endereço não é um feed.
const feedCache = new Map();
function readFeed(url) {
  if (!feedCache.has(url)) {
    feedCache.set(url, download(url)
      .then(({ body }) => (looksLikeFeed(body) ? parseFeed(body) : null))
      .catch(() => null));
  }
  return feedCache.get(url);
}

// Feeds anunciados na página e, depois, os endereços mais comuns de RSS.
function feedCandidates(pageUrl, html) {
  const announced = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel=["']?alternate/i.test(tag) && /(rss|atom)\+xml/i.test(tag))
    .map((tag) => (tag.match(/href=["']([^"']+)/i) || [])[1])
    .filter(Boolean)
    .map((href) => { try { return new URL(href.replace(/&amp;/g, '&'), pageUrl).toString(); } catch { return null; } })
    .filter(Boolean);
  const { origin, pathname } = new URL(pageUrl);
  const dir = pathname.replace(/\/$/, '');
  const guesses = [`${origin}${dir}/feed/`, `${origin}/feed/`, `${origin}/rss`, `${origin}/rss.xml`, `${origin}/feed.xml`];
  return [...new Set([...announced, ...guesses])].slice(0, 6);
}

// Em portais que abrigam vários órgãos, o feed e a busca trazem matérias de
// todos: só valem as do órgão do link cadastrado (/mdic, /sde, ...).
const SHARED_HOSTS = new Set(['www.gov.br', 'www.ba.gov.br']);

function siteScope(pageUrl) {
  const { hostname, pathname } = new URL(pageUrl);
  const host = hostname.replace(/^www\./, '');
  const section = SHARED_HOSTS.has(hostname) ? pathname.split('/').filter(Boolean)[0] : null;
  return {
    query: `site:${host}${section ? `/${section}` : ''}`,
    accepts(link) {
      if (!section) return true;
      try {
        const u = new URL(link);
        return u.hostname.replace(/^www\./, '') === host && u.pathname.startsWith(`/${section}/`);
      } catch { return false; }
    },
  };
}

const hasFreshItem = (items) => items.some((it) => !it.date || Date.now() - new Date(it.date).getTime() <= config.maxItemAgeDays * 86400000);

// Tema do tipo "rss" cadastrado com o endereço de uma página comum: procura o
// feed do site e, sem nada recente, usa a busca do Bing restrita a ele.
async function fetchSite(url) {
  const pageUrl = normalizeLink(url);
  const page = await download(pageUrl).catch((err) => ({ status: err.message, body: '' }));
  const scope = siteScope(pageUrl);
  let stale = null;
  if (looksLikeFeed(page.body)) {
    const items = parseFeed(page.body);
    if (hasFreshItem(items)) return { items, via: 'feed' };
    stale = { items, via: 'feed sem matéria recente' };
  } else {
    for (const candidate of feedCandidates(pageUrl, page.body)) {
      const items = ((await readFeed(candidate)) || []).filter((it) => scope.accepts(it.link));
      if (hasFreshItem(items)) return { items, via: `feed ${candidate}` };
      if (items.length && !stale) stale = { items, via: `feed sem matéria recente ${candidate}` };
    }
  }
  const found = ((await readFeed(bing(scope.query))) || []).filter((it) => scope.accepts(it.link));
  if (found.length) return { items: found, via: `busca ${scope.query}` };
  if (stale) return stale;
  throw new Error(`sem feed e sem resultado na busca (página: ${page.status})`);
}

async function fetchSource(url) {
  if (/(^|\.)bing\.com$/.test(new URL(url).hostname)) return { items: await fetchFeed(url), via: 'busca' };
  return fetchSite(url);
}

export async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// Baixa cada fonte uma vez e devolve { feeds: {url: {items, error, via}}, bySector }.
// Poucas de cada vez: a EC2 é do ERP e cada site pode exigir vários downloads.
export async function fetchAllFeeds(sources) {
  const urls = [...new Set(Object.values(sources).flat())];
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        results.push([url, { ...(await fetchSource(url)), error: null }]);
      } catch (err) {
        results.push([url, { items: [], via: null, error: err.message }]);
      }
    }
  }));
  const feeds = Object.fromEntries(results);

  const bySector = {};
  for (const [sector, sectorUrls] of Object.entries(sources)) {
    bySector[sector] = sectorUrls.flatMap((url) => feeds[url].items.map((it) => ({ ...it, feed: url })));
  }
  return { feeds, bySector };
}
