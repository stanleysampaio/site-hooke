# Hooke News Worker

API do feed de notícias na Cloudflare (plano gratuito). Os dados ficam no **D1** (SQL), e o
`schema.sql` cria todas as tabelas. O código está dividido assim:

| Arquivo | Conteúdo |
|---|---|
| `src/index.js` | rotas públicas do site (`/api/news`, `/api/views`, newsletter, `/share/:id`) e do gerador (`/api/ingest/*`, token `INGEST_TOKEN`) |
| `src/admin.js` | rotas do painel `/admin/news.html` (`/api/admin/*`): notícias, métricas, newsletter, regras editoriais, usuários, histórico |
| `src/auth.js` | senhas (PBKDF2-SHA256 com sal), sessão assinada (secret `SESSION_SECRET`, 8 h), bloqueio após 5 erros e limite por endereço de rede |
| `src/db.js` | acesso ao D1 (as alterações usam `json_set`, então duas atualizações da mesma notícia nunca se sobrescrevem) |

A geração das matérias (pesquisa, IA, imagem e tradução) **não roda aqui**. Veja `../news-pipeline/README.md`.

## Painel: usuários e segurança

- Cada pessoa tem o seu usuário, e o administrador cadastra os outros pelo próprio painel (tela Usuários).
- **Perfis:** `admin` (tudo) e `editor` (aprovar, editar e excluir notícias).
- **Senha provisória:** quem é cadastrado, ou tem a senha redefinida, é obrigado a criar a própria senha no
  primeiro acesso. Mínimo de 10 caracteres, com letras e números.
- **Bloqueio:** depois de 5 senhas erradas, o usuário fica bloqueado por 15 minutos (o administrador pode
  desbloquear antes). Cada endereço de rede pode fazer no máximo 20 tentativas a cada 15 minutos.
- **Encerrar acesso na hora:** desativar um usuário ou trocar a senha encerra as sessões abertas.
- **Histórico:** toda ação fica no histórico (`audit_log`), visível para administradores.

## Setup do zero

```
wrangler login
wrangler d1 create hooke-news                 # e cole o database_id em wrangler.toml
wrangler d1 execute hooke-news --remote --file schema.sql
wrangler secret put SESSION_SECRET            # valor aleatório longo
wrangler secret put INGEST_TOKEN              # o mesmo do .env do news-pipeline
node scripts/seed-admin.mjs adminhooke "Administrador Hooke" "<senha provisória>" > seed.sql
wrangler d1 execute hooke-news --remote --file seed.sql && rm seed.sql
wrangler deploy
```

O secret `ADMIN_PASSWORD` (do painel antigo, de senha única) não é mais usado e pode ser removido com
`wrangler secret delete ADMIN_PASSWORD`.

## Testar localmente

Crie `worker/.dev.vars` (já está no `.gitignore`):

```
SESSION_SECRET=qualquer-texto-local
INGEST_TOKEN=token-local
```

Depois rode:

```
wrangler d1 execute hooke-news --local --file schema.sql
wrangler dev
```
