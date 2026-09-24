## Learned User Preferences

- Communicate in clear Portuguese; UI copy targets Admin/ops (event organization), not developer jargon.
- Ask clarifying questions one at a time; when the user says "calma" or signals confusion ("não entendi", "como assim"), pause and explain in simple non-technical terms.
- Keep short wrap-ups: what was decided, what is pending, and the next step.
- Prefer a public GitHub repo for professional portfolio, with zero PII (real names, emails, phones, dumps, secrets) in Git.
- Hard-gate phase 0: no scaffold, app code, or final library lock until the design/spec is approved.
- Prefer human confirmation on ambiguous product decisions (suggestion ≠ effective decision).
- Prefer Subagent-Driven execution for multi-task implementation plans when offered a choice.
- Prefer zero paid spend (no Supabase Pro) when choosing hosting/database options; still target real production, not local-only demos.

## Learned Workspace Facts

- Product name is Espaço Byla Eventos — multi-event ticket platform exclusive to Espaço Byla (create/manage events like Sympla/Shotgun), aiming for near-zero marketplace fees.
- This repo is new and separate from Byla Financeiro; reuse engineering practices and discipline, not real client data or tight Financeiro schema coupling in v1.
- MVP scope locked: online checkout on-site, Admin and secretaria only (shared ops including QR check-in; no external producers), inteira/meia with optional cortesia (team-issued), payment exclusively via the site, public shareable event links plus home of active events.
- Buyer pays with any bank/app; funds land in Espaço Byla’s account via the payment provider (no Sympla/Shotgun in the middle).
- Approved MVP stack in use: Next.js (App Router) + Supabase (Auth/RLS/Postgres); deploy from GitHub `main` on Vercel; payment via Mercado Pago Checkout Pro (`PaymentProvider` adapter).
- Mercado Pago is the active payment provider after PagBank production allowlist blocked Checkout API; secrets only in `.env.local` / deploy env.
- Design/spec and implementation plan are approved under `docs/superpowers/`; MVP implementation lives on branch `feat/mvp`.
- Dedicated Eventos Supabase project: name **Espaço Byla Eventos**, ref `rlzyjlrcasqbjztgbgit`, separate Espaço Byla account/org; app secrets only in `.env.local`.
- In this workspace, agents must use MCP `supabase-eventos` / `user-supabase-eventos` only; never Financeiro MCP/project `Byla` or tables like `alunos`/`transacoes`.
- Isolation rule: `.cursor/rules/supabase-isolamento-eventos.mdc` (alwaysApply) — confirm project fingerprint before any DDL.
- Go-live still pending outside Git: Mercado Pago test→production credentials, public HTTPS URL (Vercel), Resend, and Vercel deploy with secrets only in production env.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
