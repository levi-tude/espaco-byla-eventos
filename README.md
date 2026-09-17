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

## Dados e privacidade

Este repositório **não contém dados reais** (PII, dumps, credenciais ou informações de clientes). Dados de produção ficam exclusivamente no Supabase autenticado e nos serviços de pagamento configurados no ambiente — nunca no Git.
