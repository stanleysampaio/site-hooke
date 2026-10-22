/**
 * Gera as matérias do dia e envia ao worker como "pendentes" para aprovação.
 * Modo pesquisa: a manchete do RSS/Bing é só a pauta; o Gemini pesquisa o tema
 * no Google e escreve uma síntese de várias fontes. A imagem por IA só é gerada
 * depois que a notícia é aprovada (ou pelo botão do painel), para economizar.
 *
 *   node src/run.js                 execução normal (cron diário)
 *   node src/run.js --if-requested  só roda se alguém clicou "Gerar notícias agora" no painel
 *   node src/run.js --dry-run       não envia nada: grava matérias e imagens em ./out
 *   node src/run.js --check-sources testa os feeds e a extração de texto (não usa a IA)
 *   --limit N                       limita o total de matérias desta execução
 *   --sector "Fertilizantes"        gera só para um setor (nome igual ao de src/sources.js)
 *   --ignore-seen                   reavalia links já descartados (pendentes/publicados continuam fora)
 *   --watermark-existing            aplica a marca d'água nas imagens geradas antes dela existir
 *   --enrich-sources                completa título/portal/autor das fontes das notícias existentes
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { DEFAULT_EDITORIAS, DEFAULT_THEMES, buildCatalog, SECTOR_IMAGES } from './sources.js';
import { fetchAllFeeds } from './feeds.js';
import { fetchArticle, fetchSourceMeta } from './article.js';
import { generateJson, generateGroundedJson, resolveSourceUrl, generateImage } from './gemini.js';
import { optimizeImage, storeImage } from './images.js';
import { curationPrompt, researchPrompt, verifyPrompt, fixPrompt, imageBriefPrompt, imagePrompt, translationPrompt, TRANSLATION_LANGS, FRAMINGS, setRulesText } from './prompts.js';
import { getKnownLinks, getPublished, pushItems, takeRunRequest, reportRun, getQueue, saveImage, saveTranslation, getUnwatermarked, getAllItems, saveSources, getRules, getThemes } from './worker-api.js';
import { loadState, saveState, acquireLock, releaseLock } from './state.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const dryRun = flag('--dry-run');
const limitArg = args.indexOf('--limit');
const maxPerRun = limitArg >= 0 ? Number(args[limitArg + 1]) || config.maxPerRun : config.maxPerRun;
const sectorArg = args.indexOf('--sector');
const onlySector = sectorArg >= 0 ? args[sectorArg + 1] : null;
const ignoreSeen = flag('--ignore-seen');

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

function isRecent(item) {
  if (!item.date) return true; // sem data no feed: deixa a curadoria julgar
  return Date.now() - new Date(item.date).getTime() <= config.maxItemAgeDays * 86400000;
}

// Temas e fontes de pauta, editados no painel (tela "Temas e fontes"). Se o
// worker não responder, vale a lista de reserva de sources.js.
let catalog = buildCatalog(DEFAULT_EDITORIAS, DEFAULT_THEMES);

async function loadCatalog() {
  if (!config.ingestToken) return;
  try {
    const { editorias, themes } = await getThemes();
    if (editorias.length && themes.length) catalog = buildCatalog(editorias, themes);
  } catch (err) {
    log(`Temas do painel indisponíveis (${err.message}); usando a lista de reserva`);
  }
}

async function checkSources() {
  await loadCatalog();
  const { feeds } = await fetchAllFeeds(catalog.sources);
  for (const [url, { items, error }] of Object.entries(feeds)) {
    if (error) { log(`ERRO  ${url}: ${error}`); continue; }
    const newest = items.map((i) => i.date).filter(Boolean).sort().pop();
    let extraction = '-';
    if (items[0]) {
      try {
        const art = await fetchArticle(items[0].link);
        extraction = `${art.text.length} caracteres extraídos de "${items[0].title.slice(0, 60)}"`;
      } catch (err) {
        extraction = `falha ao ler matéria: ${err.message}`;
      }
    }
    log(`OK    ${url}: ${items.length} itens, mais recente ${newest || '?'}; ${extraction}`);
  }
}

async function collectCandidates(state, knownLinks) {
  const all = catalog.sources;
  const sources = onlySector ? { [onlySector]: all[onlySector] } : all;
  if (onlySector && !all[onlySector]) throw new Error(`Editoria desconhecida ou sem temas ativos: ${onlySector} (use: ${Object.keys(all).join(', ')})`);
  const { feeds, bySector } = await fetchAllFeeds(sources);
  Object.entries(feeds).filter(([, f]) => f.error).forEach(([url, f]) => log(`Feed com erro: ${url} (${f.error})`));

  const known = new Set(knownLinks);
  const index = {};
  const forPrompt = {};
  let nextId = 0;
  for (const [sector, items] of Object.entries(bySector)) {
    // Até 5 por fonte: sem isso, um portal que publica dezenas por dia (ex.:
    // Globo Rural) ocupa todas as vagas e as buscas específicas nem chegam à IA.
    const perFeed = {};
    const seenLinks = new Set();
    const fresh = items
      .filter((it) => isRecent(it) && (ignoreSeen || !state.seen.has(it.link)) && !known.has(it.link))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .filter((it) => {
        if (seenLinks.has(it.link) || (perFeed[it.feed] || 0) >= 5) return false;
        seenLinks.add(it.link);
        perFeed[it.feed] = (perFeed[it.feed] || 0) + 1;
        return true;
      })
      .slice(0, 20);
    if (!fresh.length) continue;
    forPrompt[sector] = fresh.map((it) => {
      const id = nextId++;
      const theme = catalog.themeByKey[`${sector}|${it.feed}`] || {};
      index[id] = { ...it, sector, themeId: theme.id || null };
      const c = { id, title: it.title, description: it.description.slice(0, 250), date: it.date, source: new URL(it.link).hostname };
      // Temas marcados como prioritários no painel: a curadoria escolhe esses primeiro.
      if (theme.priority) c.temaPrioritario = theme.label;
      return c;
    });
  }
  return { index, forPrompt };
}

// Redes sociais não entram como fonte citada (a pesquisa às vezes cai nelas).
const SOCIAL_HOSTS = /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|linkedin|threads|whatsapp|t)\.(com|me)$|(^|\.)youtu\.be$/;

// Fontes consultadas pela pesquisa + a matéria que originou a pauta, sem repetir domínio.
async function collectSources(candidate, origin, grounded) {
  const resolved = await Promise.all(grounded.slice(0, 10).map(async (s) => ({
    title: s.title,
    url: await resolveSourceUrl(s.uri),
  })));
  const picked = [];
  const hosts = new Set([new URL(candidate.link).hostname.replace(/^www\./, '')]);
  for (const s of resolved) {
    if (!s.url) continue;
    let host;
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (hosts.has(host) || SOCIAL_HOSTS.test(host)) continue;
    hosts.add(host);
    picked.push(s.url);
  }
  // Título, portal e autor de cada fonte, como o próprio site publica.
  const metas = await Promise.all(picked.slice(0, 7).map(async (url) => ({ url, ...(await fetchSourceMeta(url)) })));
  return [
    { url: candidate.link, title: origin.title || candidate.title, site: origin.siteName, author: origin.author || '' },
    ...metas.map((m) => ({ url: m.url, title: m.title, site: m.siteName, author: m.author })),
  ];
}

// Matéria só sai com fonte principal legível (texto mínimo), pelo menos 2
// fontes complementares independentes e checagem de fatos aprovada.
const MIN_MAIN_SOURCE_CHARS = 800;
const MIN_COMPLEMENTARY_SOURCES = 2;

// Limpa o JSON da IA: intertítulos nas pontas, links internos inválidos,
// formatação fora do corpo. Devolve null se a matéria veio incompleta.
function normalizeArticle(written, related) {
  const body = (Array.isArray(written.body) ? written.body : []).map((p) => String(p).trim()).filter(Boolean);
  if (!written.title || body.filter((p) => !p.startsWith('## ')).length < 4) return null;
  // Intertítulo solto no início ou no fim não faz sentido.
  while (body.length && body[0].startsWith('## ')) body.shift();
  while (body.length && body[body.length - 1].startsWith('## ')) body.pop();
  const plain = (s) => String(s || '').replace(/\*\*/g, '').replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, '$1').trim();
  // Links internos: só para notícias publicadas de verdade, no máximo 2.
  const relatedIds = new Set((related || []).map((r) => r.id));
  let links = 0;
  for (let i = 0; i < body.length; i++) {
    body[i] = body[i].replace(/\[\[([^|\]]+)\|([^\]]*)\]\]/g, (m, text, id) => {
      if (relatedIds.has(id.trim()) && links < 2) { links++; return `[[${text}|${id.trim()}]]`; }
      return text;
    });
  }
  return {
    title: plain(written.title),
    excerpt: plain(written.excerpt) || plain(body[0]).slice(0, 200),
    body,
    imagePrompt: String(written.imagePrompt || '').trim(),
    imageAlt: String(written.imageAlt || '').trim(),
  };
}

async function checkFacts(article, sourceText) {
  const { json } = await generateGroundedJson(verifyPrompt({ article, sourceText }), { temperature: 0.1 });
  return (Array.isArray(json.unsupported) ? json.unsupported : []).filter((u) => u && u.trecho);
}

async function buildArticle(candidate, related) {
  // 1. Fonte principal: a reportagem original, lida na íntegra. Sem ela, nada.
  let source;
  try {
    source = await fetchArticle(candidate.link);
  } catch (err) {
    // 4xx (bloqueio, página removida) não melhora amanhã: descarta de vez.
    // Timeout/5xx sobem como erro e o link é tentado de novo na próxima execução.
    if (/^HTTP 4\d\d$/.test(err.message)) return { skip: `fonte principal recusou a leitura (${err.message})` };
    throw err;
  }
  if (source.text.length < MIN_MAIN_SOURCE_CHARS) {
    return { skip: `fonte principal curta demais para servir de base (${source.text.length} caracteres)` };
  }
  const sourceText = source.text.slice(0, 8000);
  const origin = { siteName: source.siteName, title: source.title, author: source.author };

  // 2. Pesquisa + redação.
  const { json: written, sources: grounded, queries } = await generateGroundedJson(researchPrompt({
    sector: candidate.sector,
    title: candidate.title,
    description: candidate.description,
    link: candidate.link,
    date: candidate.date,
    sourceText,
    related,
  }));
  if (written.skip) return { skip: `IA descartou: ${written.reason || 'sem motivo'}` };
  let article = normalizeArticle(written, related);
  if (!article) return { skip: 'IA devolveu matéria incompleta' };

  // 3. Fontes complementares independentes.
  const sources = await collectSources(candidate, origin, grounded);
  if (sources.length - 1 < MIN_COMPLEMENTARY_SOURCES) {
    return { skip: `só ${sources.length - 1} fonte(s) complementar(es) (mínimo ${MIN_COMPLEMENTARY_SOURCES}; ${queries.length} buscas)` };
  }

  // 4. Checagem de fatos; se apontar algo, reescreve sem esses trechos e checa de novo.
  let issues = await checkFacts(article, sourceText);
  const initialIssues = issues.length;
  if (issues.length) {
    log(`    checagem: ${issues.length} trecho(s) sem comprovação; reescrevendo`);
    const fixed = normalizeArticle(await generateJson(fixPrompt({ article, unsupported: issues, sourceText }), { temperature: 0.2 }), related);
    if (!fixed) return { skip: 'reescrita após a checagem veio incompleta' };
    article = fixed;
    issues = await checkFacts(article, sourceText);
    if (issues.length) {
      return { skip: `checagem de fatos reprovou: ${issues.map((i) => `"${String(i.trecho).slice(0, 60)}"`).join('; ')}` };
    }
  }

  return {
    item: {
      id: randomUUID(),
      sector: candidate.sector,
      themeId: candidate.themeId || null,
      title: article.title,
      excerpt: article.excerpt,
      summary: article.excerpt,
      body: article.body,
      link: candidate.link,
      sourceName: origin.siteName,
      sources: sources.map((s, i) => ({ ...s, role: i === 0 ? 'principal' : 'complementar' })),
      sourceDate: candidate.date || source.publishedTime || null,
      verification: { checkedAt: new Date().toISOString(), initialIssues, rewritten: initialIssues > 0 },
      // Imagem por IA só depois da aprovação (ou pelo botão do painel): até lá, foto do setor.
      image: SECTOR_IMAGES[candidate.sector] || '/img/atuacao.jpg',
      imageAlt: '',
      imageGenerated: false,
      imagePrompt: article.imagePrompt,
      imagePromptAlt: article.imageAlt,
      createdAt: new Date().toISOString(),
    },
  };
}

// Atende os pedidos do painel: imagens (aprovação ou botão "Gerar imagem por
// IA") e traduções (aprovação ou edição de notícia publicada).
async function processQueue() {
  const { images, translations } = await getQueue();
  if (images.length) await processImages(images);
  if (translations.length) await processTranslations(translations);
}

async function processTranslations(queue) {
  log(`${queue.length} tradução(ões) pedida(s) no painel`);
  for (const item of queue.slice(0, 10)) {
    try {
      const out = await generateJson(translationPrompt(item), { temperature: 0.2, apiKey: config.geminiTranslateKey });
      const translations = {};
      for (const code of Object.keys(TRANSLATION_LANGS)) {
        const t = out[code];
        if (!t || !t.title || !Array.isArray(t.body) || t.body.length !== (item.body || []).length) {
          throw new Error(`tradução incompleta para ${code}`);
        }
        translations[code] = {
          sector: String(t.sector || '').trim() || undefined,
          title: String(t.title), excerpt: String(t.excerpt || ''),
          body: t.body.map(String), imageAlt: String(t.imageAlt || ''),
        };
      }
      await saveTranslation({ id: item.id, translations });
      log(`    traduzida: "${item.title.slice(0, 70)}"`);
    } catch (err) {
      // 429 = cota grátis do dia acabou: deixa na fila para a próxima rodada.
      if (/ 429:/.test(err.message)) { log('    cota de tradução esgotada; fica para a próxima rodada'); return; }
      log(`    falha na tradução de "${item.title.slice(0, 60)}": ${err.message.slice(0, 200)}`);
      await saveTranslation({ id: item.id, failed: true, error: err.message.slice(0, 200) }).catch(() => {});
    }
  }
}

async function processImages(queue) {
  log(`${queue.length} imagem(ns) pedida(s) no painel`);
  // Descrições das últimas imagens publicadas (para não repetir composição) e
  // enquadramento alternado a cada imagem.
  const recent = (await getPublished().catch(() => []))
    .filter((it) => it.imageGenerated && it.imagePrompt).slice(0, 8).map((it) => it.imagePrompt.slice(0, 220));
  let framingIndex = Math.floor(Math.random() * FRAMINGS.length);
  for (const item of queue.slice(0, 10)) {
    try {
      let brief = item.imagePrompt;
      let alt = item.imagePromptAlt || item.imageAlt || '';
      if (!brief) {
        const r = await generateJson(imageBriefPrompt(item), { temperature: 0.4 });
        brief = r.imagePrompt;
        alt = alt || r.imageAlt || '';
      }
      const framing = FRAMINGS[framingIndex++ % FRAMINGS.length];
      const avoid = recent.filter((r) => r !== (brief || '').slice(0, 220));
      const { buffer, model } = await generateImage(imagePrompt(brief || `${item.sector} industrial plant in Brazil`, { framing, avoid }));
      recent.unshift((brief || '').slice(0, 220));
      // Nome novo a cada geração: o CloudFront guarda a versão anterior em cache.
      const image = await storeImage(`${item.id}-${Date.now().toString(36)}`, await optimizeImage(buffer), { dryRun: false });
      await saveImage({ id: item.id, image, imageAlt: alt });
      log(`    imagem pronta (${model}): "${item.title.slice(0, 70)}"`);
    } catch (err) {
      log(`    falha na imagem de "${item.title.slice(0, 60)}": ${err.message.slice(0, 200)}`);
      await saveImage({ id: item.id, failed: true, error: err.message.slice(0, 200) }).catch(() => {});
    }
  }
}

async function generateNews(state, items, errors) {
  const knownLinks = dryRun ? [] : await getKnownLinks();
  const { index, forPrompt } = await collectCandidates(state, knownLinks);
  const total = Object.values(forPrompt).flat().length;
  log(`${total} candidatos novos em ${Object.keys(forPrompt).length} setores`);
  if (!total) return;

  const limitFor = (sector) => (catalog.limits[sector] !== undefined ? catalog.limits[sector] : config.maxPerSector);
  const picks = await generateJson(curationPrompt(forPrompt, Math.max(config.maxPerSector, ...Object.values(catalog.limits))), { temperature: 0.2 });
  const ranked = (Array.isArray(picks) ? picks : []).filter((p) => index[p.id] && index[p.id].sector === p.sector);
  log(`Curadoria escolheu ${ranked.length} candidatos`);

  // Tudo que a curadoria viu e não escolheu não precisa ser reavaliado amanhã.
  const pickedIds = new Set(ranked.map((p) => p.id));
  Object.entries(index).forEach(([id, c]) => { if (!pickedIds.has(Number(id))) state.seen.add(c.link); });

  // Notícias já publicadas, para links internos quando houver relação direta.
  const related = dryRun ? [] : (await getPublished().catch(() => []))
    .slice(0, 40).map((it) => ({ id: it.id, title: it.title, sector: it.sector }));

  const perSector = {};
  const usedLinks = new Set();
  for (const pick of ranked) {
    if (items.length >= maxPerRun) break;
    const candidate = index[pick.id];
    if ((perSector[candidate.sector] || 0) >= limitFor(candidate.sector) || usedLinks.has(candidate.link)) continue;
    usedLinks.add(candidate.link);

    log(`[${candidate.sector}] ${candidate.title.slice(0, 80)}`);
    try {
      const result = await buildArticle(candidate, related);
      state.seen.add(candidate.link);
      if (result.skip) { log(`    descartada: ${result.skip}`); continue; }
      items.push(result.item);
      perSector[candidate.sector] = (perSector[candidate.sector] || 0) + 1;
      const words = result.item.body.join(' ').split(/\s+/).length;
      const internal = (result.item.body.join(' ').match(/\[\[/g) || []).length;
      log(`    ok: "${result.item.title}" (${result.item.body.length} blocos, ${words} palavras, ${result.item.sources.length} fontes, ${internal} link(s) interno(s))`);
    } catch (err) {
      // Erro de rede/IA: não marca como visto, para tentar de novo na próxima execução.
      errors.push(`${candidate.link}: ${err.message.slice(0, 200)}`);
      log(`    erro: ${err.message.slice(0, 300)}`);
    }
  }

  if (dryRun) {
    await fs.mkdir(config.outDir, { recursive: true });
    const file = path.join(config.outDir, 'items.json');
    await fs.writeFile(file, JSON.stringify(items, null, 2));
    log(`Dry-run: ${items.length} matérias gravadas em ${file}`);
    return;
  }

  if (items.length) {
    const { added } = await pushItems(items);
    log(`${added} matérias enviadas ao painel como pendentes`);
  }
  saveState(state);
}

// Aplica a marca d'água nas imagens por IA geradas antes dela existir (uma vez só).
async function watermarkExisting() {
  const items = await getUnwatermarked();
  log(`${items.length} imagem(ns) sem marca d'água`);
  for (const item of items) {
    const res = await fetch(config.siteUrl + item.image, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) { log(`    ${item.image}: HTTP ${res.status}`); continue; }
    const image = await storeImage(`${item.id}-${Date.now().toString(36)}`, await optimizeImage(Buffer.from(await res.arrayBuffer())), { dryRun: false });
    await saveImage({ id: item.id, image });
    log(`    ok: "${item.title.slice(0, 70)}"`);
  }
}

// Completa título, portal e autor das fontes das notícias que já existem
// (geradas antes dessa informação ser guardada).
async function enrichSources() {
  const { pending, published } = await getAllItems();
  for (const item of [...published, ...pending]) {
    const list = Array.isArray(item.sources) && item.sources.length ? item.sources : item.link ? [{ url: item.link }] : [];
    if (!list.length || list.every((s) => s.site)) continue;
    const sources = await Promise.all(list.map(async (s) => {
      const m = await fetchSourceMeta(s.url);
      return { url: s.url, title: m.title || s.title || '', site: m.siteName, author: m.author };
    }));
    await saveSources(item.id, sources);
    log(`    ${sources.length} fonte(s), ${sources.filter((s) => s.author).length} com autor: "${item.title.slice(0, 60)}"`);
  }
}

async function main() {
  if (flag('--check-sources')) return checkSources();
  if (flag('--watermark-existing')) return watermarkExisting();
  if (flag('--enrich-sources')) return enrichSources();
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY não configurada (veja .env.example)');
  if (!acquireLock()) { log('Outra execução já está em andamento; saindo.'); return; }

  const startedAt = new Date().toISOString();
  const errors = [];
  const items = [];
  let generated = false;

  try {
    // Regras editoriais do painel; se o worker não responder, vale o arquivo local.
    if (config.ingestToken) {
      try { setRulesText(await getRules()); } catch (err) { log(`Regras do painel indisponíveis (${err.message}); usando o arquivo local`); }
    }
    await loadCatalog();
    // A fila do painel é atendida em toda execução (inclusive a de 5 em 5 minutos).
    if (!dryRun) await processQueue();
    if (flag('--if-requested') && !(await takeRunRequest())) return;

    generated = true;
    await generateNews(loadState(), items, errors);
  } catch (err) {
    errors.push(err.message);
    throw err;
  } finally {
    releaseLock();
    if (generated && !dryRun && config.ingestToken) {
      await reportRun({ startedAt, finishedAt: new Date().toISOString(), generated: items.length, errors: errors.slice(0, 10) })
        .catch((e) => log(`Não foi possível registrar a execução no worker: ${e.message}`));
    }
  }
}


main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
