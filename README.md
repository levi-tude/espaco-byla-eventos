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

## Pagamentos

O MVP usa o **Checkout PagBank com PIX**. A decisão e a comparação com o
Mercado Pago estão em
[`docs/superpowers/plans/payment-provider-decision.md`](docs/superpowers/plans/payment-provider-decision.md).

Para testar, crie uma credencial no sandbox do PagBank e configure somente em
`.env.local`:

```dotenv
PAYMENT_PROVIDER=pagbank
PAGBANK_TOKEN=seu-token-de-sandbox
PAGBANK_API_URL=https://sandbox.api.pagseguro.com
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

O webhook deve apontar para
`https://seu-dominio/api/payments/webhook`. O adapter valida
`x-authenticity-token` quando `PAGBANK_TOKEN` está configurado. Nunca coloque
tokens reais no Git.

## E-mail dos ingressos

Após a confirmação do pagamento, o sistema envia pelo Resend um link para a
página dos ingressos. Configure `RESEND_API_KEY` e `RESEND_FROM_EMAIL`. Sem
essas variáveis, o pagamento continua normalmente e o servidor registra um
aviso sem tentar o envio.

## Dados e privacidade

Este repositório **não contém dados reais** (PII, dumps, credenciais ou informações de clientes). Dados de produção ficam exclusivamente no Supabase autenticado e nos serviços de pagamento configurados no ambiente — nunca no Git.
