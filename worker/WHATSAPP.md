# Bot de WhatsApp da Hooke

O botão "Fale conosco" do site abre o WhatsApp da Hooke. O bot recebe a pessoa, qualifica o pedido de
orçamento e passa a conversa para a equipe, que responde pelo **celular (app WhatsApp Business) ou pelo
WhatsApp Web**. O número fica em **coexistência**: é o mesmo número no app e na API oficial da Meta.

- **Código:** `src/whatsapp.js`, com a rota `/api/whatsapp/webhook` no mesmo Worker das notícias.
- **Dados:** tabelas `wa_contacts`, `wa_leads` e `wa_seen` no D1 (veja `schema.sql`).
- **Painel:** tela **WhatsApp** em `/admin/news.html`, só para administradores. Lista os pedidos (filtro por canal: Comercial ou SAC), permite
  mudar a situação, anotar observações e exportar CSV.

## Como a conversa funciona

1. **Menu:** Comercial / orçamento · SAC (já sou cliente) · Conhecer serviços · Trabalhe conosco · Falar
   com a equipe. Os canais ficam em `CHANNELS`, no topo de `src/whatsapp.js`.
2. **SAC:** nome, empresa, assunto (Suporte técnico / Dúvida / Reclamação) e descrição (aceita fotos, PDF e
   áudio). O resumo começa com 📌 *SAC*.
3. **Comercial (orçamento):** o bot pergunta nome, empresa, setor (lista), cidade/UF, necessidade (aceita fotos, PDF e
   áudio), prazo (Urgente / Até 30 dias / Ainda planejando) e e-mail (opcional).
4. **Final:** o bot manda o **resumo na própria conversa**, com o canal na primeira linha, então a equipe lê tudo no celular. O pedido
   também vai para o painel. O bot avisa se a conversa está dentro ou fora do horário de atendimento.
5. **Equipe assume:** depois do resumo, ou de "Falar com a equipe", o bot fica quieto por 24 h. Quando
   alguém da equipe responde pelo app ou pelo Web, ele fica quieto por mais 12 h a partir da resposta. A
   pessoa pode escrever **menu** a qualquer momento para voltar ao início.
6. **Serviços:** um resumo de cada setor, com link para a página do site.
7. **Trabalhe conosco:** o bot pede a autorização LGPD, nome, e-mail, cidade, função e o currículo em **PDF de
   até 3 MB**. Ele baixa o arquivo da Meta e cadastra no **banco de talentos do ERP** pelas mesmas rotas
   públicas do formulário do site (`app.hookengenharia.com.br/api/recrutamento`), com o consentimento
   registrado. Não vira pedido no painel do WhatsApp: o RH vê em Pessoas > Recrutamentos no ERP. Se o ERP
   falhar, o bot manda o link da página Trabalhe Conosco. Atenção: as rotas públicas do ERP aceitam 10
   envios por hora por IP, e o bot sai sempre pelos IPs da Cloudflare (2 envios por currículo).

Os ajustes ficam no topo de `src/whatsapp.js`: horário de atendimento (`OFFICE`, hoje segunda a sexta, das
8h às 18h, horário da Bahia), tempos de pausa e textos dos setores.

## Custos (valores de out/2026)

### Mensagens da Meta (preço em reais, válido desde 01/10/2026)

| O quê | Custo |
|---|---|
| Mensagens que a **equipe** envia pelo celular ou WhatsApp Web | **grátis** |
| Respostas do **bot** dentro de 24 h da mensagem do cliente ("mensagens de serviço") | **1.000 grátis por mês**; depois ~**R$ 0,035** cada |
| Modelo "utilidade" (a empresa puxa a conversa depois de 24 h) | ~R$ 0,035 cada (o bot não usa) |
| Modelo "marketing" (campanha, promoção) | ~R$ 0,35 cada (o bot não usa) |
| Conversa vinda de anúncio "Clique para WhatsApp" | grátis por 7 dias |

Um pedido de orçamento completo usa cerca de **10 respostas do bot**. Assim, os 1.000 grátis cobrem
**~100 orçamentos por mês**.

| Volume mensal | Respostas do bot | Custo Meta |
|---|---|---|
| 50 contatos | ~500 | R$ 0 |
| 200 contatos | ~2.000 | ~R$ 35 |
| 500 contatos | ~5.000 | ~R$ 140 |

### Custos fixos

| Item | Custo |
|---|---|
| Cloudflare Worker + D1 (plano gratuito: 100 mil requisições/dia) | R$ 0 |
| Chip pré-pago | ~R$ 10–20 uma vez, mais recargas para manter a linha ativa (~R$ 15–30 a cada 1–3 meses, depende da operadora) |
| **Ligação da coexistência**, uma das opções abaixo | R$ 0 a ~R$ 310/mês |

A Meta só permite conectar um número de **app** (coexistência) por meio de um **parceiro**: um Tech
Provider ou Solution Partner. As opções são:

| Opção | Mensalidade | Observação |
|---|---|---|
| **A. A própria Hooke vira Tech Provider na Meta** | R$ 0 | Exige verificação da empresa, revisão do app com vídeos de demonstração e algumas semanas. O programa é pensado para empresas de software, então pode ser recusado. |
| **B. Dualhook** | US$ 12 (~R$ 65) | Conector barato que só faz a ligação: os webhooks vão direto da Meta para o nosso Worker, sem taxa sobre as mensagens. Tem 14 dias grátis. Ainda falta confirmar os detalhes antes de contratar. |
| **C. 360dialog** | € 49 (~R$ 310) | Parceiro grande e consolidado, mas o caro para o nosso caso. |

**Estimativa total para começar:** opção B + chip ≈ **R$ 75–90/mês**, com até ~100 orçamentos/mês sem
custo de mensagens. Com a opção A, ≈ R$ 10–30/mês.

Os câmbios são aproximados (US$ 1 ≈ R$ 5,40; € 1 ≈ R$ 6,30). A Meta cobra em reais (Facebook Brasil)
desde jul/2026.

**Extras opcionais para depois:** respostas com IA (Gemini), na ordem de centavos por conversa; aviso de
novo pedido por e-mail via SES, praticamente grátis, quando o SES da newsletter estiver pronto.

## Passo a passo até o bot entrar no ar

1. **Comprar o chip** e ativar o número no app **WhatsApp Business** (não no WhatsApp comum). Cadastrar
   nome "Hooke Soluções de Engenharia", logo, endereço, site e horário. Usar normalmente com clientes
   reais. Contas novas não são liberadas para coexistência na hora, e o histórico de uso conta.
2. **Business Manager (Portfólio empresarial) da Hooke** em business.facebook.com, com CNPJ, e iniciar a
   **verificação da empresa** (documento e domínio hookengenharia.com.br). Pode levar dias.
3. **App na Meta for Developers** (tipo "Business"), com o produto WhatsApp. Enquanto o número real não
   está pronto, dá para testar o bot com o **número de teste** que a Meta fornece.
4. **Escolher a ligação da coexistência** (A, B ou C acima) e conectar o número do app WhatsApp Business.
   Durante a conexão, o celular mostra um QR code ou uma confirmação. Os aparelhos vinculados (WhatsApp
   Web) são desconectados e depois podem ser vinculados de novo. O WhatsApp para Windows não é suportado
   na coexistência.
5. **Token permanente:** no Business Manager, criar um *usuário do sistema* com acesso ao app e à conta
   do WhatsApp e gerar um token com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`.
6. **Configurar o Worker:**
   ```
   wrangler d1 execute hooke-news --remote --file schema.sql   # cria as tabelas wa_*
   wrangler secret put WA_TOKEN             # token do passo 5
   wrangler secret put WA_APP_SECRET        # App > Configurações > Básico > Chave secreta do app
   wrangler secret put WA_VERIFY_TOKEN      # um texto aleatório qualquer (usado no passo 7)
   wrangler secret put WA_PHONE_NUMBER_ID   # WhatsApp > Configuração da API > "Identificação do número de telefone"
   wrangler deploy
   ```
7. **Webhook** (no app da Meta, WhatsApp > Configuração):
   - URL de callback: `https://hooke-news.yelnalts1993.workers.dev/api/whatsapp/webhook`
   - Token de verificação: o mesmo `WA_VERIFY_TOKEN`
   - Assinar os campos **messages** e **smb_message_echoes**. O segundo é o que faz o bot ficar quieto
     quando a equipe responde.
8. **Teste:** mandar "oi" de outro celular. O painel, na tela WhatsApp, deve mostrar "bot ativo".
9. **Site:** feito em 03/11/2026. O número **34 99244-9665** já está em todas as páginas, e o botão
   flutuante abre `wa.me/5534992449665` com "Olá! Vim pelo site da Hooke." (traduzido nos 5 idiomas), que
   o bot usa para marcar a origem "site". Até o bot entrar no ar, a equipe atende pelo app.

## Limitações da coexistência

- Trocar de celular ou reinstalar o app desconecta a API. A reconexão costuma ser automática em minutos.
- No app, ficam desligadas as mensagens temporárias, a visualização única, a localização em tempo real e
  as listas de transmissão (as que já existem ficam só para leitura).
- O limite é de 20 mensagens por segundo, bem acima do que o atendimento comercial usa.
- Quem não usa a ferramenta dentro do contrato da Meta (por exemplo, disparos em massa) pode ter o número
  bloqueado. O bot só responde a quem escreveu.
- Desde jan/2026 a Meta proíbe **assistentes de IA de uso geral** no WhatsApp. IA de atendimento da
  própria empresa é permitida, e esse seria o caso de uma futura etapa com IA.
