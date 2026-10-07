# Sair da Vercel — plano de troca de hospedagem

**Data:** 2026-10-07 · **Branch:** `feat/sair-vercel` · **Lançamento comercial:** sexta 2026-10-09

**Por quê:** o plano grátis da Vercel (Hobby) proíbe uso comercial, e o dono não quer pagar o Vercel Pro.
O código agora roda em qualquer lugar. O destino ainda não foi escolhido. São três opções:

1. **VPS Hostinger** (a mesma do n8n), com Docker e proxy reverso (Caddy ou Coolify) — **recomendada**
2. **Netlify Free** — funciona, mas tem limite rígido de créditos (ver a seção 6)
3. **Google Cloud Run** — exige cartão e conta de cobrança

> Nada deste plano foi executado em produção. Banco, variáveis de ambiente, DNS, painéis e deploy só mudam com um "pode" explícito do dono.

---

## 1. O que mudou no código (neutro de hospedagem)

| Antes (Vercel) | Agora |
| --- | --- |
| Vercel BotID (anti-robô invisível, só na Vercel) | **Cloudflare Turnstile** (grátis) no checkout e no pagamento, conferido no servidor |
| IP do comprador lido de `x-real-ip` / `x-forwarded-for` da Vercel | Cabeçalho escolhido por `TRUSTED_IP_HEADER`, conforme a hospedagem |
| Vercel Cron (`vercel.json`) chama `/api/cron/keep-alive` | Mesma rota. Fora da Vercel, quem chama é o **pg_cron do banco** (migration `20261015100000_keep_alive_schedule.sql`, ainda **não aplicada**) |
| Só build da Vercel | `Dockerfile` (VPS/Cloud Run, `output: standalone` via `NEXT_OUTPUT_STANDALONE=true`) e `netlify.toml` |

### Regras do anti-robô (Turnstile)

- **Protegidos:** criar o pedido (`startCheckout`) e pagar (`payOrder`). Cada token só vale para a sua ação (`checkout` ou `payment`) e é de uso único.
- **Sem anti-robô:** a consulta repetida do PIX (`checkOrderPayment`), o "pedido em aberto" (`findPendingOrder`) e "Alterar seleção". Elas exigem o token secreto do pedido, e "Alterar seleção" ainda tem limite de tentativas no banco. O token do Turnstile é de uso único, então não serve para uma consulta que se repete a cada 4 segundos.
- **Produção sem as duas chaves → compras e pagamentos RECUSADOS** (falha fechada). O comprador vê a mensagem genérica "Não conseguimos confirmar seu acesso…", e a equipe recebe 1 e-mail de alerta por dia ("Compras bloqueadas: falta configurar a verificação anti-robô").
- **Turnstile fora do ar ou sem resposta (5 s) → recusa** e manda alerta ("Verificação anti-robô fora do ar").
- **Desenvolvimento/teste sem chaves:** a verificação é pulada.
- Para o comprador, o widget normalmente fica invisível (`interaction-only`) e só aparece se o serviço pedir um clique. Os textos não citam fornecedor; a Política de Privacidade já fala em "proteção contra robôs" de forma genérica.
- A CSP libera `https://challenges.cloudflare.com` em `script-src`, `frame-src` e `connect-src`.

> **Atenção (configurar ANTES do deploy):** em qualquer hospedagem nova, cadastre `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` antes de publicar. Sem elas, ninguém compra. Na própria Vercel, este código também passa a exigir as chaves.

---

## 2. Como o dono cria as chaves do Turnstile (grátis, ~5 min)

1. Entre em <https://dash.cloudflare.com/sign-up> (conta grátis; não precisa mover o domínio para a Cloudflare).
2. No menu, abra **Turnstile** → **Add widget**.
3. **Widget name:** `Espaço Byla Eventos`.
4. **Hostnames:** adicione o domínio final (ex.: `ingressos.espacobyla.online`) e, durante a transição, o domínio temporário do destino (ex.: `espaco-byla-eventos.netlify.app`). Para testar no computador, inclua `localhost`.
5. **Widget mode:** `Managed`.
6. Salve. Aparecem a **Site Key** (pública) e a **Secret Key** (secreta).
7. Coloque as chaves **você mesmo** no painel da hospedagem (nunca no chat nem no Git):
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = Site Key
   - `TURNSTILE_SECRET_KEY` = Secret Key
8. A Site Key entra no build: depois de cadastrar, **publique de novo**.

---

## 3. Variáveis de ambiente a copiar da Vercel

Copie os valores do painel da Vercel (Settings → Environment Variables) para a nova hospedagem. Não cole valores no chat.

| Variável | Onde é usada | Observação |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | navegador + servidor | **entra no build** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador + servidor | **entra no build** |
| `SUPABASE_SERVICE_ROLE_KEY` | só servidor | secreta |
| `PAYMENT_PROVIDER` | servidor | `mercadopago` |
| `MERCADOPAGO_ACCESS_TOKEN` | servidor | secreta |
| `MERCADOPAGO_PUBLIC_KEY` | servidor → página de pagamento | |
| `MERCADOPAGO_WEBHOOK_SECRET` | servidor | secreta; sem ela os avisos de pagamento são recusados |
| `NEXT_PUBLIC_APP_URL` | links nos e-mails | **entra no build**; trocar para o domínio novo |
| `RESEND_API_KEY` | e-mails | secreta |
| `RESEND_FROM_EMAIL` | e-mails | igual |
| `ALERT_EMAIL` | alertas da equipe | igual |
| `PRIVACY_CONTACT_EMAIL` | /privacidade, /termos | igual |
| `CRON_SECRET` | `/api/cron/keep-alive` | igual. Se tiver menos de 32 caracteres, gere um novo (o pg_cron exige 32+) e troque nos dois lugares |
| `REMINDER_CRON_SECRET` | `/api/cron/abandoned-reminders` | igual |
| **novas:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | anti-robô | ver a seção 2 |
| **nova:** `TRUSTED_IP_HEADER` | limite de tentativas | ver a tabela abaixo |
| **opcional (Docker):** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | build | `openssl rand -base64 32`; mantenha a mesma em todos os builds |

### `TRUSTED_IP_HEADER` por hospedagem

| Hospedagem | Valor |
| --- | --- |
| Vercel | `x-real-ip` (padrão) |
| Netlify | `x-nf-client-connection-ip` |
| VPS com Caddy (config abaixo envia `X-Real-IP`) | `x-real-ip` |
| Qualquer uma atrás do proxy laranja da Cloudflare | `cf-connecting-ip` |
| Cloud Run (sem balanceador na frente) | `x-forwarded-for-last` — conferir no teste da seção 8 |

Se o cabeçalho escolhido não chegar, todos os compradores caem no mesmo balde "desconhecido" (10 checkouts a cada 10 min **no total**). Por isso o teste da seção 8 é obrigatório.

---

## 4. Opção 1 — VPS Hostinger (Docker + Caddy), recomendada

**Pré-requisitos:** acesso SSH à VPS, Docker instalado (o n8n provavelmente já usa) e pelo menos ~1 GB de RAM livre (o Next standalone usa ~150–300 MB).

1. **DNS (Hostinger → DNS do `espacobyla.online`): só ADICIONAR**, nunca editar nem apagar registros existentes (o n8n e o Resend dependem deles):
   - Tipo `A`, nome `ingressos`, valor = IP da VPS, TTL 300.
2. Na VPS, clone o repositório (público) e entre na pasta:
   ```bash
   git clone https://github.com/levi-tude/espaco-byla-eventos.git && cd espaco-byla-eventos
   git checkout <commit aprovado>
   ```
3. Crie `/opt/byla/eventos.env` (permissão `600`, fora do repositório) com as variáveis só de servidor da seção 3, mais `TRUSTED_IP_HEADER=x-real-ip`.
4. Gere a imagem (as `NEXT_PUBLIC_*` entram no build):
   ```bash
   docker build -t byla-eventos:$(git rev-parse --short HEAD) \
     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
     --build-arg NEXT_PUBLIC_APP_URL=https://ingressos.espacobyla.online \
     --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=... \
     .
   ```
5. Rode só na rede local da VPS (o Caddy é quem fica exposto):
   ```bash
   docker run -d --name byla-eventos --restart unless-stopped \
     --env-file /opt/byla/eventos.env -p 127.0.0.1:3000:3000 \
     byla-eventos:<tag>
   ```
6. **Caddy** (HTTPS automático). Se o n8n já usa Caddy/Traefik/nginx, **adicione** um bloco novo sem mexer nos existentes:
   ```caddyfile
   ingressos.espacobyla.online {
     encode zstd gzip
     reverse_proxy 127.0.0.1:3000 {
       header_up X-Real-IP {remote_host}
       flush_interval -1
     }
   }
   ```
   (`flush_interval -1` mantém o streaming do Next.) Com nginx: `proxy_set_header X-Real-IP $remote_addr;` e `proxy_buffering off;`.
7. **Coolify** (alternativa com painel): crie um recurso "Dockerfile" apontando para o repo, cadastre as variáveis (marque as `NEXT_PUBLIC_*` como *Build Variable*), domínio `ingressos.espacobyla.online` e `TRUSTED_IP_HEADER=x-real-ip` (o proxy do Coolify, Traefik, envia `X-Real-IP`; confira no teste da seção 8).
8. **Atualizar:** `git pull`, faça um novo `docker build` com uma tag nova e troque o container (`docker stop/rm` + `docker run`). Mantenha a imagem anterior para voltar rápido.
9. Firewall: só as portas 80/443 abertas para fora; a 3000 só em `127.0.0.1`.

**Prós:** custo zero a mais (a VPS já é paga), sem limite de deploys nem de acessos, uso comercial permitido.
**Contras:** alguém precisa cuidar do servidor (atualizações, disco, reinício). Se a VPS cair, caem o site e o n8n juntos.

---

## 5. Opção 2 — Netlify

1. Crie a conta grátis em <https://app.netlify.com> e use **Add new project → Import from Git** com o repositório. O `netlify.toml` já define o build. O adaptador oficial do Next (OpenNext, `@netlify/plugin-nextjs`) é instalado sozinho.
2. Em **Project configuration → Environment variables**, cadastre todas as variáveis da seção 3, com `TRUSTED_IP_HEADER=x-nf-client-connection-ip`.
3. **Para economizar créditos:** em **Build & deploy**, deixe *Deploy Previews* ligado (grátis) e publique em produção poucas vezes. Cada deploy de produção custa 15 dos 300 créditos do mês (ver a seção 6).
4. Domínio: **Domain management → Add a domain** → `ingressos.espacobyla.online`. Na Hostinger, **adicione** um `CNAME` `ingressos` → `<projeto>.netlify.app` (sem editar os existentes).
5. Agendamento: use o pg_cron (seção 7). Também existem Scheduled Functions na Netlify, inclusive no Free (limite de 30 s), mas não são necessárias.

Limites a lembrar: funções têm execução máxima de 60 s (o keep-alive declara 60 s) e rodam por padrão em US East (Ohio).

---

## 6. Viabilidade da Netlify Free

Fontes oficiais (consultadas em 2026-10-07):

- Créditos e custos: <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/>
- O que acontece ao estourar: <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/>
- Preços: <https://www.netlify.com/pricing/>
- Uso comercial no Free: <https://www.netlify.com/blog/introducing-netlify-free-plan/> ("On the Free plan, you can deploy commercial projects")
- Next.js na Netlify (Server Actions, Route Handlers, Streaming, Middleware): <https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/>
- Next 16 suportado: <https://www.netlify.com/changelog/next-js-16-deploy-on-netlify/>
- Agendamento no Free: <https://docs.netlify.com/build/functions/scheduled-functions/> ("available on all pricing plans")
- Limites das funções: <https://docs.netlify.com/build/functions/configuration/>

| Pergunta | Resposta |
| --- | --- |
| Uso comercial no Free? | **Sim** (proibido apenas revender a hospedagem) |
| Créditos | 300 por mês, **limite rígido**: não dá para comprar mais no Free |
| Deploy de produção | **15 créditos cada** (preview e branch deploys não gastam; falha e rollback não gastam) |
| Funções (SSR, Server Actions, rotas) | 10 créditos por GB-hora (1 GB por padrão) |
| Banda | 20 créditos por GB |
| Requisições | 2 créditos por 10 mil |
| Ao estourar | **TODOS os sites da conta saem do ar** ("Site not available") até o próximo ciclo, e não dá para publicar. Avisos por e-mail em 50/75/90/100% |
| Next 16.3 + `src/proxy.ts`, Server Actions, route handlers, streaming | Oficialmente suportados (adaptador v5.16.2). **No teste local, o `proxy.ts` falhou ao empacotar** (ver a seção 10). Confirmar num Deploy Preview, que é grátis, antes de escolher a Netlify |

### Estimativa de consumo (4 eventos/mês, ~100 ingressos cada)

Hipóteses: ~2.000 visitas por evento (8.000 por mês), todas as páginas dinâmicas, ~40 requisições por visita, ~0,5 MB por visita nova (as imagens de capa vêm do Storage do banco, não da Netlify) e ~400 pedidos com consulta do PIX a cada 4 s.

| Item | Uso estimado | Créditos |
| --- | --- | --- |
| 20 deploys de produção | 20 × 15 | **300** |
| Requisições | ~350–500 mil | 70–100 |
| Banda | ~4–6 GB | 80–120 |
| Funções | ~4–6 GB-hora | 40–60 |
| **Total com 20 deploys** | | **~490–580 → estoura e o site sai do ar** |
| **Total com 4 deploys** (1 por semana) | 60 + tráfego | **~250–340 → no limite** |

**Conclusão:** a Netlify Free é **arriscada** para vendas, e a compatibilidade do `proxy.ts` ainda precisa ser provada num Deploy Preview. Só os 20 deploys já consomem o mês inteiro, e estourar derruba o site no meio de uma venda. Ela só serve se houver no máximo ~4 deploys de produção por mês e tráfego modesto. A Netlify Personal (US$ 9/mês, 1.000 créditos, recarga automática opcional) resolveria, mas é paga.

### Cloud Run (comparação rápida)

Fontes: <https://cloud.google.com/run/pricing> e <https://cloud.google.com/free/docs/free-cloud-features>

- A franquia grátis mensal (cobrança por requisição) é de 180 mil vCPU-s, 360 mil GiB-s e 2 milhões de requisições. O uso estimado acima fica muito abaixo disso.
- **Exige conta de cobrança com cartão** (o Free Trial pede cartão; depois de 90 dias é preciso passar para a conta paga para manter os recursos). Podem aparecer custos pequenos fora da franquia: saída de dados para o Brasil, Artifact Registry acima de 0,5 GB e Cloud Build.
- **Cold start:** sem instância mínima, o primeiro acesso depois de um tempo parado espera ~2–5 s enquanto o container Next sobe. Manter 1 instância mínima elimina a espera, mas custa ~US$ 7–10/mês.
- Precisa de `gcloud`, Artifact Registry e mapeamento de domínio (ou balanceador). É mais trabalho que as outras opções para sexta.

Passo a passo resumido, se escolhido:
```bash
gcloud run deploy byla-eventos --source . --region us-central1 \
  --allow-unauthenticated --port 3000 --memory 512Mi --cpu 1 \
  --set-env-vars TRUSTED_IP_HEADER=x-forwarded-for-last,... \
  --set-build-env-vars NEXT_PUBLIC_SUPABASE_URL=...,NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
```
(Com `--source`, o Cloud Build usa o `Dockerfile`; prefira Secret Manager para os segredos.)

---

## 7. Agendamento fora da Vercel (keep-alive diário)

A rota `/api/cron/keep-alive` continua igual (GET com `Authorization: Bearer <CRON_SECRET>`). Ela evita a pausa do banco grátis e envia os avisos de sessão que ficaram na fila.

**Migration preparada (NÃO aplicada):** `supabase/migrations/20261015100000_keep_alive_schedule.sql`

- Cria `public.invoke_keep_alive()` (pg_net) e agenda o job `keep-alive-diario` às **00:00 UTC** (21h em Brasília).
- **Fica inerte** (a função retorna sem chamar nada) enquanto o Vault não tiver as duas entradas abaixo. Por isso pode ser aplicada antes da troca de hospedagem.

Para ativar (com aprovação do dono, pelo MCP `supabase-eventos`, projeto Espaço Byla Eventos):
1. Aplicar a migration.
2. O dono cadastra no Vault (Supabase → Project Settings → Vault), ele mesmo:
   - `keep_alive_cron_secret` = o mesmo valor de `CRON_SECRET` (32+ caracteres)
   - `keep_alive_cron_url` = `https://<domínio-novo>/api/cron/keep-alive`
3. Conferir no dia seguinte: `select status, return_message from cron.job_run_details order by start_time desc limit 5;` e o log da rota (status 200).
4. Depois do corte, apagar o `vercel.json` (ou o projeto da Vercel) para não haver duas chamadas.

**Lembrete de carrinho abandonado (se ativado):** a função `invoke_abandoned_reminders` usa a Vercel por padrão. Ao trocar de domínio, cadastre no Vault `reminder_cron_url` = `https://<domínio-novo>/api/cron/abandoned-reminders`.

Teste manual sem esperar a meia-noite (ele envia avisos de sessão pendentes, se houver):
```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domínio-novo>/api/cron/keep-alive
```

---

## 8. Plano de corte (sem derrubar a venda)

**Antes (quinta, 08/10):**
1. O dono aprova o merge de `feat/sair-vercel` e escolhe o destino.
2. O dono cria as chaves do Turnstile (seção 2) e coloca na hospedagem nova **e também na Vercel**, porque este código passa a exigi-las também lá.
3. Subir o destino novo **em paralelo**, num endereço temporário (`*.netlify.app`, `ingressos.espacobyla.online` ou URL do Cloud Run). A Vercel continua no ar.
4. Testes no endereço novo, com celular de verdade:
   - home, página do evento, checkout (widget invisível; o pedido é criado);
   - **IP:** fazer 2 checkouts de redes diferentes (Wi-Fi e 4G) e conferir que não aparece "Muitas tentativas" de forma indevida;
   - área da equipe: login, painel, check-in;
   - `curl` do keep-alive com o segredo (resposta 200) e sem o segredo (resposta 401).
5. **Mercado Pago:** em Suas integrações → aplicação do site → **Webhooks** (evento "Order (Mercado Pago)"), trocar a URL para `https://<domínio-novo>/api/payments/webhook`. A assinatura secreta continua a mesma.
6. **Compra real pequena** no domínio novo (PIX ou cartão), conferir o e-mail com os ingressos e o aviso de pagamento confirmado pelo webhook (log da rota), depois **estornar** pela equipe.
7. **Supabase Auth** (Authentication → URL Configuration): trocar o *Site URL* para o domínio novo e adicionar o domínio novo em *Redirect URLs*. O login é por senha, então isso afeta só e-mails de convite e recuperação.
8. `NEXT_PUBLIC_APP_URL` = domínio novo (os links dos e-mails), e publicar de novo.

**Corte (antes de abrir as vendas de sexta):**
9. Divulgar só o link novo e atualizar os links da bio e do Instagram.
10. Ativar o agendamento pelo pg_cron (seção 7).
11. Na Vercel: cadastrar um redirecionamento permanente do domínio antigo para o novo (ou deixar o projeto no ar por alguns dias só para links antigos) e depois **pausar e apagar o projeto**. Isso também desliga o Vercel Cron.

**Voltar atrás:** como a Vercel fica no ar até o fim, basta voltar a URL do webhook no Mercado Pago e divulgar o link antigo.

---

## 9. Segurança (conferido)

- Segredos só em módulos `server-only` (`TURNSTILE_SECRET_KEY` em `src/lib/security/bot.ts`); `.dockerignore` exclui `.env*`, `.git`, `.superpowers`, `.security` e `docs`.
- O container roda com usuário não-root (`nextjs`, uid 1001) e a porta 3000 só em `127.0.0.1` na VPS.
- O token do Turnstile é validado no servidor (tamanho, ação esperada, tempo limite de 5 s) e falha fechado.
- A migration é aditiva: `revoke` para `public/anon/authenticated/service_role`, `search_path` vazio, URL e segredo só pelo Vault, endereço validado por regex `https://…/api/cron/keep-alive`.

## 10. Verificações feitas (2026-10-07, local, sem conta nem banco real)

- `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (todos os testes) e `npm run build`: OK.
- Build `NEXT_OUTPUT_STANDALONE=true` + `node .next/standalone/server.js`: `/privacidade` responde 200 com a CSP nova; `/api/cron/keep-alive` sem segredo responde 401; `/equipe` redireciona (307) para o login.
- `netlify build --offline` (netlify-cli 27.11.2, adaptador Next v5.16.2, sem login, no Windows): o build do Next e a função do servidor (páginas, Server Actions, rotas) **passaram**; o empacotamento do `proxy.ts` como Edge Function **falhou** com `Failed to compile CJS module … Cannot find module './chunks/[turbopack]_runtime.js'`, num caminho Windows corrompido (`file:///Users/…/C:/Users/…`). Pode ser só um problema do Windows (a Netlify compila em Linux), mas há relatos parecidos em Linux com o proxy do Next 16 em Node (opennextjs/opennextjs-netlify#3171). **Não confirmado:** a tentativa de repetir em Linux via Docker não foi possível (o Docker Desktop local não subiu). Se for usar a Netlify, a primeira coisa é um Deploy Preview (0 créditos) para validar.
- Imagem Docker: não testada localmente (mesmo motivo). O build `standalone` que ela usa foi testado fora do Docker (ver acima).
- `npm audit --omit=dev`: 0 vulnerabilidades (os 5 alertas "altos" são só de dependências de desenvolvimento e já existiam no `main`).
