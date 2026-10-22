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
  { name: 'Mineração', maxPerRun: 1 },
  { name: 'Cimento', maxPerRun: 1 },
  { name: 'Petróleo e Gás', maxPerRun: 1 },
  { name: 'Fertilizantes', maxPerRun: 1 },
  { name: 'Metalurgia', maxPerRun: 1 },
  { name: 'Refrigeração', maxPerRun: 1 },
  { name: 'Alimentícia', maxPerRun: 1 },
  { name: 'Siderurgia', maxPerRun: 1 },
  // Editorias regionais (prioridade editorial da Hooke: Bahia e Minas Gerais).
  { name: 'Indústria BA e MG', maxPerRun: 2 },
  { name: 'Infraestrutura', maxPerRun: 1 },
];

const AGENCIA_BRASIL = 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml';
const t = (editoria, kind, value, priority = false) => ({ editoria, kind, value, priority });

export const DEFAULT_THEMES = [
  t('Mineração', 'rss', 'https://mineracaobrasil.com/feed/'),
  t('Mineração', 'rss', 'https://www.brasilmineral.com.br/feed'),
  t('Mineração', 'rss', 'https://revistaminerios.com.br/feed/'),
  t('Mineração', 'busca', 'mineração mineradora'),
  t('Mineração', 'busca', 'mineração Bahia', true),
  t('Mineração', 'busca', 'mineração Minas Gerais', true),

  t('Cimento', 'rss', 'https://www.cimentoitambe.com.br/feed/'),
  t('Cimento', 'busca', 'indústria do cimento'),
  t('Cimento', 'busca', 'cimenteira fábrica de cimento'),

  t('Petróleo e Gás', 'rss', 'https://petronoticias.com.br/feed/'),
  t('Petróleo e Gás', 'rss', AGENCIA_BRASIL),
  t('Petróleo e Gás', 'busca', 'petróleo e gás Petrobras'),
  t('Petróleo e Gás', 'busca', 'petróleo gás Bahia', true),
  t('Petróleo e Gás', 'busca', 'petróleo gás Minas Gerais', true),

  t('Fertilizantes', 'rss', 'https://globorural.globo.com/rss/globorural/'),
  t('Fertilizantes', 'rss', AGENCIA_BRASIL),
  t('Fertilizantes', 'busca', 'fertilizantes indústria'),
  t('Fertilizantes', 'busca', 'fertilizantes potássio fosfato nitrogenados'),
  t('Fertilizantes', 'busca', 'fábrica de fertilizantes'),
  t('Fertilizantes', 'busca', 'fertilizantes Bahia', true),
  t('Fertilizantes', 'busca', 'fertilizantes Minas Gerais', true),

  t('Metalurgia', 'busca', 'metalurgia indústria'),
  t('Metalurgia', 'busca', 'metalúrgica fundição'),

  t('Refrigeração', 'rss', 'https://revistadofrio.com.br/feed/'),
  t('Refrigeração', 'rss', 'https://refrigeracao.net/feed/'),
  t('Refrigeração', 'busca', 'refrigeração industrial'),

  t('Alimentícia', 'rss', 'https://www.foodconnection.com.br/feed/'),
  t('Alimentícia', 'rss', 'https://www.abia.org.br/feed'),
  t('Alimentícia', 'busca', 'indústria de alimentos'),

  t('Siderurgia', 'rss', 'https://www.siderurgiabrasil.com.br/feed/'),
  t('Siderurgia', 'busca', 'siderurgia aço'),

  t('Indústria BA e MG', 'busca', 'indústria Bahia investimentos', true),
  t('Indústria BA e MG', 'busca', 'indústria Minas Gerais investimentos', true),
  t('Indústria BA e MG', 'busca', 'Polo Industrial de Camaçari', true),
  t('Indústria BA e MG', 'busca', 'FIEB Federação das Indústrias da Bahia', true),
  t('Indústria BA e MG', 'busca', 'empresas chinesas Bahia', true),

  t('Infraestrutura', 'busca', 'ponte Salvador Itaparica', true),
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
  'Mineração': '/img/services-1.png',
  'Cimento': '/img/services-2.png',
  'Petróleo e Gás': '/img/services-3.png',
  'Fertilizantes': '/img/services-4.png',
  'Metalurgia': '/img/services-5.png',
  'Refrigeração': '/img/services-6.png',
  'Alimentícia': '/img/services-7.png',
  'Siderurgia': '/img/services-8.png',
};
