// Prompts da Gemini. As regras EDITORIAIS (o que escolher, como escrever,
// formatar, ilustrar e traduzir) ficam em ../regras-editoriais.md, que a equipe
// edita sem mexer em código. Aqui fica só a parte técnica: os dados de cada
// pedido e o formato JSON da resposta, que o resto do pipeline depende.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const RULES_FILE = path.join(config.root, 'regras-editoriais.md');

// Texto das regras editado no painel (carregado do worker no início de cada
// execução por setRulesText). Sem ele, vale o arquivo local.
let rulesText = null;
export function setRulesText(text) {
  rulesText = text && text.trim() ? text : null;
}

// Separa as seções "## Nome" das regras.
function rules() {
  const text = (rulesText || fs.readFileSync(RULES_FILE, 'utf8')).replace(/\r\n/g, '\n');
  const sections = {};
  let current = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { current = h[1].toLowerCase(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  const get = (name) => {
    const s = sections[name];
    if (!s) throw new Error(`regras-editoriais.md sem a seção "## ${name}"`);
    return s.join('\n').trim();
  };
  return {
    perfil: get('perfil'),
    curadoria: get('curadoria'),
    pesquisa: get('pesquisa'),
    redacao: get('redação'),
    fontes: get('fontes'),
    verificacao: get('verificação'),
    formatacao: get('formatação'),
    links: get('links internos'),
    imagem: get('imagem'),
    traducao: get('tradução'),
  };
}

export function curationPrompt(candidatesBySector, maxPerSector) {
  const r = rules();
  const picks = maxPerSector + 2; // reservas, caso a matéria escolhida não possa ser lida
  return `Você é o editor do blog de notícias da Hooke.

${r.perfil}

Abaixo há candidatos a notícia agrupados por setor/editoria. Para CADA um, escolha até ${picks}
notícias, em ordem de prioridade, seguindo estas regras (candidatos com "temaPrioritario" vieram de
um tema marcado como prioritário pela equipe: entre opções de qualidade parecida, prefira esses):

${r.curadoria}

Responda com um JSON array no formato:
[{"sector": "<nome exato do setor>", "id": <id do candidato>}]

Candidatos por setor:
${JSON.stringify(candidatesBySector)}`;
}

function relatedSection(r, related) {
  if (!related || !related.length) return '';
  return `
LINKS INTERNOS
${r.links}
Formato técnico: [[trecho do texto|ID]], dentro de "body" (ex.: "a [[nova fábrica da Atlas Agro|<id>]]").
Notícias já publicadas:
${JSON.stringify(related)}
`;
}

// Modo pesquisa: a manchete é só o ponto de partida; o modelo pesquisa o tema
// no Google e escreve uma síntese própria de várias fontes.
export function researchPrompt({ sector, title, description, link, date, sourceText, related }) {
  const r = rules();
  return `Você é redator do blog de notícias da Hooke.

${r.perfil}

PESQUISA
${r.pesquisa}

FONTES
${r.fontes}

REDAÇÃO
${r.redacao}

FORMATAÇÃO (só dentro de "body")
${r.formatacao}
Formato técnico: negrito com **dois asteriscos**; cada intertítulo é um item próprio do array
"body" começando com "## " (ex.: "## Investimento e prazos").

IMAGEM (campos "imagePrompt" e "imageAlt")
${r.imagem}
"imagePrompt": a descrição da foto EM INGLÊS. "imageAlt": descrição curta da imagem em português,
para acessibilidade.
${relatedSection(r, related)}
Se for para descartar o tema, responda {"skip": true, "reason": "..."}.
Senão, responda com um JSON no formato:
{"title": "...", "excerpt": "...", "body": ["parágrafo 1", "## Intertítulo", "parágrafo 2", "..."], "imagePrompt": "...", "imageAlt": "..."}

PONTO DE PARTIDA
Setor: ${sector}
Manchete: ${title}
Resumo: ${description || '(sem resumo)'}
Link: ${link}${date ? `\nData: ${date}` : ''}

FONTE PRINCIPAL (texto integral da reportagem original):
${sourceText}`;
}

// Checagem de fatos da matéria escrita (com busca no Google ligada).
export function verifyPrompt({ article, sourceText }) {
  const r = rules();
  return `${r.verificacao}

Responda com um JSON no formato:
{"unsupported": [{"trecho": "<trecho exato da matéria>", "motivo": "<por que não está comprovado>"}]}
Se tudo estiver comprovado, responda {"unsupported": []}.

FONTE PRINCIPAL:
${sourceText}

MATÉRIA A CHECAR:
${JSON.stringify({ title: article.title, excerpt: article.excerpt, body: article.body })}`;
}

// Reescrita depois da checagem: remove ou corrige só os trechos apontados.
export function fixPrompt({ article, unsupported, sourceText }) {
  const r = rules();
  return `A matéria abaixo foi checada e tem trechos SEM COMPROVAÇÃO. Reescreva-a removendo esses
trechos ou trocando-os pelo que a fonte principal realmente diz. Não acrescente nenhum fato novo.
Mantenha o resto do texto, o tom, a formatação (**negrito**, intertítulos "## ", links [[trecho|ID]])
e as regras de redação:
${r.redacao}

Trechos sem comprovação:
${JSON.stringify(unsupported)}

FONTE PRINCIPAL:
${sourceText}

Responda com o mesmo JSON da matéria:
{"title": "...", "excerpt": "...", "body": ["..."], "imagePrompt": "...", "imageAlt": "..."}

MATÉRIA:
${JSON.stringify(article)}`;
}

// Idiomas do seletor do site (js/i18n.js), além do pt-BR original.
export const TRANSLATION_LANGS = {
  'pt-PT': 'português de Portugal',
  en: 'inglês',
  es: 'espanhol',
  'zh-CN': 'chinês simplificado',
};

export function translationPrompt(item) {
  const r = rules();
  const source = { sector: item.sector || '', title: item.title, excerpt: item.excerpt || '', body: item.body || [], imageAlt: item.imageAlt || '' };
  return `Traduza a notícia abaixo, escrita em português do Brasil para um público de engenharia
industrial, para estes idiomas:
${Object.entries(TRANSLATION_LANGS).map(([code, name]) => `- "${code}": ${name}`).join('\n')}

Regras:
${r.traducao}

Regras técnicas (obrigatórias):
- "body" deve ter exatamente ${source.body.length} itens, na mesma ordem do original.
- Itens que começam com "## " são intertítulos: traduza o texto e mantenha o "## ".
- Trechos entre **dois asteriscos** continuam em negrito nos mesmos pontos.
- Links internos no formato [[trecho|ID]]: traduza só o trecho e mantenha o ID exatamente igual.

Responda com um JSON no formato:
{${Object.keys(TRANSLATION_LANGS).map((c) => `"${c}": {"sector": "...", "title": "...", "excerpt": "...", "body": ["..."], "imageAlt": "..."}`).join(', ')}}
("sector" é o nome da editoria; traduza de forma curta, como um rótulo de seção de portal.)

Notícia:
${JSON.stringify(source)}`;
}

// Para notícias sem imagePrompt guardado: descreve a foto a partir do texto.
export function imageBriefPrompt({ sector, title, excerpt }) {
  const r = rules();
  return `Descreva EM INGLÊS, em 1 ou 2 frases, a foto que vai ilustrar esta notícia do setor "${sector}".
Regras da imagem:
${r.imagem}
Responda com um JSON: {"imagePrompt": "...", "imageAlt": "<descrição curta em português>"}

Título: ${title}
Resumo: ${excerpt || ''}`;
}

// Enquadramentos alternados entre as imagens, para o feed não ficar repetitivo.
export const FRAMINGS = [
  'aerial drone view of the site or plant',
  'close-up of a key piece of equipment or component, shallow depth of field',
  'control room with operators seen from behind, screens without readable text',
  'workers in full PPE seen from behind or at a distance, mid-action',
  'exterior wide shot at golden hour',
  'macro detail of the material, product or process flow',
  'technical inspection or laboratory scene',
  'construction or assembly scene with crane and steel structures',
];

// Pedido final ao modelo de imagem: a descrição da notícia + enquadramento +
// regras de estilo + o que evitar (descrições das últimas imagens publicadas).
export function imagePrompt(description, { framing, avoid = [] } = {}) {
  return `${description}
${framing ? `\nFraming: ${framing}.` : ''}
${rules().imagem}
${avoid.length ? `\nThe image must look clearly different (scene, angle, colors, composition) from these recent images on the same website:\n${avoid.map((a) => `- ${a}`).join('\n')}` : ''}`;
}
