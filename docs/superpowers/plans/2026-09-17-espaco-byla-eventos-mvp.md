# Espaço Byla Eventos MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a plataforma Espaço Byla Eventos (multi-evento, checkout online, QR, check-in, painel da equipe) conforme a spec aprovada.

**Architecture:** App Next.js (App Router) unificado: rotas públicas (home, evento, checkout, ingresso), rotas `/equipe` (Auth Supabase), Route Handlers para webhook de pagamento e check-in. Postgres + RLS no Supabase. Domínio de pagamento atrás de um adapter (`PaymentProvider`) para trocar PagBank/Mercado Pago sem reescrever checkout.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + Tailwind CSS; Supabase (Auth, Postgres, RLS); Vitest para domínio; `@supabase/ssr`; provedor de pagamento escolhido na Task 6; deploy Vercel.

**Spec:** `docs/superpowers/specs/2026-09-17-espaco-byla-eventos-mvp-design.md`

## Global Constraints

- UI em português claro (operação/Admin); sem jargão de desenvolvedor na copy.
- GitHub público: zero PII real, zero segredos no Git; só nomes fictícios em testes/seeds.
- Sem integração com Byla Financeiro na v1.
- Sem produtores externos; só equipe Byla (Admin/secretaria com as mesmas permissões).
- Cortesia não aparece na venda pública; só emissão pela equipe.
- Pagamento 100% no site; ingresso só vira `pago` com confirmação do provedor.
- Check-in online na v1 (sem modo offline).
- Não commitar até o usuário pedir commit (ou o prompt de execução autorizar).

---

## File map (alvo)

```
/
  package.json
  next.config.ts
  tsconfig.json
  vitest.config.ts
  .env.example
  README.md
  supabase/
    migrations/
      20260917120000_init.sql
  src/
    app/
      layout.tsx
      page.tsx                          # home pública
      eventos/[slug]/page.tsx         # página do evento
      eventos/[slug]/checkout/page.tsx
      pedidos/[publicToken]/page.tsx  # meus ingressos + QR
      api/payments/webhook/route.ts
      api/check-in/route.ts
      equipe/
        login/page.tsx
        layout.tsx                     # exige auth
        page.tsx                       # lista eventos
        eventos/novo/page.tsx
        eventos/[id]/page.tsx         # detalhe + tipos + lista + cortesia
        eventos/[id]/check-in/page.tsx
    components/
      public/EventCard.tsx
      public/TicketQr.tsx
      equipe/EventForm.tsx
      equipe/TicketList.tsx
      equipe/CheckInScanner.tsx
    lib/
      supabase/client.ts
      supabase/server.ts
      supabase/admin.ts                # service role só no server
      domain/
        status.ts
        capacity.ts
        check-in.ts
        tickets.ts
      payments/
        types.ts
        provider.ts                    # factory
        mercado-pago.ts                # ou pagbank.ts após Task 6
      email/send-tickets.ts
    types/database.ts
  tests/
    domain/capacity.test.ts
    domain/check-in.test.ts
    domain/status.test.ts
```

---

### Task 1: Scaffold Next.js + Vitest + .env.example + README

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `README.md`, `src/app/layout.tsx`, `src/app/page.tsx`, `.gitignore`

**Interfaces:**
- Consumes: nada
- Produces: app Next rodando em `npm run dev`; scripts `test`, `build`; variáveis documentadas sem valores reais

- [ ] **Step 1: Criar app Next.js TypeScript + Tailwind na raiz do repo**

Run (na raiz `Byla Ingressos`, se a pasta já tiver só `docs/` e `AGENTS.md`):

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --yes
```

Se o CLI reclamar de arquivos existentes, criar em subpasta temporária e mover `src`, configs e `package.json` para a raiz sem apagar `docs/`.

- [ ] **Step 2: Adicionar Vitest**

```bash
npm install -D vitest @vitejs/plugin-react jsdom
```

Criar `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

Em `package.json`, script: `"test": "vitest run"`.

- [ ] **Step 3: Escrever `.env.example` (sem segredos)**

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PAYMENT_PROVIDER=mercadopago
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 4: README em português — o que é o produto, como rodar local, aviso de zero PII**

Incluir: nome **Espaço Byla Eventos**, stack, `npm install` / `npm run dev` / `npm test`, e que dados reais ficam só no Supabase autenticado.

- [ ] **Step 5: Garantir `.gitignore` com `.env*.local`, `.env` (exceto `.env.example`)**

- [ ] **Step 6: Verificar**

Run: `npm run build`  
Expected: build OK com página home placeholder.

---

### Task 2: Domínio puro (status, capacidade, check-in) + testes

**Files:**
- Create: `src/lib/domain/status.ts`, `src/lib/domain/capacity.ts`, `src/lib/domain/check-in.ts`, `src/lib/domain/tickets.ts`
- Test: `tests/domain/status.test.ts`, `tests/domain/capacity.test.ts`, `tests/domain/check-in.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `TicketStatus = "nao_pago" | "pago" | "cancelado" | "check_in"`
  - `canEnter(status: TicketStatus): boolean`
  - `countsTowardCapacity(status: TicketStatus): boolean`
  - `assertCapacityAvailable(used: number, capacity: number, adding: number): void`
  - `evaluateCheckIn(input: { ticketEventId: string; eventId: string; status: TicketStatus }): { ok: true } | { ok: false; reason: "evento_errado" | "nao_pago" | "cancelado" | "ja_usado" }`
  - `createPublicToken(): string` / `createTicketCode(): string` (UUID v4)

- [ ] **Step 1: Testes que falham**

```ts
// tests/domain/status.test.ts
import { describe, expect, it } from "vitest";
import { canEnter, countsTowardCapacity } from "@/lib/domain/status";

describe("status", () => {
  it("só pago pode entrar", () => {
    expect(canEnter("pago")).toBe(true);
    expect(canEnter("nao_pago")).toBe(false);
    expect(canEnter("cancelado")).toBe(false);
    expect(canEnter("check_in")).toBe(false);
  });

  it("pago e cortesia-check_in contam capacidade; nao_pago e cancelado não", () => {
    expect(countsTowardCapacity("pago")).toBe(true);
    expect(countsTowardCapacity("check_in")).toBe(true);
    expect(countsTowardCapacity("nao_pago")).toBe(false);
    expect(countsTowardCapacity("cancelado")).toBe(false);
  });
});
```

```ts
// tests/domain/capacity.test.ts
import { describe, expect, it } from "vitest";
import { assertCapacityAvailable } from "@/lib/domain/capacity";

describe("capacity", () => {
  it("permite até o limite", () => {
    expect(() => assertCapacityAvailable(98, 100, 2)).not.toThrow();
  });
  it("bloqueia acima do limite", () => {
    expect(() => assertCapacityAvailable(99, 100, 2)).toThrow(/capacidade/i);
  });
});
```

```ts
// tests/domain/check-in.test.ts
import { describe, expect, it } from "vitest";
import { evaluateCheckIn } from "@/lib/domain/check-in";

describe("check-in", () => {
  it("libera ingresso pago do evento certo", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "e1",
        eventId: "e1",
        status: "pago",
      }),
    ).toEqual({ ok: true });
  });
  it("bloqueia já usado", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "e1",
        eventId: "e1",
        status: "check_in",
      }),
    ).toEqual({ ok: false, reason: "ja_usado" });
  });
});
```

- [ ] **Step 2: Rodar testes — devem falhar**

Run: `npm test`  
Expected: FAIL (módulos não encontrados)

- [ ] **Step 3: Implementar domínio**

```ts
// src/lib/domain/status.ts
export type TicketStatus = "nao_pago" | "pago" | "cancelado" | "check_in";

export function canEnter(status: TicketStatus): boolean {
  return status === "pago";
}

export function countsTowardCapacity(status: TicketStatus): boolean {
  return status === "pago" || status === "check_in";
}
```

```ts
// src/lib/domain/capacity.ts
export function assertCapacityAvailable(
  used: number,
  capacity: number,
  adding: number,
): void {
  if (used + adding > capacity) {
    throw new Error("Capacidade esgotada para este evento.");
  }
}
```

```ts
// src/lib/domain/check-in.ts
import type { TicketStatus } from "./status";

export function evaluateCheckIn(input: {
  ticketEventId: string;
  eventId: string;
  status: TicketStatus;
}): { ok: true } | { ok: false; reason: "evento_errado" | "nao_pago" | "cancelado" | "ja_usado" } {
  if (input.ticketEventId !== input.eventId) return { ok: false, reason: "evento_errado" };
  if (input.status === "check_in") return { ok: false, reason: "ja_usado" };
  if (input.status === "cancelado") return { ok: false, reason: "cancelado" };
  if (input.status === "nao_pago") return { ok: false, reason: "nao_pago" };
  return { ok: true };
}
```

```ts
// src/lib/domain/tickets.ts
import { randomUUID } from "crypto";

export function createPublicToken(): string {
  return randomUUID();
}

export function createTicketCode(): string {
  return randomUUID();
}
```

- [ ] **Step 4: Rodar testes — devem passar**

Run: `npm test`  
Expected: PASS

---

### Task 3: Schema Supabase + RLS + clients

**Files:**
- Create: `supabase/migrations/20260917120000_init.sql`
- Create: `src/lib/supabase/client.ts`, `server.ts`, `admin.ts`
- Create: `src/types/database.ts` (tipos manuais alinhados à migration)

**Interfaces:**
- Consumes: enums de status da Task 2
- Produces: tabelas `staff_profiles`, `events`, `ticket_types`, `orders`, `tickets`; helpers `createClient` (browser), `createServerClient`, `createAdminClient`

- [ ] **Step 1: Migration SQL**

```sql
-- supabase/migrations/20260917120000_init.sql

create extension if not exists "pgcrypto";

create type public.ticket_kind as enum ('inteira', 'meia', 'cortesia');
create type public.ticket_status as enum ('nao_pago', 'pago', 'cancelado', 'check_in');
create type public.order_status as enum ('pendente', 'pago', 'cancelado', 'expirado');

create table public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  venue text not null,
  starts_at timestamptz not null,
  capacity int not null check (capacity > 0),
  cover_image_url text,
  sales_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.ticket_kind not null,
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true,
  unique (event_id, kind)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text,
  total_cents int not null check (total_cents >= 0),
  status public.order_status not null default 'pendente',
  public_token text not null unique,
  payment_provider text,
  payment_external_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create unique index orders_payment_external_id_uidx
  on public.orders (payment_provider, payment_external_id)
  where payment_external_id is not null;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_id uuid not null references public.events (id),
  ticket_type_id uuid not null references public.ticket_types (id),
  kind public.ticket_kind not null,
  status public.ticket_status not null default 'nao_pago',
  code text not null unique,
  buyer_name text not null,
  price_cents int not null,
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index tickets_event_id_idx on public.tickets (event_id);
create index tickets_status_idx on public.tickets (status);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles sp where sp.user_id = auth.uid()
  );
$$;

alter table public.staff_profiles enable row level security;
alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;

-- Público: ler eventos com venda e tipos públicos (não cortesia)
create policy events_public_read on public.events
  for select using (sales_open = true or public.is_staff());

create policy events_staff_write on public.events
  for all using (public.is_staff()) with check (public.is_staff());

create policy ticket_types_public_read on public.ticket_types
  for select using (
    kind <> 'cortesia' and active = true
    and exists (select 1 from public.events e where e.id = event_id and e.sales_open = true)
    or public.is_staff()
  );

create policy ticket_types_staff_write on public.ticket_types
  for all using (public.is_staff()) with check (public.is_staff());

create policy staff_profiles_self on public.staff_profiles
  for select using (user_id = auth.uid() or public.is_staff());

-- Pedidos/ingressos: equipe lê tudo; insert público via service role nas APIs
create policy orders_staff on public.orders
  for all using (public.is_staff()) with check (public.is_staff());

create policy tickets_staff on public.tickets
  for all using (public.is_staff()) with check (public.is_staff());
```

Nota: criação de pedido/pagamento e leitura do ingresso por `public_token` usam **service role** no servidor (Route Handlers / Server Actions), não a anon key — evita expor PII de outros compradores por RLS frouxa.

- [ ] **Step 2: Clients Supabase**

Instalar: `npm install @supabase/supabase-js @supabase/ssr`

Implementar `client.ts` (browser), `server.ts` (cookies), `admin.ts` (`SUPABASE_SERVICE_ROLE_KEY`, só server).

- [ ] **Step 3: Aplicar migration no projeto Supabase** (CLI ou SQL editor); criar 1 usuário staff e linha em `staff_profiles` com nome fictício.

- [ ] **Step 4: Smoke** — `select` de `events` com anon em evento `sales_open` funciona; insert em `events` com anon falha.

---

### Task 4: Auth equipe + shell `/equipe`

**Files:**
- Create: `src/app/equipe/login/page.tsx`, `src/app/equipe/layout.tsx`, `src/app/equipe/page.tsx`
- Modify: middleware se necessário (`src/middleware.ts`) para proteger `/equipe/*` exceto login

**Interfaces:**
- Consumes: `createServerClient`, `staff_profiles`
- Produces: login e-mail/senha; redirect se não staff; layout com navegação “Eventos” / “Sair”

- [ ] **Step 1: Página de login** — formulário “E-mail” / “Senha” / “Entrar”; erros em português (“Não foi possível entrar”).

- [ ] **Step 2: `equipe/layout.tsx`** — se não autenticado ou sem `staff_profiles`, redirect `/equipe/login`.

- [ ] **Step 3: `equipe/page.tsx`** — lista eventos (nome, data, venda aberta/fechada) + botão “Novo evento”.

- [ ] **Step 4: Verificar manualmente** — login com usuário staff; acesso a `/equipe` ok; logout ok.

---

### Task 5: CRUD de eventos + tipos inteira/meia/cortesia

**Files:**
- Create: `src/components/equipe/EventForm.tsx`, `src/app/equipe/eventos/novo/page.tsx`, `src/app/equipe/eventos/[id]/page.tsx`
- Create: Server Actions em `src/app/equipe/eventos/actions.ts`

**Interfaces:**
- Consumes: tabelas `events`, `ticket_types`
- Produces:
  - `createEvent(input): Promise<{ id: string }>`
  - `updateEvent(id, input): Promise<void>`
  - `setSalesOpen(id, open: boolean): Promise<void>`
  - Ao criar evento: slug único a partir do nome; cria 3 `ticket_types` (inteira/meia com preço; cortesia `price_cents = 0`, `active = true` mas oculta no público via RLS)

- [ ] **Step 1: Form** — campos: nome, data/hora, local, descrição, capacidade, preço inteira, preço meia, capa URL opcional. Botões: “Salvar”, “Abrir venda” / “Fechar venda”.

- [ ] **Step 2: Detalhe** — contadores: capacidade, ocupados (`pago`+`check_in`), restantes; link “Check-in”; seção lista (placeholder ok até Task 8).

- [ ] **Step 3: Home pública** — listar eventos `sales_open`; card com nome/data; link `/eventos/[slug]`.

- [ ] **Step 4: Página pública do evento** — descrição, preços inteira/meia (não cortesia), CTA “Comprar” se `sales_open` e houver vaga.

- [ ] **Step 5: Verificar** — criar evento fictício “Noite de Teste”; ver na home; fechar venda some da home (ou mostra esgotado/fechado conforme copy).

---

### Task 6: Adapter de pagamento + escolha do provedor

**Files:**
- Create: `src/lib/payments/types.ts`, `src/lib/payments/provider.ts`, `src/lib/payments/mercadopago.ts` **ou** `pagbank.ts`
- Modify: `.env.example`, README (seção “Pagamentos”)
- Create: `docs/superpowers/plans/payment-provider-decision.md` (1 página: o que foi avaliado e a escolha)

**Interfaces:**
- Consumes: `orders.id`, `total_cents`, `buyer_email`, `NEXT_PUBLIC_APP_URL`
- Produces:

```ts
export type CreatePaymentInput = {
  orderId: string;
  amountCents: number;
  description: string;
  buyerEmail: string;
  successUrl: string;
  failureUrl: string;
};

export type CreatePaymentResult = {
  externalId: string;
  checkoutUrl: string;
};

export type WebhookResult =
  | { kind: "paid"; externalId: string }
  | { kind: "cancelled" | "ignored"; externalId?: string };

export interface PaymentProvider {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  parseWebhook(req: Request): Promise<WebhookResult>;
}

export function getPaymentProvider(): PaymentProvider;
```

- [ ] **Step 1: Avaliar PagBank vs Mercado Pago** (docs oficiais: PIX + checkout redirect/transparente + webhook). Registrar decisão em `payment-provider-decision.md`. Critério da spec: PagBank primeiro; se DX/webhook/PIX fracos para o prazo, Mercado Pago.

- [ ] **Step 2: Implementar adapter escolhido** com sandbox/test credentials só em `.env.local` (nunca commitadas).

- [ ] **Step 3: `getPaymentProvider()` lê `PAYMENT_PROVIDER` e instancia o adapter.

- [ ] **Step 4: Teste unitário do parser de webhook** com payload **fictício** de fixture (sem dados reais) em `tests/payments/webhook-parse.test.ts`.

---

### Task 7: Checkout → pedido → redirect pagamento → webhook → marcar pago

**Files:**
- Create: `src/app/eventos/[slug]/checkout/page.tsx`, `src/app/eventos/[slug]/checkout/actions.ts`
- Create: `src/app/api/payments/webhook/route.ts`
- Create: `src/lib/domain/orders.ts` (mark order paid + tickets)

**Interfaces:**
- Consumes: `assertCapacityAvailable`, `createPublicToken`, `createTicketCode`, `getPaymentProvider`, admin Supabase
- Produces:
  - `startCheckout({ slug, items: { kind: "inteira"|"meia", qty }[], buyer })` → redirect `checkoutUrl`
  - Webhook idempotente: se `externalId` já pago, no-op; senão `orders.status=pago`, todos `tickets` do pedido `pago`, `paid_at=now()`
  - Capacidade: contar só tickets com status que `countsTowardCapacity`; rejeitar checkout se estourar

- [ ] **Step 1: UI checkout** — qty inteira/meia, nome, e-mail (obrigatório), telefone opcional, total, botão “Pagar”.

- [ ] **Step 2: Action `startCheckout`** — valida evento aberto; calcula total; `assertCapacityAvailable`; cria `orders` (`pendente`, `public_token`) + `tickets` (`nao_pago`); chama `createPayment`; salva `payment_external_id`; redirect.

- [ ] **Step 3: Webhook route** — `parseWebhook` → se `paid`, marcar pago idempotente; se `cancelled`, opcionalmente `cancelado` nos tickets ainda `nao_pago`.

- [ ] **Step 4: Teste de integração leve** (Vitest com mocks do admin client) para “webhook duplicado não altera duas vezes” — ou teste de função `markOrderPaidIfPending(orderId)`.

```ts
export async function markOrderPaidIfPending(
  admin: SupabaseAdmin,
  externalId: string,
  provider: string,
): Promise<"updated" | "noop"> {
  // update orders set status=pago where payment_external_id=externalId and status=pendente
  // if no row: return noop
  // else update tickets set status=pago where order_id=... and status=nao_pago
}
```

- [ ] **Step 5: Verificar no sandbox** — pagamento de teste; pedido fica pago; tickets pagos.

---

### Task 8: Página do ingresso + QR + e-mail

**Files:**
- Create: `src/app/pedidos/[publicToken]/page.tsx`, `src/components/public/TicketQr.tsx`, `src/lib/email/send-tickets.ts`
- Dependency: `qrcode` (ou equivalente) para data URL server-side

**Interfaces:**
- Consumes: `orders.public_token`, `tickets.code`
- Produces: página “Seu ingresso” com QR por ticket `pago`/`check_in`; e-mail enviado após `markOrderPaidIfPending` (best-effort; falha de e-mail não reverte pagamento)

- [ ] **Step 1: QR** — conteúdo do QR = `tickets.code` (UUID). Componente mostra nome do evento, tipo, nome da pessoa, status em português.

- [ ] **Step 2: Página por `publicToken`** — via admin client; 404 se não existir; se pedido ainda pendente, copy “Aguardando pagamento”.

- [ ] **Step 3: E-mail** — provider simples (Resend ou SMTP) via env; template curto em português com link `NEXT_PUBLIC_APP_URL/pedidos/{token}`. Se e-mail não configurado, logar aviso e seguir (documentar no README).

- [ ] **Step 4: Verificar** — abrir link do pedido pago; QR renderiza; sem IDs internos na UI.

---

### Task 9: Check-in (API + scanner mobile)

**Files:**
- Create: `src/app/api/check-in/route.ts`, `src/app/equipe/eventos/[id]/check-in/page.tsx`, `src/components/equipe/CheckInScanner.tsx`
- Dependency: `html5-qrcode` (ou BarcodeDetector API com fallback)

**Interfaces:**
- Consumes: `evaluateCheckIn`, auth staff
- Produces: `POST /api/check-in` body `{ eventId, code }` → `{ ok: true, buyerName, kind } | { ok: false, message }`

- [ ] **Step 1: API** — exige staff; carrega ticket por `code`; `evaluateCheckIn`; se ok, update atômico `status=check_in` only if `status=pago` (evita race); set `checked_in_at`.

```sql
update tickets
set status = 'check_in', checked_in_at = now()
where code = $code and status = 'pago' and event_id = $eventId
returning *;
```

- [ ] **Step 2: UI** — tela grande; câmera; mensagens: “Pode entrar”, “Já utilizado”, “Ingresso não pago”, “Cancelado”, “Evento errado”.

- [ ] **Step 3: Teste** — `evaluateCheckIn` já coberto; adicionar teste da mensagem PT em helper `checkInMessage(reason)`.

- [ ] **Step 4: Verificar no celular** — ler QR de ingresso de teste.

---

### Task 10: Lista auditável + cortesia + cancelar + totais

**Files:**
- Create: `src/components/equipe/TicketList.tsx`
- Modify: `src/app/equipe/eventos/[id]/page.tsx`, `src/app/equipe/eventos/actions.ts`

**Interfaces:**
- Consumes: `tickets` do evento
- Produces: busca por nome; status em português; emitir cortesia (nome + e-mail); cancelar ticket `pago` → `cancelado` (libera capacidade); totais vendidos em R$ e por tipo

- [ ] **Step 1: Lista** — colunas: nome, tipo, status, valor, horário pagamento/check-in; sem UUID na tabela principal.

- [ ] **Step 2: Emitir cortesia** — cria `orders` zero + ticket `pago` kind cortesia **ou** ticket direto `pago` ligado a order interna; respeita capacidade.

- [ ] **Step 3: Cancelar** — confirmação (“Tem certeza?”); status `cancelado` + `cancelled_at`.

- [ ] **Step 4: Verificar** — fluxo completo fictício: vender, pagar (sandbox), listar, check-in, cortesia, cancelar.

---

### Task 11: Polish de copy, seed fictício, deploy Vercel

**Files:**
- Modify: páginas públicas (copy final), `README.md`
- Create: `supabase/seed.sql` (evento + tipos com nomes fictícios)
- Create: `.github` só se já for padrão do usuário — senão documentar deploy manual

- [ ] **Step 1: Revisar toda copy** — “Não pago”, “Pago”, “Cancelado”, “Check-in”; botões curtos.

- [ ] **Step 2: `seed.sql`** — apenas dados fictícios (“Maria Souza”, “João Teste”).

- [ ] **Step 3: Deploy Vercel** — env vars do `.env.example`; webhook URL pública; domain depois.

- [ ] **Step 4: Checklist de sucesso da spec** — marcar cada item do §10 da spec como feito ou gap explícito.

---

## Spec coverage (self-review)

| Requisito spec | Task |
|----------------|------|
| Plataforma multi-evento + home | 5 |
| Checkout online 100% site | 7 |
| Inteira/meia + cortesia equipe | 5, 10 |
| QR + e-mail/link ingresso | 8 |
| Check-in celular | 9 |
| Painel Admin/secretaria | 4, 5, 10 |
| Status inequívocos | 2, 7, 9 |
| Capacidade | 2, 7, 10 |
| PagBank avaliar → adapter | 6 |
| Next.js + Supabase + Vercel | 1, 3, 11 |
| Zero PII no Git | 1, 11 + Global Constraints |
| Sem Financeiro | Global Constraints |

## Placeholder / consistency check

- Status DB alinhados: `nao_pago | pago | cancelado | check_in`.
- Payment atrás de `PaymentProvider`; escolha concreta na Task 6.
- Leitura de ingresso por token e writes de checkout via service role (documentado na Task 3).

---

## Execution handoff

Após aprovação deste plano pelo usuário, executar task-by-task.

**Opções:**

1. **Subagent-Driven (recomendado)** — um subagente por task, revisão entre tasks  
2. **Inline Execution** — executar neste chat com checkpoints  

Qual abordagem?
