# Redesign UI Espaço Byla Eventos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar o visual “noite cultural” do spec em cima do MVP já funcional, sem reescrever regras de negócio, Supabase, check-in ou adapter PagBank.

**Architecture:** Skin + shell compartilhados (tokens CSS, header, fontes) sobre rotas e actions existentes. shadcn/ui só onde houver controle interativo (botão, input, dialog). Páginas públicas e `/equipe` continuam Server Components + clients atuais; só markup/classes e poucos componentes de apresentação novos.

**Tech Stack:** Next.js 16 App Router (já), Tailwind 4 (já), shadcn/ui + Radix, Lucide, Motion — conforme `docs/superpowers/specs/2026-09-21-espaco-byla-eventos-ui-design.md`.

## Global Constraints

- Produto no UI: **Espaço Byla Eventos** (venda de ingressos; não site institucional).
- Não alterar RPCs, RLS, actions de cortesia/cancelamento, API check-in, webhook PagBank (exceto copy de erro amigável no checkout se token ausente).
- Paleta: fundo `#0A0A0B`/`#111`, CTA `#4080FC`, destaque `#FFBD38`, apoio `#0C3974`.
- Logo: extrair do brand book em `.design-refs/` → `public/brand/` (sem commit de PDF/PII).
- `.design-refs/` permanece no `.gitignore`.
- Mobile-first; hero público ≠ painel da equipe (equipe = ferramenta).
- Commits só se o usuário pedir.

---

## File map (o que já existe vs o que entra)

**Já existe — reutilizar lógica, só restyle:**

- `src/app/page.tsx` — home / lista de eventos
- `src/app/eventos/[slug]/page.tsx` — página do evento
- `src/app/eventos/[slug]/checkout/*` — checkout + `startCheckout`
- `src/app/pedidos/[publicToken]/page.tsx` + `TicketQr` + `DownloadTicketPdf` + `TicketPageNav`
- `src/app/equipe/**` + `TicketList` + `CheckInScanner` + `EventForm`
- `src/app/layout.tsx`, `src/app/globals.css`

**Criar:**

- `public/brand/logo-flower-white.png` (e variantes mínimas necessárias)
- `src/components/brand/SiteHeader.tsx`
- `src/components/brand/EventCover.tsx` (capa / placeholder)
- `src/components/ui/*` — via shadcn (button, input, label, dialog conforme necessidade)
- Opcional: `src/components/public/HomeHero.tsx`, `EventCard.tsx` se `page.tsx` ficar pesado

---

### Task 1: Tokens, fontes, logo e shell

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `public/brand/*` (PNG da flor mono clara + círculo amarelo se útil)
- Create: `src/components/brand/SiteHeader.tsx`
- Modify: `.gitignore` (já tem `.design-refs/` — confirmar)

**Interfaces:**
- Consumes: assets em `.design-refs/logo-extract-p15-3-480x480.png` (flor branca) e/ou `logo-extract-p1-5-800x800.png`
- Produces: `SiteHeader` com props `{ variant?: "public" | "equipe" }`; CSS variables `--byla-bg`, `--byla-blue`, `--byla-yellow`, `--byla-navy`

- [ ] **Step 1:** Copiar PNGs de logo úteis de `.design-refs/` para `public/brand/` (renomear claro: `flower-white.png`, `mark-yellow-blue.png`).
- [ ] **Step 2:** Em `globals.css`, definir tokens da marca, fundo escuro default, remover dependência de `prefers-color-scheme` claro que quebra o tema noite.
- [ ] **Step 3:** Trocar Geist por Open Sans (corpo) + uma display livre (ex. `Bebas Neue` ou `Oswald` italic) via `next/font/google` no `layout.tsx`; metadata já diz Espaço Byla Eventos — manter.
- [ ] **Step 4:** Criar `SiteHeader` (logo + texto “Espaço Byla Eventos” → `/`).
- [ ] **Step 5:** Envolver `body` com classes escuras; incluir header no layout público **ou** documentar que cada rota importa o header (preferir layout group `(public)` só se for low-friction; senão header por página na Task 2).
- [ ] **Step 6:** `npm run build` — deve passar.

---

### Task 2: Home pública (1 hero / N grade / 0 vazio)

**Files:**
- Modify: `src/app/page.tsx`
- Create (opcional): `src/components/public/HomeHero.tsx`, `src/components/public/EventCard.tsx`
- Optionally add: `motion` dependency for fade-in

**Interfaces:**
- Consumes: mesmo query Supabase atual (`sales_open`, `cover_image_url`, etc.)
- Produces: UI conforme spec §4 — sem mudar query

- [ ] **Step 1:** Se `events.length === 1`, renderizar hero full-bleed + CTA “Garantir ingresso” → `/eventos/[slug]`.
- [ ] **Step 2:** Se `length >= 2`, grade com capas grandes + “Ver evento”.
- [ ] **Step 3:** Se `length === 0` ou erro, estados calmos no tema escuro (copy atual ok, só visual).
- [ ] **Step 4:** Usar `SiteHeader`; copy = programação/ingressos, não institucional.
- [ ] **Step 5:** Motion mínimo (opacity/y) se `motion` instalado; senão CSS transition.
- [ ] **Step 6:** Verificar visualmente em `npm run dev` (1 evento / vários — ajustar dados locais se preciso). `npm run build`.

---

### Task 3: Página do evento

**Files:**
- Modify: `src/app/eventos/[slug]/page.tsx`

**Interfaces:**
- Consumes: dados e tipos de ingresso já carregados na página
- Produces: mesma navegação para checkout; visual spec §5

- [ ] **Step 1:** Restyle capa + título + data/local + preços Inteira/Meia + CTA “Comprar ingresso”.
- [ ] **Step 2:** CTA sticky/bottom no mobile se o markup atual permitir sem reescrever lógica.
- [ ] **Step 3:** Remover qualquer tom institucional; link voltar à home “Programação”.
- [ ] **Step 4:** `npm run build`.

---

### Task 4: Checkout (visual + copy se PagBank ausente)

**Files:**
- Modify: `src/app/eventos/[slug]/checkout/page.tsx`
- Modify: `src/app/eventos/[slug]/checkout/checkout-form.tsx`
- Modify: `src/app/eventos/[slug]/checkout/actions.ts` **somente** se a mensagem de erro de `PAGBANK_TOKEN` for técnica demais — mapear para frase amigável na UI

**Interfaces:**
- Consumes: `startCheckout` / `CheckoutForm` existentes
- Produces: formulário escuro; sem cobrança falsa

- [ ] **Step 1:** Restyle página + form (shadcn Input/Button se já instalados na Task 1; senão classes Tailwind Byla).
- [ ] **Step 2:** Garantir que falha sem token mostre “Pagamento em configuração” (ou equivalente) ao usuário — sem mudar fluxo PagBank.
- [ ] **Step 3:** `npm run build`.

---

### Task 5: Ingresso + PDF + nav

**Files:**
- Modify: `src/app/pedidos/[publicToken]/page.tsx`
- Modify: `src/components/public/TicketQr.tsx`
- Modify: `src/components/public/DownloadTicketPdf.tsx`
- Modify: `src/components/public/TicketPageNav.tsx` (já tem backHref staff — manter lógica)

**Interfaces:**
- Consumes: `resolveStaffBackNav` e props atuais
- Produces: pass escuro; PDF com cores marca sem quebrar QR

- [ ] **Step 1:** Restyle página e cards de ingresso (QR grande, tipografia pass).
- [ ] **Step 2:** Ajustar PDF (fundo escuro / texto claro / acentos azul-amarelo) — QR com margem clara para leitura.
- [ ] **Step 3:** Nav no tema escuro; não alterar destinos.
- [ ] **Step 4:** `npm run build`; smoke: abrir ingresso cortesia e baixar PDF.

---

### Task 6: Área equipe (login → eventos → gerenciar → check-in → forms)

**Files:**
- Modify: `src/app/equipe/layout.tsx`
- Modify: `src/app/equipe/login/page.tsx`
- Modify: `src/app/equipe/page.tsx`
- Modify: `src/app/equipe/eventos/novo/page.tsx`
- Modify: `src/app/equipe/eventos/[id]/page.tsx`
- Modify: `src/app/equipe/eventos/[id]/check-in/page.tsx`
- Modify: `src/components/equipe/TicketList.tsx`, `EventForm.tsx`, `CheckInScanner.tsx`

**Interfaces:**
- Consumes: auth layout + actions existentes
- Produces: painel ferramenta no tema noite; check-in behavior intacto (pause + Próximo ingresso)

- [ ] **Step 1:** Layout equipe: header com marca “Espaço Byla Eventos” + sair; fundo escuro.
- [ ] **Step 2:** Restyle login, lista, detalhe, formulário, lista de participantes.
- [ ] **Step 3:** Check-in: só classes/cores; **não** alterar lógica de pause/já utilizado.
- [ ] **Step 4:** `npm run build`; smoke login + abrir check-in.

---

### Task 7: Polish final e checklist do spec

**Files:**
- Touch-up only as needed across previous files
- Update: `docs/superpowers/plans/mvp-success-checklist.md` só se fizer sentido marcar item visual (opcional)

- [ ] **Step 1:** Percorrer funil público home → evento → checkout (até mensagem PagBank) → ingresso.
- [ ] **Step 2:** Percorrer equipe: evento → cortesia → ingresso → check-in.
- [ ] **Step 3:** Conferir brand test na home (marca forte; sem clutter no hero).
- [ ] **Step 4:** `npm run test` + `npm run build`.

---

## Notes for implementers

- **Não** criar app novo; **não** migrar schema.
- Preferir editar JSX/classes nos arquivos listados.
- shadcn: instalar com CLI do projeto (`npx shadcn@latest init` / add button input label dialog) alinhado a Tailwind 4 — se o CLI brigar com a versão, cair para componentes mínimos manuais no estilo shadcn.
- Subagent-driven: uma task por subagente; review gate entre tasks.
