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
- Payment: Mercado Pago Checkout Bricks (Payment Brick, `@mercadopago/sdk-react`) embedded on `/pedidos/[publicToken]`, PIX + card, no Mercado Pago login; replaced Checkout Pro redirect (PagBank was dropped after its allowlist blocked Checkout API). Decision doc: `docs/superpowers/plans/payment-provider-decision.md`.
- Payment flow: server creates `/v1/payments` with amount from DB, `external_reference = orderId` and idempotency key; order page polls `/v1/payments/search` by `external_reference`; webhook only confirms approved payments — declined card or expired PIX never cancels the order.
- Mercado Pago testing uses the **real account's** "Credenciais de teste" (`TEST-` prefix) from a Checkout Transparente app (API de Payments); test-seller `APP_USR-` keys fail on `/v1/payments` ("Unauthorized use of live credentials"). Payer email must differ from the MP account email; cards require a minimum amount (R$ 0,01 shows only PIX); test PIX only generates the QR. The panel flags the Payments API as deprecated (Orders API is the successor).
- Supabase Eventos is on the free plan and pauses after ~7 days of low DB activity (host stops resolving); a daily Vercel Cron (`vercel.json` → `/api/cron/keep-alive`, protected by `CRON_SECRET`) does real table reads to prevent it. If it still pauses, restore from the Supabase dashboard.
- Design/spec and plans (MVP + 2026-09-21 UI redesign) are approved under `docs/superpowers/`; implementation lives on branch `feat/mvp`.
- UI: light/dark theme via `next-themes` (default dark), brand CTA blue `#4080FC`, accent yellow `#FFBD38`; brand references live in gitignored `.design-refs/`.
- Dedicated Eventos Supabase project: name **Espaço Byla Eventos**, ref `rlzyjlrcasqbjztgbgit`, separate Espaço Byla account/org; app secrets only in `.env.local`.
- In this workspace, agents must use MCP `supabase-eventos` / `user-supabase-eventos` only; never Financeiro MCP/project `Byla` or tables like `alunos`/`transacoes`. Isolation rule `.cursor/rules/supabase-isolamento-eventos.mdc` (alwaysApply, local only since `.cursor/` is gitignored) requires confirming the project fingerprint before any DDL.
- Go-live still pending outside Git: Mercado Pago test→production credentials, public HTTPS URL (Vercel), Resend, and Vercel deploy with secrets only in production env.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
