-- Banco D1 do feed de notícias (aplicar com:
--   wrangler d1 execute hooke-news --remote --file schema.sql)
-- As matérias ficam como JSON em items.data; as atualizações usam json_set na
-- própria instrução UPDATE, então imagem, tradução e edição de uma mesma
-- notícia nunca sobrescrevem umas às outras.

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,            -- pending | published | rejected (excluída no painel; guarda o link)
  link TEXT,                       -- matéria de origem (evita gerar a mesma de novo)
  data TEXT NOT NULL,              -- JSON da notícia
  created_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items (status, published_at, created_at);
CREATE INDEX IF NOT EXISTS idx_items_link ON items (link);

-- Leituras por notícia (bloco "Mais lidas" e newsletter quinzenal).
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Inscritos da newsletter, com o registro do consentimento (LGPD).
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,      -- link de cancelamento
  lang TEXT,
  consent TEXT,
  created_at TEXT NOT NULL
);

-- ===== Painel administrativo (usuários, histórico, métricas, configurações) =====

-- Usuários do painel. Senha: PBKDF2-SHA256 com sal próprio (nunca em texto).
-- must_change = 1 obriga a trocar a senha no próximo login (senha provisória).
-- token_version invalida as sessões abertas (troca de senha, desativação).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'editor',   -- admin | editor
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  pass_iterations INTEGER NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Quem fez o quê no painel.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at);

-- Leituras por dia (gráficos e "mais lidas da semana/mês").
CREATE TABLE IF NOT EXISTS views_daily (
  day TEXT NOT NULL,
  id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, id)
);

-- Limite de tentativas de login por endereço de rede.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

-- Configurações (ex.: regras editoriais editadas no painel) e histórico delas.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  at TEXT NOT NULL,
  username TEXT
);

-- Inscritos: data de criação já existe em subscribers.created_at.

-- ===== Temas e fontes de pauta (tela "Temas e fontes" do painel) =====
-- Editoria = seção do site (aba da página de Notícias). max_per_run = quantas
-- matérias por dia o gerador pode trazer dela.
CREATE TABLE IF NOT EXISTS editorias (
  name TEXT PRIMARY KEY,
  max_per_run INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tema = o que o gerador procura todo dia: uma busca no Bing Notícias (kind
-- 'busca', value = termo) ou o RSS de um portal (kind 'rss', value = endereço).
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  editoria TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_themes_editoria ON themes (editoria);

-- ===== Bot de WhatsApp (src/whatsapp.js) =====
-- Uma linha por pessoa que escreveu: em que passo da conversa ela está e as
-- respostas do orçamento em andamento (data, JSON). paused_until = até quando
-- o bot fica quieto (equipe atendendo pelo celular).
CREATE TABLE IF NOT EXISTS wa_contacts (
  wa_id TEXT PRIMARY KEY,          -- número com DDI, ex.: 5571999990000
  name TEXT,                       -- nome do perfil do WhatsApp
  state TEXT NOT NULL,             -- inicio | servicos | q_* (perguntas do canal) | humano
  data TEXT NOT NULL DEFAULT '{}',
  paused_until TEXT,
  last_in_at TEXT,
  created_at TEXT NOT NULL
);

-- Pedidos concluídos no bot (tela WhatsApp do painel), de qualquer canal.
CREATE TABLE IF NOT EXISTS wa_leads (
  id TEXT PRIMARY KEY,
  wa_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'comercial',   -- comercial | sac (CHANNELS em src/whatsapp.js)
  profile_name TEXT,
  name TEXT,
  company TEXT,
  sector TEXT,
  location TEXT,
  subject TEXT,                    -- SAC: Suporte técnico | Dúvida | Reclamação
  description TEXT,
  attachments TEXT,                -- JSON: [{type, id, name}] (os arquivos ficam na conversa)
  deadline TEXT,
  email TEXT,
  origin TEXT,                     -- 'site' quando veio do botão do site
  status TEXT NOT NULL DEFAULT 'novo',   -- novo | em_atendimento | proposta | fechado | descartado
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_leads_created ON wa_leads (created_at);

-- Ids de mensagens já processadas (a Meta reenvia webhooks; guardados 7 dias).
CREATE TABLE IF NOT EXISTS wa_seen (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
