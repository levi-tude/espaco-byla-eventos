# Ficha de segurança — Espaço Byla Eventos

> Use junto com `master-prompt-seguranca.md`. Esta ficha não contém segredos
> nem dados pessoais; o relatório detalhado de auditoria fica fora do Git.

## O que é
Plataforma de venda de ingressos exclusiva do Espaço Byla (estilo
Sympla/Shotgun). O comprador escolhe inteira/meia, paga dentro do site (PIX ou
cartão de crédito, sem login) e recebe os ingressos com QR Code na página do
pedido e por e-mail. A equipe (Admin/secretaria) cria eventos, emite
cortesias, cancela ingressos e faz check-in por QR na porta.

## Stack e provedores
- Front/back: Next.js 16 (App Router, Server Components, Server Actions,
  `src/middleware.ts` como proxy), React 19, TypeScript; testes com Vitest.
- Banco/Auth: Supabase (Postgres + RLS + Auth por e-mail/senha), plano
  gratuito, projeto **Espaço Byla Eventos** (único permitido).
- Pagamentos: Mercado Pago — Payment Brick (cartão tokenizado no navegador) +
  API de Orders (`/v1/orders`) no servidor; webhook configurado no painel.
- E-mail: Resend, remetente `ingressos@espacobyla.online` (DKIM/SPF/DMARC).
- Hospedagem: Vercel (Hobby), deploy automático a partir de `main`; cron diário
  que mantém o banco ativo.
- Repositório: GitHub **público** (portfólio).
- Domínio/DNS: `espacobyla.online` na Hostinger; o mesmo domínio atende o n8n
  do Espaço (subdomínio `n8n`) — só **adicionar** registros, nunca editar ou
  apagar os existentes.

## Ativos e dados sensíveis
- Dinheiro das vendas (conta Mercado Pago do Espaço Byla).
- Dados pessoais dos compradores: nome, e-mail, telefone (opcional); CPF é
  enviado ao Mercado Pago no pagamento e **não** é guardado no banco.
- Ingressos (código do QR = direito de entrada) e links de pedido
  (`/pedidos/<token>` funcionam como "senha" de acesso ao ingresso).
- Contas da equipe (login Supabase + cadastro em `staff_profiles`).
- Chaves: `SUPABASE_SERVICE_ROLE_KEY`, `MERCADOPAGO_ACCESS_TOKEN`,
  `RESEND_API_KEY`, `CRON_SECRET` (valores nunca no Git nem no chat).

## Atores e papéis
- **Visitante/comprador (anônimo):** vê eventos com venda aberta, cria pedido,
  paga, vê o próprio pedido pelo link.
- **Equipe (Admin/secretaria, mesmo nível):** tudo da área `/equipe`: criar e
  editar eventos, abrir/fechar venda, cortesia, cancelar ingresso, check-in.
- **Atacante anônimo / com conta Supabase sem cadastro de equipe / bot.**
- **Provedores:** Mercado Pago (webhook), Resend, Vercel Cron.

## Pontos de entrada
- Páginas públicas: `/`, `/eventos/[slug]`, `/eventos/[slug]/checkout`,
  `/pedidos/[publicToken]`.
- Ações de servidor públicas: `startCheckout`, `payOrder`, `checkOrderPayment`.
- Área restrita: `/equipe/**` (login em `/equipe/login`); ações `createEvent`,
  `updateEvent`, `setSalesOpen`, `issueCourtesy`, `cancelTicket`, `signOut`.
- APIs: `POST /api/check-in` (equipe), `GET|POST /api/payments/webhook`
  (Mercado Pago), `GET /api/cron/keep-alive` (Vercel Cron com segredo).
- Banco exposto pela API do Supabase com a chave pública (`anon`): tabelas com
  RLS e funções RPC.

## Regras de negócio críticas
- Preço e total calculados no banco (`create_checkout_order`), 1 a 10
  ingressos por pedido, só inteira/meia no checkout (cortesia só pela equipe).
- Capacidade respeitada com trava no banco; reserva de 30 min para pedido
  pendente.
- Pedido só vira "pago" quando o Mercado Pago confirma (consulta à API);
  cartão recusado ou PIX expirado **não** cancela o pedido.
- E-mail com ingressos enviado uma vez, na primeira confirmação de pagamento.
- Check-in: ingresso pago do evento certo, uso único.

## Onde ficam os segredos
- Local: `.env.local` (ignorado pelo Git).
- Produção: variáveis da Vercel **somente** no ambiente Production (segredos
  como "Secret").

## Restrições do agente
- Português simples; o dono não é técnico. Uma pergunta por vez.
- Só o MCP/projeto Supabase **Espaço Byla Eventos**; nunca o projeto do Byla
  Financeiro nem tabelas como `alunos`/`transacoes` — se aparecerem, parar.
- Antes de qualquer SQL de escrita/migração: declarar MCP + projeto, conferir as
  tabelas `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles` e
  pedir aprovação.
- Zero PII e zero segredos no Git.

## Limites da auditoria
- Produção: apenas testes passivos.
- Local: ataques simulados permitidos, mas o ambiente local usa **o mesmo
  banco** de produção — só ataques que devem ser barrados antes de escrever,
  com retrato do banco antes/depois.
- Painéis que só o dono acessa (Mercado Pago, Resend, Hostinger, Vercel web,
  Supabase web, GitHub web) são verificados com a ajuda dele.
