# Hooke News Worker

Backend do feed de notícias por setor. Roda numa Cloudflare Worker gratuita: busca RSS
por setor uma vez por dia, usa a Gemini API (gratuita) para escolher e resumir as 5
melhores notícias de cada um dos 8 setores da Hooke, e guarda como "pendente" até um
admin aprovar pelo painel (`/admin/news.html`).

## Setup (uma vez)

1. Instale a CLI da Cloudflare e faça login:
   ```
   npm install -g wrangler
   wrangler login
   ```

2. Crie o namespace do KV (banco de dados chave-valor da Cloudflare):
   ```
   cd worker
   wrangler kv namespace create NEWS_KV
   ```
   Copie o `id` que aparecer no terminal e cole em `wrangler.toml`, no lugar de
   `COLE_AQUI_O_ID_DO_KV_NAMESPACE`.

3. Crie uma API key gratuita da Gemini em https://aistudio.google.com/apikey e guarde
   como secret do Worker:
   ```
   wrangler secret put GEMINI_API_KEY
   ```

4. Defina a senha do painel admin:
   ```
   wrangler secret put ADMIN_PASSWORD
   ```

5. Deploy:
   ```
   wrangler deploy
   ```
   A URL final (algo como `https://hooke-news.<seu-usuario>.workers.dev`) é o que vai
   em `API_BASE` no `js/news-feed.js` e no `admin/news.html`.

## Testar localmente

```
wrangler dev
```

Isso sobe o worker em `http://localhost:8787`, com KV local. Pra testar o cron sem
esperar o horário:

```
curl -X POST http://localhost:8787/api/admin/login -H "Content-Type: application/json" -d '{"password":"SUA_SENHA"}'
# pega o token da resposta e chama:
curl -X POST http://localhost:8787/api/admin/run-now -H "Authorization: Bearer TOKEN_AQUI"
```

Depois confira `GET /api/admin/pending` (com o mesmo header) pra ver os candidatos.

## Ajustar fontes de notícias

Os feeds RSS por setor ficam em `src/sources.js` — é uma curadoria inicial e alguns
feeds podem estar desatualizados ou não existir mais. Vale testar cada URL depois do
primeiro deploy e trocar por fontes melhores conforme necessário.
