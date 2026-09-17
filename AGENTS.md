## Learned User Preferences

- Communicate in clear Portuguese; UI copy targets Admin/ops (event organization), not developer jargon.
- Ask clarifying questions one at a time; when the user says "calma", pause and explain in simple terms.
- Keep short wrap-ups: what was decided, what is pending, and the next step.
- Prefer a public GitHub repo for professional portfolio, with zero PII (real names, emails, phones, dumps, secrets) in Git.
- Hard-gate phase 0: no scaffold, app code, or final library lock until the design/spec is approved.
- Prefer human confirmation on ambiguous product decisions (suggestion ≠ effective decision).

## Learned Workspace Facts

- Product name is Espaço Byla Eventos — ticket sales and control for Espaço Byla events/shows, aiming for near-zero marketplace fees versus Sympla/Shotgun.
- This repo is new and separate from Byla Financeiro; reuse engineering practices and discipline, not real client data or tight Financeiro schema coupling in v1.
- MVP direction locked so far: online checkout on-site, Admin Byla only (no external producers), inteira/meia with optional cortesia, QR check-in on phone, payment exclusively via the site, public shareable event links.
- Approved MVP stack: Next.js (App Router) + Supabase (Auth/RLS/Postgres); deploy from GitHub `main` on Vercel; payment provider evaluated starting with PagBank.
- PagBank is the studio bank in the Byla ecosystem; evaluate it (and alternatives) for on-site payments in the design without inventing sensitive integrations in public Git.
- Phase 0 follows Superpowers: brainstorm → sectioned design approval → spec under `docs/superpowers/specs/` → implementation plan; do not force Financeiro integration in v1 without approved design.
