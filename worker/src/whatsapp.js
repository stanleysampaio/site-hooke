// Bot de WhatsApp da Hooke (API oficial da Meta). O número fica em
// "coexistência": é o mesmo do app WhatsApp Business do celular, então a
// equipe vê e responde tudo por lá (ou pelo WhatsApp Web). O bot recebe quem
// chega pelo "Fale conosco", qualifica o pedido de orçamento (vira um lead no
// painel) e passa a conversa para a equipe. Quando alguém da equipe responde
// pelo app, a Meta avisa (webhook smb_message_echoes) e o bot fica quieto
// naquela conversa.
//
// Configuração (wrangler secret put <NOME>): WA_TOKEN (token permanente do
// usuário do sistema), WA_APP_SECRET (assinatura dos webhooks),
// WA_VERIFY_TOKEN (texto combinado no cadastro do webhook) e
// WA_PHONE_NUMBER_ID (id do número, não o número em si). Sem WA_TOKEN o bot
// processa as mensagens mas não responde (útil para testar o webhook).
import { SITE_URL, json, now } from "./db.js";

const GRAPH_URL = "https://graph.facebook.com/v24.0";

// Depois que a equipe responde pelo app, o bot fica quieto por este tempo.
const HUMAN_PAUSE_HOURS = 12;
// Depois de passar a conversa para a equipe (lead concluído ou "falar com a
// equipe"), o bot só volta a responder se a pessoa escrever "menu" ou depois
// deste tempo sem mensagens.
const HANDOFF_HOURS = 24;

// Horário de atendimento (Bahia, UTC-3 o ano todo).
const OFFICE = { days: [1, 2, 3, 4, 5], open: 8, close: 18, label: "de segunda a sexta, das 8h às 18h" };

export const SECTORS = [
  { id: "quimica-petroquimica", title: "Química e Petroquímica", text: "Montagem, manutenção e automação em plantas químicas e petroquímicas, com segurança e controle de qualidade." },
  { id: "alimenticia-bebidas", title: "Alimentícia e Bebidas", text: "Engenharia, utilidades e adequações para linhas de alimentos e bebidas, com rastreabilidade e segurança." },
  { id: "papel-celulose", title: "Papel e Celulose", text: "Montagem mecânica, tubulações, elétrica e instrumentação para fábricas de papel e celulose." },
  { id: "mineracao-siderurgia", title: "Mineração e Siderurgia", text: "Estruturas metálicas, montagem de equipamentos e manutenção para minas e usinas siderúrgicas." },
  { id: "energia-utilities", title: "Energia e Utilities", text: "Instalações elétricas de baixa e média tensão, utilidades e sistemas auxiliares para a indústria." },
];

export const DEADLINES = { urgente: "Urgente", "30dias": "Até 30 dias", planejando: "Ainda planejando" };
export const SAC_TYPES = { suporte: "Suporte técnico", duvida: "Dúvida", reclamacao: "Reclamação" };

// Canais de atendimento: cada um tem o seu roteiro de perguntas (passos de
// STEPS, na ordem) e o rótulo que aparece no resumo e no painel.
export const CHANNELS = {
  comercial: { label: "Comercial", steps: ["q_nome", "q_empresa", "q_setor", "q_local", "q_descricao", "q_prazo", "q_email"] },
  sac: { label: "SAC", steps: ["q_nome", "q_empresa", "q_tipo", "q_descricao"] },
  // Currículo: não vira pedido no painel, vai para o banco de talentos do ERP.
  vagas: { label: "Trabalhe conosco", steps: ["q_lgpd", "q_nome", "q_cvemail", "q_cidade", "q_funcao", "q_cv"] },
};

// Banco de talentos: as mesmas rotas públicas do formulário do site
// (js/curriculo.js). Cidades e funções iguais às do formulário.
const RECRUIT_API = "https://app.hookengenharia.com.br/api/recrutamento";
const CV_MAX_BYTES = 3331276; // limite do ERP (~3 MB)
const CV_CITIES = [
  ["MARACÁS", "Maracás"], ["POJUCA", "Pojuca"], ["CATU", "Catu"], ["MATA DE SÃO JOÃO", "Mata de São João"],
  ["DIAS D'ÁVILA", "Dias d'Ávila"], ["CAMAÇARI", "Camaçari"], ["SERGIPE/NOSSA SENHORA DO SOCORRO", "N. Sra. do Socorro (SE)"],
  ["SERGIPE/LARANJEIRAS", "Laranjeiras (SE)"], ["SERGIPE/ARACAJU", "Aracaju (SE)"], ["OUTRO", "Outra cidade"],
];
const CV_ROLES = [
  ["ELETRICISTA INDUSTRIAL", "Eletricista industrial"], ["SOLDADOR", "Soldador"], ["CALDEIREIRO", "Caldeireiro"],
  ["MECÂNICO INDUSTRIAL", "Mecânico industrial"], ["VULCANIZADOR", "Vulcanizador"],
  ["PLANEJADOR DE OBRAS INDUSTRIAIS", "Planejador de obras"], ["TÉCNICO DE SEGURANÇA", "Técnico de segurança"],
  ["ENCARREGADO DE OBRAS INDUSTRIAIS", "Encarregado de obras"], ["OUTROS", "Outra função"],
];

// ---------- Envio (Cloud API) ----------

async function send(env, to, payload) {
  if (!env.WA_TOKEN || !env.WA_PHONE_NUMBER_ID) {
    console.log("whatsapp (sem WA_TOKEN, não enviado)", to, JSON.stringify(payload));
    return;
  }
  const res = await fetch(`${GRAPH_URL}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
  });
  if (!res.ok) console.error("whatsapp: envio falhou", res.status, await res.text());
}

const sendText = (env, to, body) => send(env, to, { type: "text", text: { body, preview_url: true } });

// Até 3 botões (título com no máx. 20 caracteres).
const sendButtons = (env, to, body, buttons) => send(env, to, {
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: { buttons: buttons.map(([id, title]) => ({ type: "reply", reply: { id, title } })) },
  },
});

// Lista de até 10 opções (título com no máx. 24 caracteres).
const sendList = (env, to, body, button, rows) => send(env, to, {
  type: "interactive",
  interactive: {
    type: "list",
    body: { text: body },
    action: { button, sections: [{ title: "Opções", rows: rows.map(([id, title, description]) => ({ id, title, description })) }] },
  },
});

// ---------- Estado da conversa (tabela wa_contacts) ----------

async function getContact(env, waId) {
  const row = await env.DB.prepare("SELECT * FROM wa_contacts WHERE wa_id = ?").bind(waId).first();
  return row ? { ...row, data: JSON.parse(row.data || "{}") } : null;
}

function saveContact(env, c) {
  return env.DB
    .prepare(`INSERT INTO wa_contacts (wa_id, name, state, data, paused_until, last_in_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wa_id) DO UPDATE SET name = excluded.name, state = excluded.state, data = excluded.data,
      paused_until = excluded.paused_until, last_in_at = excluded.last_in_at`)
    .bind(c.wa_id, c.name || null, c.state, JSON.stringify(c.data || {}), c.paused_until || null, c.last_in_at || null, c.created_at || now())
    .run();
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();

function isOfficeHours(date = new Date()) {
  const bahia = new Date(date.getTime() - 3 * 3600000);
  const hour = bahia.getUTCHours();
  return OFFICE.days.includes(bahia.getUTCDay()) && hour >= OFFICE.open && hour < OFFICE.close;
}

const handoffNote = (who = "Um especialista da Hooke") => isOfficeHours()
  ? `${who} vai continuar o atendimento por aqui em instantes.`
  : `Agora estamos fora do horário de atendimento (${OFFICE.label}). ${who} responde por aqui assim que voltarmos.`;

// ---------- Telas do bot ----------

function sendMenu(env, to, greeting) {
  return sendList(env, to,
    `${greeting}\n\nComo podemos ajudar?`,
    "Ver opções",
    [
      ["orcamento", "Comercial / orçamento", "Novos projetos: conte o que precisa e enviamos uma proposta"],
      ["sac", "SAC: já sou cliente", "Suporte, dúvidas ou reclamações sobre um serviço da Hooke"],
      ["servicos", "Conhecer serviços", "Setores industriais que a Hooke atende"],
      ["vagas", "Trabalhe conosco", "Envie o seu currículo em PDF por aqui"],
      ["humano", "Falar com a equipe", "Atendimento com uma pessoa da Hooke"],
    ]);
}

const sectorRows = () => [
  ...SECTORS.map((s) => [`setor:${s.id}`, s.title]),
  ["setor:outro", "Outro setor"],
];

// Perguntas dos roteiros (a ordem de cada canal fica em CHANNELS).
const isSac = (c) => c.data.canal === "sac";
const NAME_QUESTION = {
  comercial: "Ótimo! Vou fazer algumas perguntas rápidas para a equipe já chegar com a proposta certa.\n\nPara começar, qual é o seu nome?",
  sac: "Certo! Vou registrar o seu atendimento para a nossa equipe de SAC.\n\nPara começar, qual é o seu nome?",
  vagas: "Obrigado! Qual é o seu nome completo?",
};
const STEPS = {
  q_lgpd: (env, to) => sendButtons(env, to,
    "Que bom que você quer fazer parte da Hooke! Vou cadastrar o seu currículo no nosso banco de talentos. Quando surgir uma vaga compatível, a equipe entra em contato.\n\n" +
    "Para isso, você autoriza a Hooke a armazenar os seus dados e o seu currículo para fins de recrutamento e seleção, conforme a LGPD (Lei 13.709/2018)? " +
    "Você pode pedir a exclusão a qualquer momento pelo e-mail comercial@hookengenharia.com.br.",
    [["lgpd:sim", "Autorizo"], ["lgpd:nao", "Não autorizo"]]),
  q_nome: (env, to, c) => sendText(env, to, NAME_QUESTION[c.data.canal] || NAME_QUESTION.comercial),
  q_cvemail: (env, to) => sendText(env, to, "Qual é o seu e-mail?"),
  q_cidade: (env, to) => sendList(env, to, "Onde você mora?", "Escolher cidade", CV_CITIES.map(([v, t], i) => [`cidade:${i}`, t])),
  q_funcao: (env, to) => sendList(env, to, "Qual é a função de interesse?", "Escolher função", CV_ROLES.map(([v, t], i) => [`funcao:${i}`, t])),
  q_cv: (env, to) => sendText(env, to, "Por último: envie o seu currículo em *PDF* (até 3 MB). Toque no clipe 📎 > Documento e escolha o arquivo."),
  q_empresa: (env, to, c) => sendText(env, to, `Prazer, ${c.data.nome.split(" ")[0]}! Qual é a empresa?`),
  q_setor: (env, to) => sendList(env, to, "Qual é o setor da operação?", "Escolher setor", sectorRows()),
  q_local: (env, to) => sendText(env, to, "Em qual cidade e estado fica a unidade ou a obra?"),
  q_tipo: (env, to) => sendButtons(env, to, "Qual é o assunto?", Object.entries(SAC_TYPES)),
  q_descricao: (env, to, c) => sendText(env, to, isSac(c)
    ? "Conte o que aconteceu: qual serviço, obra ou equipamento e o que você precisa. Se ajudar, pode mandar fotos, PDFs ou áudio."
    : "Descreva rapidamente o que você precisa (equipamento, problema, escopo...). Se ajudar, pode mandar fotos, PDFs ou áudio."),
  q_prazo: (env, to) => sendButtons(env, to, "Qual é o prazo?", Object.entries(DEADLINES)),
  q_email: (env, to) => sendButtons(env, to, "Por último: qual e-mail para enviarmos a proposta? Escreva o e-mail ou toque em Pular.", [["pular", "Pular"]]),
};

async function ask(env, c, state) {
  c.state = state;
  await STEPS[state](env, c.wa_id, c);
}

// Começa o roteiro de um canal.
async function startFlow(env, c, canal) {
  c.data = { origem: c.data.origem, canal };
  await ask(env, c, CHANNELS[canal].steps[0]);
}

// Vai para a próxima pergunta do canal ou, se acabou, registra o pedido.
async function advance(env, c) {
  const steps = CHANNELS[c.data.canal || "comercial"].steps;
  const nextStep = steps[steps.indexOf(c.state) + 1];
  if (nextStep) await ask(env, c, nextStep);
  else if (c.data.canal === "vagas") await finishCv(env, c);
  else await finishLead(env, c);
}

async function finishLead(env, c) {
  const d = c.data;
  const canal = d.canal || "comercial";
  const lead = {
    id: crypto.randomUUID(), wa_id: c.wa_id, channel: canal, profile_name: c.name || null, name: d.nome, company: d.empresa,
    sector: d.setor || null, location: d.local || null, subject: d.tipo || null, description: d.descricao || null,
    attachments: JSON.stringify(d.anexos || []), deadline: d.prazo || null, email: d.email || null, origin: d.origem || null, created_at: now(),
  };
  await env.DB
    .prepare(`INSERT INTO wa_leads (id, wa_id, channel, profile_name, name, company, sector, location, subject, description, attachments, deadline, email, origin, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?)`)
    .bind(lead.id, lead.wa_id, lead.channel, lead.profile_name, lead.name, lead.company, lead.sector, lead.location, lead.subject,
      lead.description, lead.attachments, lead.deadline, lead.email, lead.origin, lead.created_at)
    .run();

  // O resumo fica na própria conversa: a equipe lê tudo no celular sem abrir
  // o painel. A primeira linha diz o canal, para quem pega a conversa.
  const anexos = (d.anexos || []).length;
  const desc = `${d.descricao || "(ver anexos)"}${anexos ? ` + ${anexos} anexo(s)` : ""}`;
  const lines = canal === "sac"
    ? [`*Nome:* ${d.nome}`, `*Empresa:* ${d.empresa}`, `*Assunto:* ${d.tipo}`, `*Descrição:* ${desc}`]
    : [`*Nome:* ${d.nome}`, `*Empresa:* ${d.empresa}`, `*Setor:* ${d.setor}`, `*Local:* ${d.local}`,
      `*Necessidade:* ${desc}`, `*Prazo:* ${d.prazo}`, `*E-mail:* ${d.email || "não informado"}`];
  await sendText(env, c.wa_id, [
    `📌 *${CHANNELS[canal].label}*`,
    "Pronto! Recebemos a sua solicitação:",
    "",
    ...lines,
    "",
    handoffNote(canal === "sac" ? "A nossa equipe de SAC" : "Um especialista da Hooke"),
  ].join("\n"));

  c.state = "humano";
  c.paused_until = hoursFromNow(HANDOFF_HOURS);
  c.data = { origem: d.origem };
}

// Baixa o PDF da Meta e cadastra no banco de talentos (2 chamadas, como o site).
async function registerCv(env, c) {
  const d = c.data;
  const auth = { Authorization: `Bearer ${env.WA_TOKEN}` };
  const info = await fetch(`${GRAPH_URL}/${d.cv.id}`, { headers: auth }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`mídia ${r.status}`)));
  if (info.file_size > CV_MAX_BYTES) return "grande";
  const pdf = await fetch(info.url, { headers: auth }).then((r) => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`download ${r.status}`)));
  if (pdf.byteLength > CV_MAX_BYTES) return "grande";

  const form = new FormData();
  form.append("file", new Blob([pdf], { type: "application/pdf" }), (d.cv.name || "curriculo.pdf").replace(/[^\w.\- ]/g, "_"));
  const up = await fetch(`${RECRUIT_API}/recruitmentFile`, { method: "POST", body: form });
  if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
  const { filename } = await up.json();

  const res = await fetch(RECRUIT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome_completo: d.nome, email: d.email, telefone: `+${c.wa_id}`, local_de_residencia: d.cidade,
      funcoes: [d.funcao], filename, consentimento_lgpd: true, consentimento_em: d.lgpd_em,
    }),
  });
  if (!res.ok) throw new Error(`cadastro ${res.status} ${await res.text()}`);
  return "ok";
}

async function finishCv(env, c) {
  let result;
  try {
    result = await registerCv(env, c);
  } catch (err) {
    console.error("whatsapp: currículo não cadastrado", err && err.message);
    result = "erro";
  }
  if (result === "grande") {
    c.state = "q_cv";
    return sendText(env, c.wa_id, "Esse arquivo passa de 3 MB. Pode enviar uma versão menor do PDF?");
  }
  await sendButtons(env, c.wa_id, result === "ok"
    ? `Pronto, ${c.data.nome.split(" ")[0]}! O seu currículo foi cadastrado no banco de talentos da Hooke. Quando surgir uma vaga compatível com o seu perfil, a equipe entra em contato. Boa sorte! 🍀`
    : `Desculpe, não consegui cadastrar o seu currículo agora. Pode enviar pela página Trabalhe Conosco?\n${SITE_URL}/trabalhe-conosco.html`,
    [["menu", "Menu"]]);
  c.state = "inicio";
  c.data = { origem: c.data.origem };
}

// ---------- Mensagem recebida ----------

// Normaliza o que a pessoa mandou: texto, botão/lista ou mídia.
function readMessage(msg) {
  if (msg.type === "text") return { text: msg.text.body.trim() };
  if (msg.type === "interactive") {
    const r = msg.interactive.button_reply || msg.interactive.list_reply || {};
    return { choice: r.id, text: r.title };
  }
  if (msg.type === "button") return { choice: msg.button.payload, text: msg.button.text };
  if (["image", "document", "audio", "video"].includes(msg.type)) {
    const m = msg[msg.type];
    return { media: { type: msg.type, id: m.id, name: m.filename || null, mime: m.mime_type || null }, text: (m.caption || "").trim() };
  }
  return { other: msg.type };
}

const MENU_WORDS = /^(menu|início|inicio|voltar|recomeçar|recomecar)$/i;

async function onMessage(env, msg, profileName) {
  const waId = msg.from;
  const input = readMessage(msg);
  const at = now();
  let c = await getContact(env, waId);
  const isNew = !c;
  if (!c) c = { wa_id: waId, state: "inicio", data: {}, created_at: at };
  if (profileName) c.name = profileName;
  c.last_in_at = at;

  // De onde veio (texto pré-preenchido do botão do site).
  if (input.text && /vim pelo site|hooke website|sitio web de hooke|hooke 网站/i.test(input.text)) c.data.origem = "site";

  const wantsMenu = input.text && MENU_WORDS.test(input.text);
  const paused = c.paused_until && c.paused_until > at;

  // Equipe atendendo: o bot não interfere (só volta se pedirem o menu).
  if (paused && !wantsMenu) return saveContact(env, c);

  const choice = input.choice || "";

  // Primeira mensagem, pedido de menu ou texto solto fora de um roteiro:
  // mostra o menu. Botões tocados seguem para o tratamento abaixo.
  if (isNew || wantsMenu || choice === "menu" || (["inicio", "humano"].includes(c.state) && !choice)) {
    c.state = "inicio";
    c.paused_until = null;
    c.data = { origem: c.data.origem };
    await sendMenu(env, waId, isNew
      ? "Olá! 👋 Aqui é a *Hooke Soluções em Engenharia*."
      : "Olá de novo! 👋 Aqui é a *Hooke Soluções em Engenharia*.");
    return saveContact(env, c);
  }

  // ----- Menu principal -----
  if (choice === "orcamento" || choice === "servico:orcamento") {
    await startFlow(env, c, "comercial");
  } else if (choice === "sac") {
    await startFlow(env, c, "sac");
  } else if (choice === "servicos") {
    c.state = "servicos";
    await sendList(env, waId, "A Hooke atende a indústria com engenharia mecânica, elétrica, de automação e de processos. Escolha um setor para saber mais:", "Ver setores", SECTORS.map((s) => [`info:${s.id}`, s.title]));
  } else if (choice.startsWith("info:")) {
    const s = SECTORS.find((x) => `info:${x.id}` === choice);
    c.state = "servicos";
    if (s) {
      await sendButtons(env, waId, `*${s.title}*\n${s.text}\n\nSaiba mais: ${SITE_URL}/service.html#${s.id}`,
        [["servico:orcamento", "Pedir orçamento"], ["servicos", "Outros setores"], ["menu", "Menu"]]);
    }
  } else if (choice === "vagas") {
    await startFlow(env, c, "vagas");
  } else if (choice === "humano") {
    c.state = "humano";
    c.paused_until = hoursFromNow(HANDOFF_HOURS);
    await sendText(env, waId, `Certo! ${handoffNote()}\n\nSe quiser, já pode adiantar o assunto aqui. Para voltar ao menu, escreva *menu*.`);

  // ----- Perguntas dos roteiros -----
  } else if (c.state === "q_lgpd" && choice === "lgpd:sim") {
    c.data.lgpd_em = now();
    await advance(env, c);
  } else if (c.state === "q_lgpd" && choice === "lgpd:nao") {
    c.state = "inicio";
    c.data = { origem: c.data.origem };
    await sendButtons(env, waId, "Tudo bem! Sem a autorização não podemos guardar o seu currículo. Se mudar de ideia, é só escolher Trabalhe conosco no menu.", [["menu", "Menu"]]);
  } else if (c.state === "q_cvemail" && input.text) {
    const email = input.text.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      await sendText(env, waId, "Esse e-mail não parece válido. Pode conferir e escrever de novo?");
    } else {
      c.data.email = email.slice(0, 150);
      await advance(env, c);
    }
  } else if (c.state === "q_cidade" && (choice.startsWith("cidade:") || input.text)) {
    const city = CV_CITIES[Number(choice.slice(7))];
    c.data.cidade = city && choice ? city[0] : input.text.slice(0, 100).toUpperCase();
    await advance(env, c);
  } else if (c.state === "q_funcao" && (choice.startsWith("funcao:") || input.text)) {
    const role = CV_ROLES[Number(choice.slice(7))];
    c.data.funcao = role && choice ? role[0] : input.text.slice(0, 100).toUpperCase();
    await advance(env, c);
  } else if (c.state === "q_cv" && input.media) {
    const m = input.media;
    if (m.type !== "document" || !(m.mime === "application/pdf" || /\.pdf$/i.test(m.name || ""))) {
      await sendText(env, waId, "O currículo precisa estar em *PDF*. Toque no clipe 📎 > Documento e escolha o arquivo PDF.");
    } else {
      c.data.cv = m;
      await advance(env, c);
    }
  } else if (c.state === "q_nome" && input.text) {
    c.data.nome = input.text.slice(0, 120);
    await advance(env, c);
  } else if (c.state === "q_empresa" && input.text) {
    c.data.empresa = input.text.slice(0, 120);
    await advance(env, c);
  } else if (c.state === "q_setor" && (choice.startsWith("setor:") || input.text)) {
    const s = SECTORS.find((x) => `setor:${x.id}` === choice);
    c.data.setor = s ? s.title : choice === "setor:outro" ? "Outro" : input.text.slice(0, 80);
    await advance(env, c);
  } else if (c.state === "q_local" && input.text) {
    c.data.local = input.text.slice(0, 120);
    await advance(env, c);
  } else if (c.state === "q_tipo" && (SAC_TYPES[choice] || input.text)) {
    c.data.tipo = SAC_TYPES[choice] || input.text.slice(0, 80);
    await advance(env, c);
  } else if (c.state === "q_descricao" && input.media) {
    // Várias fotos chegam juntas: guarda todas e confirma uma vez só.
    c.data.anexos = [...(c.data.anexos || []), input.media];
    if (input.text) c.data.descricao = [c.data.descricao, input.text].filter(Boolean).join("\n").slice(0, 2000);
    if (!c.data.anexoAvisado) {
      c.data.anexoAvisado = true;
      await sendButtons(env, waId, "Recebido! Pode mandar mais arquivos ou escrever a descrição. Quando terminar, toque em Continuar.", [["continuar", "Continuar"]]);
    }
  } else if (c.state === "q_descricao" && (input.text || choice === "continuar")) {
    if (choice !== "continuar") c.data.descricao = [c.data.descricao, input.text].filter(Boolean).join("\n").slice(0, 2000);
    delete c.data.anexoAvisado;
    await advance(env, c);
  } else if (c.state === "q_prazo" && (DEADLINES[choice] || input.text)) {
    c.data.prazo = DEADLINES[choice] || input.text.slice(0, 80);
    await advance(env, c);
  } else if (c.state === "q_email" && choice === "pular") {
    await advance(env, c);
  } else if (c.state === "q_email" && input.text) {
    const email = input.text.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      await sendButtons(env, waId, "Esse e-mail não parece válido. Pode conferir? Ou toque em Pular.", [["pular", "Pular"]]);
    } else {
      c.data.email = email.slice(0, 150);
      await advance(env, c);
    }

  // ----- Fora do roteiro -----
  } else if (c.state === "q_cv" || c.state === "q_lgpd") {
    // Escreveu em vez de mandar o PDF ou de tocar no botão: repete o pedido.
    await ask(env, c, c.state);
  } else if (c.state.startsWith("q_")) {
    // Mandou mídia/figurinha numa pergunta de texto: repete a pergunta.
    await sendText(env, waId, "Não consegui entender. Pode responder em texto? (Para voltar ao início, escreva *menu*.)");
    await ask(env, c, c.state);
  } else {
    await sendMenu(env, waId, "Não entendi muito bem. 🙂");
  }

  return saveContact(env, c);
}

// A equipe respondeu pelo app ou pelo WhatsApp Web: o bot sai da conversa.
async function onEcho(env, echo) {
  const waId = echo.to;
  const c = (await getContact(env, waId)) || { wa_id: waId, state: "humano", data: {}, created_at: now() };
  c.state = "humano";
  c.paused_until = hoursFromNow(HUMAN_PAUSE_HOURS);
  await saveContact(env, c);
}

// ---------- Webhook ----------

async function validSignature(env, raw, header) {
  if (!env.WA_APP_SECRET || !header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WA_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = "sha256=" + [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

// A Meta reenvia o webhook se não receber 200 rápido: cada mensagem é
// processada uma vez só (tabela wa_seen).
async function firstTime(env, id) {
  const { meta } = await env.DB.prepare("INSERT OR IGNORE INTO wa_seen (id, at) VALUES (?, ?)").bind(id, now()).run();
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM wa_seen WHERE at < ?").bind(new Date(Date.now() - 7 * 86400000).toISOString()).run();
  }
  return meta.changes > 0;
}

async function processPayload(env, payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field === "messages") {
        const names = Object.fromEntries((v.contacts || []).map((ct) => [ct.wa_id, ct.profile && ct.profile.name]));
        for (const msg of v.messages || []) {
          if (await firstTime(env, msg.id)) await onMessage(env, msg, names[msg.from]);
        }
      } else if (change.field === "smb_message_echoes") {
        for (const echo of v.message_echoes || []) {
          if (await firstTime(env, echo.id)) await onEcho(env, echo);
        }
      }
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at, updated_by) VALUES ('wa_last_webhook', ?, ?, 'whatsapp')")
    .bind(now(), now()).run();
}

export async function handleWhatsApp(request, env, ctx) {
  // Verificação feita pela Meta ao cadastrar o webhook.
  if (request.method === "GET") {
    const url = new URL(request.url);
    const okToken = env.WA_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === env.WA_VERIFY_TOKEN;
    if (url.searchParams.get("hub.mode") === "subscribe" && okToken) {
      return new Response(url.searchParams.get("hub.challenge") || "", { headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  const raw = await request.text();
  if (!(await validSignature(env, raw, request.headers.get("X-Hub-Signature-256")))) return json({ error: "Assinatura inválida" }, 401);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: "JSON inválido" }, 400); }

  // Responde 200 na hora e processa em seguida (a Meta espera poucos segundos).
  ctx.waitUntil(processPayload(env, payload).catch((err) => console.error("whatsapp:", err && err.stack || err)));
  return new Response("ok");
}
