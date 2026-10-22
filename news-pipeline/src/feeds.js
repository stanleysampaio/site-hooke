import { XMLParser } from 'fast-xml-parser';
import { config } from './config.js';

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

export async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

// Baixa cada feed uma vez e devolve { feeds: {url: {items, error}}, bySector }.
export async function fetchAllFeeds(sources) {
  const urls = [...new Set(Object.values(sources).flat())];
  const results = await Promise.all(urls.map(async (url) => {
    try {
      return [url, { items: await fetchFeed(url), error: null }];
    } catch (err) {
      return [url, { items: [], error: err.message }];
    }
  }));
  const feeds = Object.fromEntries(results);

  const bySector = {};
  for (const [sector, sectorUrls] of Object.entries(sources)) {
    bySector[sector] = sectorUrls.flatMap((url) => feeds[url].items.map((it) => ({ ...it, feed: url })));
  }
  return { feeds, bySector };
}
