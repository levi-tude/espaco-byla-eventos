# Espaço Byla Eventos

Plataforma de venda e controle de ingressos para eventos e shows do **Espaço Byla**, com checkout online, admin interno e check-in por QR — reduzindo taxas de marketplaces externos.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS
- **Supabase** (Auth, Postgres, RLS)
- **Vitest** para testes
- Deploy previsto: Vercel (branch `main`)

## Como rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha com credenciais reais (nunca commite)
npm run dev
```

> **Nota (Vitest):** na instalação inicial das dependências de teste foi necessário `npm install -D vitest @vitejs/plugin-react jsdom vite --legacy-peer-deps` (conflito de peer deps com `@types/node@20`) e incluir `vite` explicitamente como devDependency (runtime do Vitest).

Acesse [http://localhost:3000](http://localhost:3000).

## Scripts

| Comando        | Descrição              |
| -------------- | ---------------------- |
| `npm run dev`  | Servidor de desenvolvimento |
| `npm run build`| Build de produção      |
| `npm run start`| Servidor de produção   |
| `npm test`     | Testes (Vitest)        |
| `npm run lint` | ESLint                 |

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha os valores. O arquivo `.env.example` documenta as chaves necessárias **sem segredos reais**.

## Deploy na Vercel

1. Importe o repositório na Vercel e mantenha `main` como branch de produção.
2. Cadastre no projeto todas as chaves de `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_PROVIDER`,
   `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`,
   `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY` e `RESEND_FROM_EMAIL`.
3. Em produção, defina `NEXT_PUBLIC_APP_URL` com a URL pública da aplicação e
   use credenciais de produção do Supabase, Mercado Pago e Resend.
4. O webhook de pagamento é
   `https://seu-dominio/api/payments/webhook` (também enviado como
   `notification_url` na preferência).
5. Faça o deploy e valide compra, confirmação do pagamento, emissão do QR e
   check-in antes de abrir as vendas.

Não coloque tokens no repositório nem use os valores de produção em Preview ou
Development. Este repositório não cria o projeto Vercel automaticamente.

## Pagamentos

O MVP usa o **Mercado Pago Checkout Bricks** (pagamento embutido no site, PIX e cartão). A decisão está em
[`docs/superpowers/plans/payment-provider-decision.md`](docs/superpowers/plans/payment-provider-decision.md).

Para testar, use as **credenciais de teste** (`TEST-`) de uma aplicação
Checkout Transparente criada na conta real do Mercado Pago Developers e
configure somente em `.env.local`:

```dotenv
PAYMENT_PROVIDER=mercadopago
MERCADOPAGO_ACCESS_TOKEN=seu-access-token-de-teste
MERCADOPAGO_PUBLIC_KEY=sua-public-key-de-teste
NEXT_PUBLIC_APP_URL=https://sua-url-publica
```

`NEXT_PUBLIC_APP_URL` precisa ser **https público** (não localhost) para o
Mercado Pago aceitar retorno e notificação. Nunca coloque tokens reais no Git.

## E-mail dos ingressos

Após a confirmação do pagamento, o sistema envia pelo Resend um link para a
página dos ingressos. Configure `RESEND_API_KEY` e `RESEND_FROM_EMAIL`. Sem
essas variáveis, o pagamento continua normalmente e o servidor registra um
aviso sem tentar o envio.

## Dados e privacidade

Este repositório **não contém dados reais** (PII, dumps, credenciais ou informações de clientes). Dados de produção ficam exclusivamente no Supabase autenticado e nos serviços de pagamento configurados no ambiente — nunca no Git.
