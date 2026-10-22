# Hooke News Pipeline

Gera as matérias do feed de notícias do site e entrega ao painel (`/admin/news.html`)
como **pendentes** para aprovar, editar ou excluir. Roda na EC2 do ERP; não faz parte do
site estático (não suba esta pasta para o bucket).

```
Pautas: RSS dos portais + buscas no Bing Notícias (prioridade Bahia e Minas Gerais)
  └► curadoria (Gemini, 1 chamada): escolhe até 1 por setor (2 em "Indústria BA e MG")
      └► para cada pauta: Gemini PESQUISA NO GOOGLE e escreve uma síntese própria
         (5–7 parágrafos, negritos, intertítulos, fontes, links internos quando houver
         relação direta com notícias já publicadas) ──► painel: pendente, com foto do setor

Ao aprovar no painel (fila atendida a cada 5 min):
  ├► imagem por IA ──► marca d'água Hooke no canto ──► JPEG 1200×675 no S3 (img/noticias/)
  └► tradução para pt-PT, en, es, zh-CN ──► o site mostra no idioma escolhido
```

- **Fontes/pautas:** `src/sources.js`. Teste com `deploy/run.sh --check-sources` (sem IA).
  Portais que bloqueiam IP da AWS (Metalurgia.com.br, Indústria Hoje, ABCP, Canal Rural)
  ficaram de fora; as buscas do Bing cobrem esses setores.
- **Regras editoriais:** `regras-editoriais.md` — texto em português que vai direto para a IA
  (curadoria, pesquisa, redação, formatação, links internos, imagem, tradução). A equipe edita
  esse arquivo; `src/prompts.js` só acrescenta os dados de cada pedido e o formato JSON.
- **Custo:** imagem e tradução só para notícias aprovadas. Com `GEMINI_FREE_API_KEY` (chave
  de um projeto Google sem faturamento) as traduções saem no plano gratuito.
- **Repetição:** links já processados ficam em `data/state.json`; o worker também recusa
  links já pendentes/publicados.

## Comandos (na EC2, sempre via `deploy/run.sh`, que roda em container Node 22)

```
deploy/run.sh install                   # instala/atualiza dependências
deploy/run.sh --check-sources           # testa fontes (sem IA)
deploy/run.sh --dry-run --limit 2       # gera 2 matérias em ./out, sem enviar nada
deploy/run.sh                           # execução completa (o timer faz isso às 06:00)
deploy/run.sh --if-requested            # fila do painel + "Gerar notícias agora" (timer de 5 min)
deploy/run.sh --sector "Fertilizantes"  # só um setor (nome igual ao de src/sources.js)
deploy/run.sh --ignore-seen             # reavalia pautas já descartadas
deploy/run.sh --watermark-existing      # aplica a marca d'água em imagens antigas
```

## Deploy na EC2 (ec2-user@app.hookengenharia.com.br)

A EC2 é a do ERP (Amazon Linux 2023, 2 GB de RAM). O pipeline roda em container
`node:22-slim` com teto de 512 MB, meio núcleo de CPU, prioridade menor que o ERP e
`oom-score-adj` 1000 (se faltar memória, o kernel mata o gerador, não o ERP). Nada do ERP é
alterado. As imagens vão para o S3 com o usuário IAM `hooke-news-pipeline` (só
`s3:PutObject` em `img/noticias/`), cujas chaves ficam no `.env`.

```
# atualizar o código (da máquina de desenvolvimento)
tar -czf - src assets deploy regras-editoriais.md .env package.json package-lock.json \
  | ssh ec2-user@app.hookengenharia.com.br 'cd ~/hooke-news-pipeline && tar -xzf -'

# agendamento (já instalado): 09:00 UTC = 06:00 em Brasília; fila do painel a cada 5 min
sudo cp deploy/*.service deploy/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hooke-news.timer hooke-news-request.timer

# acompanhar
systemctl list-timers 'hooke-news*'
journalctl -u hooke-news -u hooke-news-request --since today

# remover tudo (volta a EC2 ao estado anterior)
sudo systemctl disable --now hooke-news.timer hooke-news-request.timer
sudo rm /etc/systemd/system/hooke-news*; rm -rf ~/hooke-news-pipeline
```

## Worker (Cloudflare)

Na pasta `../worker`: `wrangler secret put INGEST_TOKEN` (mesmo valor do `.env`) e
`wrangler deploy`. O worker só guarda e serve: notícias, visualizações (bloco "Mais lidas"),
inscritos da newsletter, página de compartilhamento `/share/:id` e a fila de pedidos.
