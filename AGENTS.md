## Learned User Preferences

- Communicate in clear Portuguese; UI copy targets Admin/ops (event organization), not developer jargon.
- Ask clarifying questions one at a time; when the user says "calma" or signals confusion ("não entendi", "como assim"), pause and explain in simple non-technical terms, sticking to verified facts (no invention).
- Keep short wrap-ups: what was decided, what is pending, and the next step.
- Prefer a public GitHub repo for professional portfolio, with zero PII (real names, emails, phones, dumps, secrets) in Git.
- Hard-gate phase 0: no scaffold, app code, or final library lock until the design/spec is approved.
- Prefer human confirmation on ambiguous product decisions (suggestion ≠ effective decision).
- Prefer Subagent-Driven execution for multi-task implementation plans when offered a choice.
- Prefer zero paid spend (no Supabase Pro) when choosing hosting/database options; still target real production, not local-only demos.
- Buyer experience must match Sympla/Shotgun: pay inside the site (PIX, cards, wallets) with no payment-provider login or account; benchmark flows professionally against those platforms and market standards.
- Verify flows yourself in the browser before handing them to the user to test; it must "just work" for non-technical buyers.

## Learned Workspace Facts

- Product name is Espaço Byla Eventos — multi-event ticket platform exclusive to Espaço Byla (create/manage events like Sympla/Shotgun), aiming for near-zero marketplace fees; buyers pay with any bank/app and funds land in Espaço Byla’s payment-provider account (no Sympla/Shotgun in the middle).
- This repo is new and separate from Byla Financeiro; reuse engineering practices and discipline, not real client data or tight Financeiro schema coupling in v1.
- MVP scope locked: online checkout on-site, Admin and secretaria only (shared ops including QR check-in; no external producers), inteira/meia with optional cortesia (team-issued), payment exclusively via the site, public shareable event links plus home of active events.
- Approved MVP stack in use: Next.js (App Router) + Supabase (Auth/RLS/Postgres) + Vitest (`@types/node` ^22 for peer compatibility); deploy from GitHub `main` on Vercel.
- Payment: Mercado Pago Checkout Bricks (Payment Brick, `@mercadopago/sdk-react`) embedded on `/pedidos/[publicToken]`, PIX + card, no Mercado Pago login, backed by the **Orders API** (`/v1/orders`, migrated from Payments API on 2026-09-30); replaced Checkout Pro redirect (PagBank was dropped after its allowlist blocked Checkout API). Decision doc: `docs/superpowers/plans/payment-provider-decision.md`.
- Payment flow: server creates `/v1/orders` with amount from DB, `external_reference = orderId` and idempotency key; order page polls `/v1/orders` search by `external_reference`; webhook only confirms processed orders — declined card or expired PIX never cancels the order. Checkout offers only PIX + credit card (MP online debit in Brazil is Caixa-only, so debit was removed; Google Pay/Apple Pay aren't available via MP).
- Mercado Pago uses a Checkout Transparente app created with "API de Orders" in the real account. Its "Credenciais de teste" are `APP_USR-` (auto-created test seller); `TEST-` keys are rejected by Orders (`invalid_credentials`). Test payer email must end in `@testuser.com`; cards require a minimum amount; test PIX only generates the QR. Orders webhooks are configured in the app panel (event "Order (Mercado Pago)", URL `/api/payments/webhook`), not via `notification_url`. Production keys of that same app are live on Vercel.
- Supabase Eventos is on the free plan and pauses after ~7 days of low DB activity (host stops resolving); a daily Vercel Cron (`vercel.json` → `/api/cron/keep-alive`, protected by `CRON_SECRET`) does real table reads to prevent it. If it still pauses, restore from the Supabase dashboard.
- Security baseline (2026-09-30 audit): `src/proxy.ts` runs on every page and sets a nonce CSP (`src/lib/security/csp.ts`; add new third-party hosts there) plus the staff login gate; its matcher must never skip prefetch requests (the team layout trusts `x-pathname`). Checkout/payment actions call Vercel BotID (`src/instrumentation-client.ts` lists protected paths) and a DB rate limit (`consume_rate_limit`, service_role only). Server Actions must return expected errors instead of throwing, because Next hides thrown messages in production. Security master prompt: `docs/security/`; the audit report is private in gitignored `.security/`.
- Design/spec and plans (MVP + 2026-09-21 UI redesign) are approved under `docs/superpowers/`; implementation lives on branch `feat/mvp`.
- UI: light/dark theme via `next-themes` (default dark), brand CTA blue `#4080FC`, accent yellow `#FFBD38`; brand references live in gitignored `.design-refs/`.
- Dedicated Eventos Supabase project: name **Espaço Byla Eventos**, ref `rlzyjlrcasqbjztgbgit`, separate Espaço Byla account/org; app secrets only in `.env.local`.
- In this workspace, agents must use MCP `supabase-eventos` / `user-supabase-eventos` only; never Financeiro MCP/project `Byla` or tables like `alunos`/`transacoes`. Isolation rule `.cursor/rules/supabase-isolamento-eventos.mdc` (alwaysApply, local only since `.cursor/` is gitignored) requires confirming the project fingerprint before any DDL.
- Live in production: public repo `levi-tude/espaco-byla-eventos`, Vercel project `espaco-byla-eventos` (Hobby, pushes to `main` deploy) at https://espaco-byla-eventos.vercel.app, with MP production keys, secrets only in Vercel production env. Server date handling uses `America/Sao_Paulo` (`src/lib/datetime.ts`) because Vercel runs in UTC. Still pending: real-phone check-in validation.
- Ticket email is live via Resend (team `espacobylaeventos`, free plan) from `Espaço Byla <ingressos@espacobyla.online>`; domain `espacobyla.online` (Hostinger DNS, expires 2027-02-19) also hosts n8n (`n8n` A record) — only add DNS records there, never edit/delete existing ones. The email is sent only on first paid confirmation and embeds each ticket's QR (same generator as the ticket page, `src/lib/tickets/qr.ts`) as CID images plus a "Ver meus ingressos" button.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
