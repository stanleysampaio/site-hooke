// Temas e fontes de pauta. Desde 22/10/2026 a equipe gerencia isso no painel
// (tela "Temas e fontes"); o gerador lê de /api/ingest/themes a cada execução.
// A lista abaixo é só a SEMENTE inicial do banco (worker/scripts/seed-themes.mjs)
// e a RESERVA usada se o painel não responder.
//
// Cada tema é uma busca no Bing Notícias ("busca": termo de pesquisa, ordenado
// por data e restrito ao Brasil) ou o RSS de um portal ("rss": endereço do feed).
// Portais que bloqueiam acessos vindos da AWS (Metalurgia.com.br, Indústria
// Hoje, ABCP e as matérias do Canal Rural respondem 403 a partir da EC2) ficaram
// de fora; as buscas cobrem esses setores.

export const DEFAULT_EDITORIAS = [
  // Os 5 segmentos da apresentação institucional (mesmos da página Soluções).
  { name: 'Química e Petroquímica', maxPerRun: 2 },
  { name: 'Alimentícia e Bebidas', maxPerRun: 2 },
  { name: 'Papel e Celulose', maxPerRun: 2 },
  { name: 'Mineração e Siderurgia', maxPerRun: 2 },
  { name: 'Energia e Utilities', maxPerRun: 2 },
];

const AGENCIA_BRASIL = 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml';
const t = (editoria, kind, value, priority = false) => ({ editoria, kind, value, priority });

// Prioridade editorial da Hooke: Bahia e Minas Gerais (buscas com priority).
export const DEFAULT_THEMES = [
  t('Química e Petroquímica', 'rss', 'https://petronoticias.com.br/feed/'),
  t('Química e Petroquímica', 'rss', AGENCIA_BRASIL),
  t('Química e Petroquímica', 'busca', 'indústria química petroquímica'),
  t('Química e Petroquímica', 'busca', 'petróleo e gás Petrobras'),
  t('Química e Petroquímica', 'busca', 'fertilizantes indústria'),
  t('Química e Petroquímica', 'busca', 'fábrica de fertilizantes'),
  t('Química e Petroquímica', 'busca', 'Polo Industrial de Camaçari', true),
  t('Química e Petroquímica', 'busca', 'química petroquímica Bahia', true),
  t('Química e Petroquímica', 'busca', 'petróleo gás Bahia', true),
  t('Química e Petroquímica', 'busca', 'fertilizantes Minas Gerais', true),

  t('Alimentícia e Bebidas', 'rss', 'https://www.foodconnection.com.br/feed/'),
  t('Alimentícia e Bebidas', 'rss', 'https://www.abia.org.br/feed'),
  t('Alimentícia e Bebidas', 'busca', 'indústria de alimentos'),
  t('Alimentícia e Bebidas', 'busca', 'indústria de bebidas fábrica cervejaria'),
  t('Alimentícia e Bebidas', 'busca', 'indústria alimentos bebidas Bahia', true),
  t('Alimentícia e Bebidas', 'busca', 'indústria alimentos bebidas Minas Gerais', true),

  t('Papel e Celulose', 'busca', 'papel e celulose indústria'),
  t('Papel e Celulose', 'busca', 'fábrica de celulose investimento'),
  t('Papel e Celulose', 'busca', 'celulose Bahia', true),
  t('Papel e Celulose', 'busca', 'celulose Minas Gerais', true),

  t('Mineração e Siderurgia', 'rss', 'https://mineracaobrasil.com/feed/'),
  t('Mineração e Siderurgia', 'rss', 'https://www.brasilmineral.com.br/feed'),
  t('Mineração e Siderurgia', 'rss', 'https://revistaminerios.com.br/feed/'),
  t('Mineração e Siderurgia', 'rss', 'https://www.siderurgiabrasil.com.br/feed/'),
  t('Mineração e Siderurgia', 'busca', 'mineração mineradora'),
  t('Mineração e Siderurgia', 'busca', 'siderurgia aço'),
  t('Mineração e Siderurgia', 'busca', 'indústria do cimento'),
  t('Mineração e Siderurgia', 'busca', 'metalúrgica fundição'),
  t('Mineração e Siderurgia', 'busca', 'mineração Bahia', true),
  t('Mineração e Siderurgia', 'busca', 'mineração Minas Gerais', true),
  t('Mineração e Siderurgia', 'busca', 'siderurgia Minas Gerais', true),

  t('Energia e Utilities', 'rss', 'https://revistadofrio.com.br/feed/'),
  t('Energia e Utilities', 'busca', 'energia indústria subestação geração'),
  t('Energia e Utilities', 'busca', 'refrigeração industrial'),
  t('Energia e Utilities', 'busca', 'hidrogênio verde'),
  t('Energia e Utilities', 'busca', 'energia eólica solar Bahia', true),
  t('Energia e Utilities', 'busca', 'energia Minas Gerais indústria', true),
];

// Busca no Bing Notícias: ordenada por data e restrita ao Brasil/pt-BR. O link
// de cada item aponta para o Bing (apiclick.aspx?url=...) e é desembrulhado em feeds.js.
export function bing(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'rss',
    setlang: 'pt-BR',
    cc: 'BR',
    qft: 'sortbydate="1"',
  });
  return `https://www.bing.com/news/search?${params}`;
}

export function themeUrl(theme) {
  return theme.kind === 'busca' ? bing(theme.value) : theme.value;
}

// Monta o que o pipeline usa a partir das editorias e temas (do painel ou da
// reserva acima): fontes por editoria, limite diário de cada uma e, por
// editoria + endereço, o tema de origem (para as estatísticas do painel) e se
// ele é prioritário.
export function buildCatalog(editorias, themes) {
  const activeEditorias = editorias.filter((e) => e.active !== false);
  const names = new Set(activeEditorias.map((e) => e.name));
  const sources = {};
  const limits = {};
  const themeByKey = {};
  for (const e of activeEditorias) {
    sources[e.name] = [];
    limits[e.name] = Number.isFinite(e.maxPerRun) ? e.maxPerRun : 1;
  }
  for (const th of themes) {
    if (th.active === false || !names.has(th.editoria)) continue;
    const url = themeUrl(th);
    if (!sources[th.editoria].includes(url)) sources[th.editoria].push(url);
    themeByKey[`${th.editoria}|${url}`] = { id: th.id || null, priority: !!th.priority, label: th.value };
  }
  for (const name of Object.keys(sources)) if (!sources[name].length) delete sources[name];
  return { sources, limits, themeByKey };
}

// Foto própria da Hooke por setor (as mesmas da página de Soluções): usada
// até a imagem por IA ficar pronta.
export const SECTOR_IMAGES = {
  'Química e Petroquímica': '/img/services-3.png',
  'Alimentícia e Bebidas': '/img/services-7.png',
  'Papel e Celulose': '/img/services-4.png',
  'Mineração e Siderurgia': '/img/services-1.png',
  'Energia e Utilities': '/img/services-6.png',
};
