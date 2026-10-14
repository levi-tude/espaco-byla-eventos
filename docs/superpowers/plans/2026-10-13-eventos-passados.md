# Eventos passados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eventos que já aconteceram continuam no site: parte "Eventos passados" na página inicial, página do evento com aviso "Evento encerrado" e interruptor da equipe para esconder.

**Architecture:** O banco decide o que é "passado" (`event_is_past`, mesma data do Financeiro: dia seguinte à última sessão, em Brasília) e libera a leitura pública desses eventos pelas políticas RLS existentes; a página inicial lê a lista pronta pela função `public_past_events`. O front só formata (rótulos de data, limite do "Ver mais") e troca a caixa de ingressos pelo aviso de encerrado.

**Tech Stack:** Next.js 16.3.8 (App Router, Server Components/Actions), Supabase Postgres + RLS, Vitest (`environment: node`, testes `.ts` com `createElement` + `renderToStaticMarkup`).

Spec: `docs/superpowers/specs/2026-10-13-eventos-passados-design.md` (aprovada).

## Global Constraints

- Banco: **somente** MCP `user-supabase-eventos`, projeto **Espaço Byla Eventos** (ref `rlzyjlrcasqbjztgbgit`). Antes de qualquer SQL: declarar MCP + projeto no chat e conferir as tabelas `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles`. Se aparecer `alunos`, `transacoes` ou `fluxo_*`: parar e avisar.
- Qualquer escrita no banco (migração, teste em transação, evento de teste), push e deploy só depois do **"pode"** explícito do dono.
- Funções novas: `security definer`, `set search_path = ''`, `revoke all ... from public, anon, authenticated` e `grant execute` mínimo.
- Preços (`ticket_types`, `session_ticket_types`) de evento passado continuam fechados ao público.
- Toda Server Action revalida equipe dentro dela (`assertStaff`), valida o id e devolve erro genérico via `runAction`/`ActionError`.
- Textos para o público em português, sem nomes de fornecedores.
- Layout mobile-first: 1 coluna no celular, 2 no tablet, 3 no computador.
- `?passados=`: padrão 12, passo 12, máximo 120, valor inválido vira 12.
- Sem dependência nova.
- Commits com `git add <arquivos>` explícitos (o worktree tem arquivos com diferença só de fim de linha que não devem entrar).
- Comandos rodam em PowerShell na pasta `C:\Users\55719\.cursor\worktrees\sair-vercel-8d2f4a17`.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20261016100000_past_events.sql` (novo) | Colunas, gatilho de publicação, `event_is_past`, `public_past_events`, políticas |
| `supabase/tests/past_events_check.sql` (novo) | Ensaio em transação revertida (migração + cenários) |
| `src/types/database.ts` | Tipos das colunas e funções novas |
| `src/lib/domain/past-events.ts` (novo) | Rótulo de data, limite do "Ver mais", regra de dia passado |
| `src/components/public/PastEventsSection.tsx` (novo) | Grade de cards passados + "Ver mais" |
| `src/components/public/EventEndedNotice.tsx` (novo) | Aviso "Evento encerrado" na página do evento |
| `src/components/public/HomeSingleEvent.tsx` | Aceita conteúdo abaixo da capa grande |
| `src/app/page.tsx` | Busca e mostra os passados |
| `src/app/eventos/[slug]/page.tsx` | Estado encerrado |
| `src/app/equipe/eventos/actions.ts` | Action `setHiddenFromPast` |
| `src/components/equipe/PastVisibilityToggle.tsx` (novo) | Interruptor da equipe |
| `src/app/equipe/eventos/[id]/page.tsx` | Mostra o interruptor |
| `src/app/equipe/page.tsx` | Selo "Encerrado" e mesma regra de data do banco |

---

### Task 1: Migração `past_events` e ensaio em transação

**Files:**
- Create: `supabase/migrations/20261016100000_past_events.sql`
- Create: `supabase/tests/past_events_check.sql`

**Interfaces:**
- Produces (banco): `events.published_at timestamptz null`, `events.hidden_from_past boolean not null default false`, `public.event_is_past(p_event_id uuid) returns boolean`, `public.public_past_events(p_limit integer) returns table(id uuid, slug text, name text, venue text, cover_image_url text, session_starts timestamptz[], last_session_at timestamptz)`.

- [ ] **Step 1: Escrever a migração**

`supabase/migrations/20261016100000_past_events.sql`:

```sql
-- Eventos passados: depois que acontecem, continuam visíveis no site
-- (página inicial e página do evento), sem compra e sem preços.

alter table public.events
  add column published_at timestamptz,
  add column hidden_from_past boolean not null default false;

-- Eventos que já estão à venda contam como publicados.
update public.events
set published_at = created_at
where sales_open = true and published_at is null;

-- "Publicado" = vendas abertas pelo menos uma vez. Marca na primeira abertura
-- e nunca mais muda; ninguém grava a data à mão.
create function public.events_mark_published()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.published_at is not null then
    new.published_at := old.published_at;
  elsif new.sales_open then
    new.published_at := now();
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.events_mark_published() from public, anon, authenticated;

create trigger events_mark_published
  before insert or update on public.events
  for each row execute function public.events_mark_published();

-- Passado = publicado, não escondido, com sessão ativa, a partir do dia seguinte
-- (Brasília) ao fim da última sessão — a mesma data em que vira "A pagar".
create function public.event_is_past(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.published_at is not null
      and not e.hidden_from_past
      and exists (
        select 1 from public.event_sessions s
        where s.event_id = e.id and s.status = 'ativa' and s.archived_at is null
      )
      and (now() at time zone 'America/Sao_Paulo')::date >= public.event_fee_due_date(e.id)
  );
$$;

revoke all on function public.event_is_past(uuid) from public, anon, authenticated;
grant execute on function public.event_is_past(uuid) to anon, authenticated;

-- Lista da página inicial: só campos públicos, do mais recente para o mais antigo.
-- A página pede um a mais que o limite para saber se mostra "Ver mais".
create function public.public_past_events(p_limit integer)
returns table (
  id uuid,
  slug text,
  name text,
  venue text,
  cover_image_url text,
  session_starts timestamptz[],
  last_session_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.slug,
    e.name,
    e.venue,
    e.cover_image_url,
    array_agg(s.starts_at order by s.starts_at),
    max(coalesce(s.ends_at, s.starts_at)) as last_session_at
  from public.events e
  join public.event_sessions s
    on s.event_id = e.id and s.status = 'ativa' and s.archived_at is null
  where public.event_is_past(e.id)
  group by e.id
  order by last_session_at desc, e.id
  limit least(greatest(coalesce(p_limit, 12), 1), 121);
$$;

revoke all on function public.public_past_events(integer) from public, anon, authenticated;
grant execute on function public.public_past_events(integer) to anon, authenticated;

-- Leitura pública passa a incluir eventos passados (preços continuam fechados).
alter policy events_public_read on public.events
  using (sales_open = true or public.event_is_past(id) or public.is_staff());

alter policy event_images_public_read on public.event_images
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_id and (e.sales_open = true or public.event_is_past(e.id))
    )
    or public.is_staff()
  );

alter policy event_sessions_public_read on public.event_sessions
  using (
    (
      archived_at is null
      and exists (
        select 1 from public.events e
        where e.id = event_id and (e.sales_open = true or public.event_is_past(e.id))
      )
    )
    or public.is_staff()
  );
```

- [ ] **Step 2: Escrever o ensaio em transação revertida**

`supabase/tests/past_events_check.sql` (cola a migração no topo, cria cenários, confere como visitante e desfaz tudo):

```sql
-- Ensaio de eventos passados. Roda tudo dentro de uma transação e desfaz no fim.
-- Uso: substituir a linha marcada pelo conteúdo de
-- supabase/migrations/20261016100000_past_events.sql e executar o arquivo inteiro.
begin;

-- >>> conteúdo da migração 20261016100000_past_events.sql aqui <<<

insert into public.events (id, name, slug, venue, capacity, starts_at, sales_open) values
  ('00000000-0000-4000-8000-0000000000a1', 'Ensaio publicado', 'ensaio-publicado', 'Espaço Byla', 10, now() - interval '3 days', true),
  ('00000000-0000-4000-8000-0000000000a2', 'Ensaio rascunho', 'ensaio-rascunho', 'Espaço Byla', 10, now() - interval '3 days', false),
  ('00000000-0000-4000-8000-0000000000a3', 'Ensaio escondido', 'ensaio-escondido', 'Espaço Byla', 10, now() - interval '3 days', true),
  ('00000000-0000-4000-8000-0000000000a4', 'Ensaio cancelado', 'ensaio-cancelado', 'Espaço Byla', 10, now() - interval '3 days', true),
  ('00000000-0000-4000-8000-0000000000a5', 'Ensaio futuro', 'ensaio-futuro', 'Espaço Byla', 10, now() + interval '3 days', true);

insert into public.ticket_types (event_id, name, kind, price_cents)
values ('00000000-0000-4000-8000-0000000000a1', 'Inteira', 'inteira', 5000);

-- Depois do evento as vendas costumam estar fechadas.
update public.events set sales_open = false
where id in ('00000000-0000-4000-8000-0000000000a1',
             '00000000-0000-4000-8000-0000000000a3',
             '00000000-0000-4000-8000-0000000000a4');
update public.events set hidden_from_past = true
where id = '00000000-0000-4000-8000-0000000000a3';
update public.event_sessions
set status = 'cancelada', cancelled_at = now(), cancel_reason = 'ensaio'
where event_id = '00000000-0000-4000-8000-0000000000a4';

-- Gatilho: nunca volta a null e não aceita data à mão.
update public.events set published_at = null where id = '00000000-0000-4000-8000-0000000000a1';
update public.events set published_at = now() where id = '00000000-0000-4000-8000-0000000000a2';

select
  (select published_at is not null from public.events where id = '00000000-0000-4000-8000-0000000000a1') as publicado_mantem_data,
  (select published_at is null from public.events where id = '00000000-0000-4000-8000-0000000000a2') as rascunho_sem_data;

set local role anon;

select
  exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a1') as publicado_visivel,
  not exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a2') as rascunho_oculto,
  not exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a3') as escondido_oculto,
  not exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a4') as cancelado_oculto,
  exists (select 1 from public.event_sessions where event_id = '00000000-0000-4000-8000-0000000000a1') as sessoes_visiveis,
  not exists (select 1 from public.ticket_types where event_id = '00000000-0000-4000-8000-0000000000a1') as tipos_fechados,
  not exists (
    select 1 from public.session_ticket_types stt
    join public.event_sessions s on s.id = stt.session_id
    where s.event_id = '00000000-0000-4000-8000-0000000000a1'
  ) as precos_fechados,
  (select count(*) from public.public_past_events(12) where id = '00000000-0000-4000-8000-0000000000a1') = 1 as lista_tem_publicado,
  (select count(*) from public.public_past_events(12) where id in (
    '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3',
    '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5'
  )) = 0 as lista_filtra_os_outros;

reset role;
rollback;
```

Esperado ao executar (Task 10): **todas** as colunas `true` nas duas consultas. Se o insert falhar por alguma restrição da tabela (ex.: coluna obrigatória nova), ajustar só os dados do ensaio, nunca a migração sem rever com o dono.

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/20261016100000_past_events.sql supabase/tests/past_events_check.sql
git commit -m "feat(banco): eventos passados visíveis ao público (migração past_events)"
```

---

### Task 2: Tipos do banco

**Files:**
- Modify: `src/types/database.ts` (bloco `events` ~linhas 27-74; bloco `Functions` a partir da ~linha 694)

**Interfaces:**
- Produces: `Database["public"]["Tables"]["events"]["Row"]` com `hidden_from_past: boolean` e `published_at: string | null`; RPCs tipadas `event_is_past` e `public_past_events`.

- [ ] **Step 1: Adicionar as colunas em `events`** (ordem alfabética, como o gerador faz)

Em `Row`, entre `description` e `id`: `hidden_from_past: boolean;`; entre `name` e `sales_open`: `published_at: string | null;`.
Em `Insert`: `hidden_from_past?: boolean;` e `published_at?: string | null;` nas mesmas posições.
Em `Update`: `hidden_from_past?: boolean;` e `published_at?: string | null;` nas mesmas posições.

- [ ] **Step 2: Adicionar as funções em `Functions`** (cada uma na posição alfabética)

```ts
      event_is_past: {
        Args: { p_event_id: string };
        Returns: boolean;
      };
```

```ts
      public_past_events: {
        Args: { p_limit: number };
        Returns: {
          cover_image_url: string | null;
          id: string;
          last_session_at: string;
          name: string;
          session_starts: string[];
          slug: string;
          venue: string;
        }[];
      };
```

- [ ] **Step 3: Conferir tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```powershell
git add src/types/database.ts
git commit -m "chore(tipos): colunas e funções de eventos passados"
```

(Depois de aplicar a migração na Task 10, conferir com `generate_typescript_types` do MCP `user-supabase-eventos` que os tipos batem; corrigir se o gerador divergir.)

---

### Task 3: Regras puras de eventos passados

**Files:**
- Create: `src/lib/domain/past-events.ts`
- Test: `tests/domain/past-events.test.ts`

**Interfaces:**
- Consumes: `sessionDayKey(value: string | Date | null | undefined): string` de `@/lib/datetime`.
- Produces:
  - `PAST_PAGE_SIZE = 12`, `PAST_MAX_LIMIT = 120`
  - `pastEventDateLabel(startsAt: readonly string[]): string`
  - `parsePastLimit(value: string | string[] | undefined): number`
  - `nextPastLimit(limit: number): number | null`
  - `isPastEventDay(lastSessionAt: string | null | undefined, now?: Date): boolean`

- [ ] **Step 1: Escrever os testes**

`tests/domain/past-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isPastEventDay,
  nextPastLimit,
  parsePastLimit,
  pastEventDateLabel,
} from "@/lib/domain/past-events";

describe("pastEventDateLabel", () => {
  it("um dia", () => {
    expect(pastEventDateLabel(["2026-10-10T22:00:00Z"])).toBe("10 de outubro de 2026");
  });

  it("várias sessões no mesmo dia contam como um dia (horário de Brasília)", () => {
    expect(pastEventDateLabel(["2026-10-10T22:00:00Z", "2026-10-11T02:00:00Z"])).toBe(
      "10 de outubro de 2026",
    );
  });

  it("dois dias no mesmo mês", () => {
    expect(pastEventDateLabel(["2026-10-11T22:00:00Z", "2026-10-10T22:00:00Z"])).toBe(
      "10 e 11 de outubro de 2026",
    );
  });

  it("três ou mais dias viram intervalo", () => {
    expect(
      pastEventDateLabel(["2026-10-10T22:00:00Z", "2026-10-11T22:00:00Z", "2026-10-12T22:00:00Z"]),
    ).toBe("De 10 a 12 de outubro de 2026");
  });

  it("meses diferentes", () => {
    expect(pastEventDateLabel(["2026-09-30T22:00:00Z", "2026-10-01T22:00:00Z"])).toBe(
      "30 de setembro e 1 de outubro de 2026",
    );
  });

  it("anos diferentes", () => {
    expect(
      pastEventDateLabel(["2026-12-30T22:00:00Z", "2026-12-31T22:00:00Z", "2027-01-01T22:00:00Z"]),
    ).toBe("De 30 de dezembro de 2026 a 1 de janeiro de 2027");
  });

  it("sem datas válidas", () => {
    expect(pastEventDateLabel([])).toBe("");
    expect(pastEventDateLabel(["xyz"])).toBe("");
  });
});

describe("parsePastLimit", () => {
  it.each([
    [undefined, 12],
    ["", 12],
    ["abc", 12],
    ["-12", 12],
    ["0", 12],
    ["12", 12],
    ["24", 24],
    ["25", 24],
    ["120", 120],
    ["999", 120],
    ["9999999", 12],
    [["36", "48"], 36],
  ])("%j vira %i", (value, expected) => {
    expect(parsePastLimit(value as string | string[] | undefined)).toBe(expected);
  });
});

describe("nextPastLimit", () => {
  it("soma 12 até o máximo", () => {
    expect(nextPastLimit(12)).toBe(24);
    expect(nextPastLimit(108)).toBe(120);
    expect(nextPastLimit(120)).toBeNull();
  });
});

describe("isPastEventDay", () => {
  const last = "2026-10-10T23:00:00Z"; // 20h00 de 10/10 em Brasília

  it("ainda não é passado no mesmo dia, mesmo depois da sessão", () => {
    expect(isPastEventDay(last, new Date("2026-10-11T02:59:00Z"))).toBe(false);
  });

  it("vira passado à meia-noite de Brasília", () => {
    expect(isPastEventDay(last, new Date("2026-10-11T03:00:00Z"))).toBe(true);
  });

  it("sem data não é passado", () => {
    expect(isPastEventDay(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/past-events.test.ts`
Expected: FAIL (módulo `@/lib/domain/past-events` não existe).

- [ ] **Step 3: Implementar**

`src/lib/domain/past-events.ts`:

```ts
import { sessionDayKey } from "@/lib/datetime";

export const PAST_PAGE_SIZE = 12;
export const PAST_MAX_LIMIT = 120;

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

type Day = { day: number; month: string; year: string };

function toDay(key: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return null;
  return { year: match[1], month, day: Number(match[3]) };
}

/**
 * Data do card de evento passado, no horário de Brasília: "10 de outubro de 2026",
 * "10 e 11 de outubro de 2026" ou "De 10 a 12 de outubro de 2026".
 */
export function pastEventDateLabel(startsAt: readonly string[]): string {
  const days = [...new Set(startsAt.map((start) => sessionDayKey(start)).filter(Boolean))]
    .sort()
    .map(toDay)
    .filter((day): day is Day => day !== null);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return "";

  const full = (day: Day) => `${day.day} de ${day.month} de ${day.year}`;
  if (days.length === 1) return full(first);

  const start =
    first.year !== last.year
      ? full(first)
      : first.month !== last.month
        ? `${first.day} de ${first.month}`
        : String(first.day);
  return days.length === 2 ? `${start} e ${full(last)}` : `De ${start} a ${full(last)}`;
}

/** `?passados=` da página inicial: múltiplo de 12 entre 12 e 120; inválido vira 12. */
export function parsePastLimit(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,6}$/.test(raw)) return PAST_PAGE_SIZE;
  const steps = Math.max(Math.floor(Number(raw) / PAST_PAGE_SIZE), 1);
  return Math.min(steps * PAST_PAGE_SIZE, PAST_MAX_LIMIT);
}

/** Valor do próximo "Ver mais", ou `null` quando já está no máximo. */
export function nextPastLimit(limit: number): number | null {
  return limit < PAST_MAX_LIMIT ? limit + PAST_PAGE_SIZE : null;
}

/** Mesma regra do banco: passado a partir do dia seguinte (Brasília) ao fim da última sessão. */
export function isPastEventDay(
  lastSessionAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const lastDay = sessionDayKey(lastSessionAt);
  return lastDay !== "" && sessionDayKey(now) > lastDay;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/domain/past-events.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/domain/past-events.ts tests/domain/past-events.test.ts
git commit -m "feat(eventos-passados): rótulos de data e limite do Ver mais"
```

---

### Task 4: Componentes públicos (grade de passados e aviso de encerrado)

**Files:**
- Create: `src/components/public/PastEventsSection.tsx`
- Create: `src/components/public/EventEndedNotice.tsx`
- Test: `tests/public/past-events-ui.test.ts`

**Interfaces:**
- Produces:
  - `type PastEventCard = { id: string; slug: string; name: string; venue: string; coverImageUrl: string | null; dateLabel: string }`
  - `PastEventsSection({ events, nextLimit }: { events: readonly PastEventCard[]; nextLimit: number | null })` — devolve `null` sem eventos; seção com `id="eventos-passados"`.
  - `EventEndedNotice({ whenLabel }: { whenLabel: string })` — título com `id="encerrado-titulo"`.

- [ ] **Step 1: Escrever os testes**

`tests/public/past-events-ui.test.ts`:

```ts
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/BrandMark", () => ({ BrandMark: () => null }));

import { EventEndedNotice } from "@/components/public/EventEndedNotice";
import { type PastEventCard, PastEventsSection } from "@/components/public/PastEventsSection";

const card: PastEventCard = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "show-de-outubro",
  name: "Show de outubro",
  venue: "Espaço Byla",
  coverImageUrl: "https://exemplo.supabase.co/storage/v1/object/public/event-media/capa.jpg",
  dateLabel: "10 de outubro de 2026",
};

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

describe("PastEventsSection", () => {
  it("não mostra nada sem eventos", () => {
    expect(renderToStaticMarkup(createElement(PastEventsSection, { events: [], nextLimit: null }))).toBe("");
  });

  it("mostra título, card com data, local e link, sem preço", () => {
    const html = renderToStaticMarkup(
      createElement(PastEventsSection, { events: [card], nextLimit: null }),
    );
    expect(html).toContain('id="eventos-passados"');
    const page = text(html);
    expect(page).toContain("Eventos passados");
    expect(page).toContain("Show de outubro");
    expect(page).toContain("10 de outubro de 2026");
    expect(page).toContain("Espaço Byla");
    expect(html).toContain('href="/eventos/show-de-outubro"');
    expect(page).not.toMatch(/R\$|A partir de|Esgotado/);
    expect(page).not.toContain("Ver mais");
  });

  it("Ver mais leva ao próximo limite sem JavaScript", () => {
    const html = renderToStaticMarkup(
      createElement(PastEventsSection, { events: [card], nextLimit: 24 }),
    );
    expect(html).toContain('href="/?passados=24#eventos-passados"');
    expect(text(html)).toContain("Ver mais");
  });
});

describe("EventEndedNotice", () => {
  it("avisa que acabou, mostra a data e leva aos próximos eventos", () => {
    const html = renderToStaticMarkup(
      createElement(EventEndedNotice, { whenLabel: "10 de outubro de 2026" }),
    );
    const page = text(html);
    expect(page).toContain("Evento encerrado");
    expect(page).toContain("Este evento já aconteceu.");
    expect(page).toContain("10 de outubro de 2026");
    expect(html).toContain('href="/"');
    expect(page).toContain("Ver próximos eventos");
    expect(page).not.toContain("Comprar");
  });

  it("sem data, mostra só o aviso", () => {
    const page = text(renderToStaticMarkup(createElement(EventEndedNotice, { whenLabel: "" })));
    expect(page).toContain("Este evento já aconteceu.");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/public/past-events-ui.test.ts`
Expected: FAIL (componentes não existem).

- [ ] **Step 3: Implementar `PastEventsSection`**

`src/components/public/PastEventsSection.tsx`:

```tsx
import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";

export type PastEventCard = {
  id: string;
  slug: string;
  name: string;
  venue: string;
  coverImageUrl: string | null;
  dateLabel: string;
};

/** Vitrine do que já aconteceu: mais discreta que os eventos à venda, sem preço. */
export function PastEventsSection({
  events,
  nextLimit,
}: {
  events: readonly PastEventCard[];
  nextLimit: number | null;
}) {
  if (!events.length) return null;

  return (
    <section
      aria-labelledby="eventos-passados-titulo"
      className="mt-14 scroll-mt-6 sm:mt-16"
      id="eventos-passados"
    >
      <h2
        className="font-display text-3xl tracking-wide text-foreground sm:text-4xl"
        id="eventos-passados-titulo"
      >
        Eventos passados
      </h2>
      <ul className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {events.map((event) => {
          const href = `/eventos/${event.slug}`;
          return (
            <li key={event.id}>
              <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-byla-border bg-byla-surface">
                <Link aria-hidden className="overflow-hidden" href={href} tabIndex={-1}>
                  <CoverImage className="opacity-90" src={event.coverImageUrl} />
                </Link>
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <h3 className="font-display text-2xl tracking-wide text-foreground">
                    <Link
                      className="text-foreground no-underline hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                      href={href}
                    >
                      {event.name}
                    </Link>
                  </h3>
                  {event.dateLabel ? (
                    <p className="mt-2 flex items-start gap-2 text-base text-byla-muted">
                      <CalendarDays aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                      {event.dateLabel}
                    </p>
                  ) : null}
                  <p className="mt-1 flex items-start gap-2 text-base text-byla-muted">
                    <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                    {event.venue}
                  </p>
                  <div className="mt-auto pt-4">
                    <Link
                      className="inline-flex min-h-11 items-center text-base font-semibold text-byla-link no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                      href={href}
                    >
                      Ver evento <span aria-hidden>&nbsp;→</span>
                      <span className="sr-only">: {event.name}</span>
                    </Link>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {nextLimit !== null ? (
        <div className="mt-8 flex justify-center">
          <ButtonLink
            className="w-full sm:w-auto"
            href={`/?passados=${nextLimit}#eventos-passados`}
            variant="secondary"
          >
            Ver mais
          </ButtonLink>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Implementar `EventEndedNotice`**

`src/components/public/EventEndedNotice.tsx`:

```tsx
import { CalendarCheck } from "lucide-react";
import Link from "next/link";

/** Ocupa o lugar da caixa de ingressos quando o evento já aconteceu. */
export function EventEndedNotice({ whenLabel }: { whenLabel: string }) {
  return (
    <>
      <h2
        className="flex items-center gap-2 text-lg font-semibold text-foreground"
        id="encerrado-titulo"
      >
        <CalendarCheck aria-hidden className="h-5 w-5 text-byla-accent-text" />
        Evento encerrado
      </h2>
      <p className="mt-3 text-base text-foreground">Este evento já aconteceu.</p>
      {whenLabel ? <p className="mt-1 text-base text-byla-muted">{whenLabel}</p> : null}
      <Link
        className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-byla-link no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
        href="/"
      >
        Ver próximos eventos <span aria-hidden>&nbsp;→</span>
      </Link>
    </>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/public/past-events-ui.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/public/PastEventsSection.tsx src/components/public/EventEndedNotice.tsx tests/public/past-events-ui.test.ts
git commit -m "feat(eventos-passados): grade de passados e aviso de evento encerrado"
```

---

### Task 5: Página inicial com "Eventos passados"

**Files:**
- Modify: `src/components/public/HomeSingleEvent.tsx` (assinatura na linha 20; fechamento do `</article>` ~linha 86)
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `parsePastLimit`, `nextPastLimit`, `pastEventDateLabel` (Task 3); `PastEventsSection`, `PastEventCard` (Task 4); RPC `public_past_events` (Tasks 1-2).
- Produces: `HomeSingleEvent({ event, children }: { event: EventCard; children?: ReactNode })`.

- [ ] **Step 1: `HomeSingleEvent` aceita conteúdo abaixo da capa**

Em `src/components/public/HomeSingleEvent.tsx`: adicionar `import type { ReactNode } from "react";` junto aos imports; trocar a assinatura por

```tsx
export function HomeSingleEvent({ event, children }: { event: EventCard; children?: ReactNode }) {
```

e logo depois do `</article>` (dentro da `div` `relative mx-auto ...`), antes do `</div>` que a fecha:

```tsx
        </article>
        {children}
      </div>
```

- [ ] **Step 2: Buscar os passados na página inicial**

Em `src/app/page.tsx`:

Imports novos (em ordem alfabética com os existentes):

```tsx
import { PastEventsSection, type PastEventCard } from "@/components/public/PastEventsSection";
import { nextPastLimit, parsePastLimit, pastEventDateLabel } from "@/lib/domain/past-events";
```

Trocar o início da função (linhas 23-29) por:

```tsx
export default async function Home({ searchParams }: PageProps<"/">) {
  const [supabase, query] = await Promise.all([createServerClient(), searchParams]);
  const pastLimit = parsePastLimit(query.passados);
  const [{ data: events, error }, { data: pastRows, error: pastError }] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, name, starts_at, venue, cover_image_url")
      .eq("sales_open", true)
      .order("starts_at", { ascending: true }),
    supabase.rpc("public_past_events", { p_limit: pastLimit + 1 }),
  ]);
  // Sem os passados (falha na consulta), a página segue só com os próximos.
  if (pastError) console.error("[home] Falha ao carregar os eventos passados.");
  const pastCards: PastEventCard[] = (pastRows ?? []).slice(0, pastLimit).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    venue: row.venue,
    coverImageUrl: row.cover_image_url,
    dateLabel: pastEventDateLabel(row.session_starts ?? []),
  }));
  const pastSection = (
    <PastEventsSection
      events={pastCards}
      nextLimit={(pastRows?.length ?? 0) > pastLimit ? nextPastLimit(pastLimit) : null}
    />
  );
```

(O restante do cálculo de `list`/`single` continua igual.)

- [ ] **Step 3: Mostrar a parte de passados nos dois layouts**

No retorno de evento único, passar a seção como filho:

```tsx
      <HomeSingleEvent
        event={{
          slug: single.slug,
          name: single.name,
          startsLabel: single.startsLabel,
          venue: single.venue,
          coverImageUrl: single.cover_image_url,
          sessions: single.chips.length > 1 ? single.chips : [],
          priceLabel: single.priceLabel,
        }}
      >
        {pastSection}
      </HomeSingleEvent>
```

No layout de lista: antes do bloco `{!error && list.length > 1 ? (<ul ...` inserir o título dos próximos (só quando há passados para separar):

```tsx
        {!error && list.length > 1 && pastCards.length ? (
          <h2 className="mt-10 font-display text-3xl tracking-wide text-foreground sm:text-4xl">
            Próximos eventos
          </h2>
        ) : null}
```

e, logo antes do `</div>` que fecha `relative mx-auto w-full max-w-6xl ...` (depois do bloco da `<ul>`), adicionar:

```tsx
        {pastSection}
```

(Sem próximos eventos, o aviso "Nenhum evento à venda no momento" continua aparecendo e os passados vêm logo abaixo.)

- [ ] **Step 4: Conferir tipos, lint e testes**

Run: `npx tsc --noEmit; npx eslint src/app/page.tsx src/components/public/HomeSingleEvent.tsx; npx vitest run`
Expected: sem erros; todos os testes passam.

- [ ] **Step 5: Commit**

```powershell
git add src/app/page.tsx src/components/public/HomeSingleEvent.tsx
git commit -m "feat(eventos-passados): parte Eventos passados na página inicial"
```

---

### Task 6: Página do evento passado ("Evento encerrado")

**Files:**
- Modify: `src/app/eventos/[slug]/page.tsx` (linhas 110-202 e aside 237-322)

**Interfaces:**
- Consumes: RPC `event_is_past` (Tasks 1-2), `pastEventDateLabel` (Task 3), `EventEndedNotice` (Task 4).

- [ ] **Step 1: Imports**

```tsx
import { EventEndedNotice } from "@/components/public/EventEndedNotice";
import { pastEventDateLabel } from "@/lib/domain/past-events";
```

- [ ] **Step 2: Descobrir se é passado junto com as outras consultas**

Trocar o `Promise.all` das linhas 111-124 por:

```tsx
  const [gallery, { data: ticketTypes }, summary, feePolicy, { data: pastFlag }] =
    await Promise.all([
      loadEventGallery(supabase, event.id),
      supabase
        .from("ticket_types")
        .select("id, name, kind, price_cents, people_per_unit")
        .eq("event_id", event.id)
        .neq("kind", "cortesia")
        .is("archived_at", null)
        .eq("active", true)
        .order("sort_order")
        .order("id"),
      loadEventSessions(admin, event.id),
      loadServiceFeePolicy(admin),
      supabase.rpc("event_is_past", { p_event_id: event.id }),
    ]);
  // Evento que já aconteceu: só vitrine, sem sessões à venda, preços ou compra.
  const ended = pastFlag === true;
```

- [ ] **Step 3: Sem sessões nem lotação quando encerrado**

```tsx
  const visible = summary && !ended ? buyerVisibleSessions(summary.sessions) : [];
```

e a lotação:

```tsx
  const availability = ended
    ? null
    : selected
      ? await loadSessionAvailability(admin, selected.id)
      : summary
        ? null
        : await loadEventAvailability(admin, event);
```

- [ ] **Step 4: Sem compra e com a data do que aconteceu**

```tsx
  const showBuy = !ended && state === "open";
```

e trocar `whenText` por:

```tsx
  const endedLabel = ended
    ? pastEventDateLabel(
        summary
          ? summary.sessions
              .filter((session) => session.status === "ativa")
              .map((session) => session.startsAt)
          : [event.starts_at],
      )
    : "";
  const whenText = ended
    ? endedLabel || dateFormatter.format(new Date(event.starts_at))
    : multi
      ? daysLabel(visible.map((session) => session.startsAt))
      : dateFormatter.format(new Date(visible[0]?.startsAt ?? event.starts_at));
```

- [ ] **Step 5: Trocar a caixa de ingressos pelo aviso**

No `<aside>`: `aria-labelledby={ended ? "encerrado-titulo" : "ingressos-titulo"}` e o conteúdo inteiro (do `<h2 ... id="ingressos-titulo">` até o fim do bloco `state === "open" ? ... : <Notice ...>`) fica dentro de um fragmento no ramo falso:

```tsx
          <aside
            aria-labelledby={ended ? "encerrado-titulo" : "ingressos-titulo"}
            className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-start lg:shadow-xl lg:shadow-black/10"
          >
            {ended ? (
              <EventEndedNotice whenLabel={endedLabel} />
            ) : (
              <>
                <h2
                  className="flex items-center gap-2 text-lg font-semibold text-foreground"
                  id="ingressos-titulo"
                >
                  <Ticket aria-hidden className="h-5 w-5 text-byla-accent-text" />
                  Ingressos
                </h2>
                {/* ... SessionPicker, tipos/preços e o bloco Comprar/Notice exatamente como hoje ... */}
              </>
            )}
          </aside>
```

(O comentário acima é só para o plano: no código, mover as linhas existentes 241-321 sem alteração para dentro do fragmento, reindentando.)

- [ ] **Step 6: Conferir**

Run: `npx tsc --noEmit; npx eslint "src/app/eventos/[slug]/page.tsx"; npx vitest run`
Expected: sem erros; testes passam.

- [ ] **Step 7: Commit**

```powershell
git add "src/app/eventos/[slug]/page.tsx"
git commit -m "feat(eventos-passados): página do evento mostra Evento encerrado, sem compra"
```

---

### Task 7: Action da equipe para esconder/mostrar nos passados

**Files:**
- Modify: `src/app/equipe/eventos/actions.ts` (perto de `setSalesOpen`, linha ~223, e de `setSalesOpenOrThrow`, linha ~348)
- Modify: `tests/equipe/staff-actions.test.ts` (import e mapa `staffActions`)
- Test: `tests/equipe/past-visibility-action.test.ts`

**Interfaces:**
- Produces: `setHiddenFromPast(id: string, hidden: boolean): Promise<ActionResult>`.

- [ ] **Step 1: Escrever os testes**

`tests/equipe/past-visibility-action.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { setHiddenFromPast } from "@/app/equipe/eventos/actions";

const eventId = "00000000-0000-4000-8000-000000000001";

function updateChain(result: { data: unknown; error: unknown }) {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

describe("setHiddenFromPast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("recusa quem não é da equipe sem tocar no banco", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await setHiddenFromPast(eventId, true)).toEqual({
      ok: false,
      error: "Acesso restrito à equipe.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("recusa id inválido", async () => {
    expect(await setHiddenFromPast("abc", true)).toEqual({
      ok: false,
      error: "Evento não encontrado.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("recusa valor que não é ligado/desligado", async () => {
    expect(await setHiddenFromPast(eventId, "sim" as unknown as boolean)).toEqual({
      ok: false,
      error: "Evento não encontrado.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("grava e atualiza a página inicial e a do evento", async () => {
    const chain = updateChain({ data: { slug: "show" }, error: null });
    mocks.from.mockReturnValue(chain);

    expect(await setHiddenFromPast(eventId, true)).toEqual({ ok: true, data: undefined });
    expect(mocks.from).toHaveBeenCalledWith("events");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ hidden_from_past: true }),
    );
    expect(chain.eq).toHaveBeenCalledWith("id", eventId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });

  it("falha do banco vira mensagem genérica", async () => {
    mocks.from.mockReturnValue(updateChain({ data: null, error: { message: "boom" } }));
    expect(await setHiddenFromPast(eventId, false)).toEqual({
      ok: false,
      error: "Não foi possível alterar a exibição do evento.",
    });
  });

  it("evento inexistente (nenhuma linha) também falha", async () => {
    mocks.from.mockReturnValue(updateChain({ data: null, error: null }));
    expect(await setHiddenFromPast(eventId, false)).toEqual({
      ok: false,
      error: "Não foi possível alterar a exibição do evento.",
    });
  });
});
```

Em `tests/equipe/staff-actions.test.ts`: acrescentar `setHiddenFromPast` ao import de `@/app/equipe/eventos/actions` e ao mapa `staffActions`:

```ts
  setHiddenFromPast: () => setHiddenFromPast(eventId, true),
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/equipe/past-visibility-action.test.ts tests/equipe/staff-actions.test.ts`
Expected: FAIL (`setHiddenFromPast` não existe).

- [ ] **Step 3: Implementar**

Em `src/app/equipe/eventos/actions.ts`, logo depois de `setSalesOpen` (export):

```ts
export async function setHiddenFromPast(id: string, hidden: boolean): Promise<ActionResult> {
  return runAction(
    () => setHiddenFromPastOrThrow(id, hidden),
    "Não foi possível alterar a exibição do evento.",
  );
}
```

e logo depois de `setSalesOpenOrThrow`:

```ts
async function setHiddenFromPastOrThrow(id: string, hidden: boolean): Promise<undefined> {
  if (typeof id !== "string" || !UUID_PATTERN.test(id) || typeof hidden !== "boolean") {
    throw new ActionError("Evento não encontrado.");
  }
  await assertStaff();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("events")
    .update({ hidden_from_past: hidden, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("slug")
    .maybeSingle();

  if (error || !data) {
    throw new ActionError("Não foi possível alterar a exibição do evento.");
  }

  revalidateEventSurfaces(id, data.slug);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/equipe/past-visibility-action.test.ts tests/equipe/staff-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/equipe/eventos/actions.ts tests/equipe/past-visibility-action.test.ts tests/equipe/staff-actions.test.ts
git commit -m "feat(equipe): action para esconder ou mostrar evento nos passados"
```

---

### Task 8: Painel — interruptor e selo "Encerrado"

**Files:**
- Create: `src/components/equipe/PastVisibilityToggle.tsx`
- Modify: `src/app/equipe/eventos/[id]/page.tsx` (header, logo após a grade de botões na linha ~422)
- Modify: `src/app/equipe/page.tsx`

**Interfaces:**
- Consumes: `setHiddenFromPast` (Task 7), `isPastEventDay` (Task 3), colunas `published_at`/`hidden_from_past` (Task 2).
- Produces: `PastVisibilityToggle({ eventId, shownInPast, className }: { eventId: string; shownInPast: boolean; className?: string })`.

- [ ] **Step 1: Componente do interruptor**

`src/components/equipe/PastVisibilityToggle.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setHiddenFromPast } from "@/app/equipe/eventos/actions";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";

export function PastVisibilityToggle({
  eventId,
  shownInPast,
  className,
}: {
  eventId: string;
  shownInPast: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const labelId = `passados-${eventId}`;

  function toggle() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await setHiddenFromPast(eventId, shownInPast);
        if (!result.ok) return setMessage(result.error);
        router.refresh();
      } catch {
        setMessage("Não foi possível alterar a exibição do evento.");
      }
    });
  }

  return (
    <div className={cx("rounded-2xl border border-byla-border bg-byla-surface p-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground" id={labelId}>
            Mostrar nos eventos passados
          </p>
          <p className="mt-1 text-sm text-byla-muted">
            Depois que o evento acontece, ele continua no site em Eventos passados. Desligue para
            esconder.
          </p>
        </div>
        <button
          aria-checked={shownInPast}
          aria-labelledby={labelId}
          className={cx(
            "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:opacity-60",
            shownInPast ? "border-byla-action bg-byla-action" : "border-byla-border bg-byla-overlay",
          )}
          disabled={isPending}
          onClick={toggle}
          role="switch"
          type="button"
        >
          <span
            aria-hidden
            className={cx(
              "inline-block h-6 w-6 rounded-full bg-white shadow transition motion-reduce:transition-none",
              shownInPast ? "translate-x-7" : "translate-x-1",
            )}
          />
        </button>
      </div>
      {message ? (
        <Notice className="mt-3" tone="danger">
          {message}
        </Notice>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Mostrar na página do evento no painel**

Em `src/app/equipe/eventos/[id]/page.tsx`: importar `import { PastVisibilityToggle } from "@/components/equipe/PastVisibilityToggle";` e, dentro do `<header>`, logo depois do `</div>` da grade de botões (que contém `<SalesToggle ... />`):

```tsx
        {event.published_at ? (
          <PastVisibilityToggle
            className="mt-4"
            eventId={event.id}
            shownInPast={!event.hidden_from_past}
          />
        ) : null}
```

(Só aparece para evento que já abriu vendas: rascunho nunca vai para os passados.)

- [ ] **Step 3: Lista do painel com a mesma regra do banco e selo "Encerrado"**

Em `src/app/equipe/page.tsx`:

1. Import: `import { isPastEventDay } from "@/lib/domain/past-events";`
2. Remover `PAST_AFTER_MS` e `lastStart`.
3. `EventRow` ganha:

```ts
  published_at: string | null;
  hidden_from_past: boolean;
  /** Fim (ou início, sem término) da última sessão ativa. */
  lastSessionAt: string | null;
```

4. `splitByDate`:

```ts
/** Evento passa para "Passados" no dia seguinte à última sessão (mesma regra do site). */
function splitByDate(events: EventRow[]) {
  const isPast = (event: EventRow) => isPastEventDay(event.lastSessionAt ?? event.starts_at);
  return {
    upcoming: events.filter((event) => !isPast(event)),
    past: events.filter(isPast).reverse(),
  };
}
```

5. Consulta: `"id, name, starts_at, sales_open, published_at, hidden_from_past, cover_image_url, event_sessions(starts_at, ends_at, status, archived_at)"`.
6. Montagem das linhas:

```ts
  const events: EventRow[] = (rows ?? []).map(({ event_sessions: sessions, ...event }) => {
    const active = (sessions ?? []).filter(
      (session) => session.status === "ativa" && session.archived_at === null,
    );
    const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);
    return {
      ...event,
      sessionStarts: active.map((session) => session.starts_at).sort(byTime),
      lastSessionAt:
        active.map((session) => session.ends_at ?? session.starts_at).sort(byTime).at(-1) ?? null,
    };
  });
```

7. `EventList` ganha a prop `past = false` e o selo:

```tsx
function EventList({
  title,
  events,
  past = false,
}: {
  title: string;
  events: EventRow[];
  past?: boolean;
}) {
```

trocando o `<StatusBadge ...>Venda aberta/fechada</StatusBadge>` por:

```tsx
                {past ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge>Encerrado</StatusBadge>
                    {event.published_at && event.hidden_from_past ? (
                      <StatusBadge tone="warning">Escondido do site</StatusBadge>
                    ) : null}
                  </div>
                ) : (
                  <StatusBadge className="mt-2" tone={event.sales_open ? "success" : "neutral"}>
                    {event.sales_open ? "Venda aberta" : "Venda fechada"}
                  </StatusBadge>
                )}
```

e o uso: `<EventList events={past} past title="Passados" />`.

- [ ] **Step 4: Conferir**

Run: `npx tsc --noEmit; npx eslint src/components/equipe/PastVisibilityToggle.tsx src/app/equipe/page.tsx "src/app/equipe/eventos/[id]/page.tsx"; npx vitest run`
Expected: sem erros; testes passam.

- [ ] **Step 5: Commit**

```powershell
git add src/components/equipe/PastVisibilityToggle.tsx src/app/equipe/page.tsx "src/app/equipe/eventos/[id]/page.tsx"
git commit -m "feat(equipe): interruptor Mostrar nos eventos passados e selo Encerrado"
```

---

### Task 9: Verificação completa local

**Files:** nenhum novo.

- [ ] **Step 1: Suíte inteira, tipos, lint e build**

Run: `npx vitest run; npx tsc --noEmit; npx eslint; npm run build`
Expected: todos os testes passam (eram 935 antes; agora mais os novos), sem erros de tipo/lint, build concluído.

- [ ] **Step 2: Conferência visual local com dados falsos (sem tocar no banco de produção)**

Rodar `npm run dev` e abrir `http://localhost:3000/?passados=abc` — a página carrega (a consulta dos passados pode falhar sem a migração; a página não pode quebrar). Conferir no celular (largura 390px) e no computador que a página inicial continua igual quando não há passados.

- [ ] **Step 3: Revisão de código**

Pedir revisão (superpowers:requesting-code-review) do conjunto Tasks 1-8 antes do banco e do deploy.

---

### Task 10: Banco, deploy e verificação em produção (exige "pode" do dono)

**Files:** nenhum novo (só execução).

- [ ] **Step 1: Pedir o "pode" ao dono**, explicando em uma frase: vai mudar o banco do Espaço Byla Eventos para os eventos passados aparecerem no site; nada de pedidos/ingressos muda.

- [ ] **Step 2: Declarar e conferir o banco**

No chat: "MCP `user-supabase-eventos`, projeto Espaço Byla Eventos (`rlzyjlrcasqbjztgbgit`)". Rodar `list_tables` e conferir `events`, `tickets`, `orders`, `ticket_types`, `staff_profiles` (e ausência de `alunos`/`transacoes`/`fluxo_*`). Conferir as políticas atuais:

```sql
select tablename, policyname, qual
from pg_policies
where schemaname = 'public'
  and policyname in ('events_public_read', 'event_images_public_read', 'event_sessions_public_read');
```

Expected: os textos batem com o que a migração substitui (`sales_open = true` em cada uma). Se divergir, parar e rever.

- [ ] **Step 3: Ensaio em transação revertida**

Executar `supabase/tests/past_events_check.sql` (com a migração colada no lugar marcado) via `execute_sql`. Expected: todas as colunas `true`. Depois conferir que nada ficou:

```sql
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'events' and column_name = 'published_at';
```

Expected: `0`.

- [ ] **Step 4: Aplicar a migração**

`apply_migration` com nome `past_events` e o conteúdo de `supabase/migrations/20261016100000_past_events.sql`. Depois: `get_advisors` (security) sem alertas novos para `event_is_past`, `public_past_events` e `events_mark_published`; `generate_typescript_types` e comparar com a Task 2.

- [ ] **Step 5: Push e build da imagem**

```powershell
git push origin feat/sair-vercel:main
$g = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
$sha = git rev-parse --short HEAD
```

Build com o mesmo comando usado nos deploys anteriores (`& $g builds submit --config=infra/cloudrun/cloudbuild.yaml --region=us-central1 --async --substitutions=...`), lendo `_SUPABASE_URL`, `_SUPABASE_ANON_KEY`, `_TURNSTILE_SITE_KEY` de `%USERPROFILE%\.byla-secrets\cloudrun.env` sem imprimir, `_APP_URL=https://ingressos.espacobyla.online` e `_IMAGE=us-central1-docker.pkg.dev/espaco-byla-eventos/site/web:$sha`. Esperar o build terminar com SUCCESS e o CI do GitHub passar.

- [ ] **Step 6: Revisão sem tráfego**

```powershell
& $g run deploy espaco-byla-eventos --image=us-central1-docker.pkg.dev/espaco-byla-eventos/site/web:$sha --region=us-central1 --no-traffic --tag=previa
```

Endereço de teste: `https://previa---espaco-byla-eventos-ujqrj5ka3q-uc.a.run.app`.

- [ ] **Step 7: Evento de teste passado (com o mesmo "pode")**

Via `execute_sql` (MCP `user-supabase-eventos`):

```sql
insert into public.events (name, slug, venue, capacity, starts_at, sales_open)
values ('Teste eventos passados', 'teste-eventos-passados', 'Espaço Byla', 10, now() - interval '3 days', true)
returning id;
```

e em seguida `update public.events set sales_open = false where slug = 'teste-eventos-passados';`.

Conferir por HTTP na revisão `previa` (sem navegador):
- `/` → 200, contém "Eventos passados" e "Teste eventos passados", não contém preço do evento de teste.
- `/?passados=abc` e `/?passados=999` → 200.
- `/eventos/teste-eventos-passados` → 200, contém "Evento encerrado" e "Ver próximos eventos", não contém "Comprar ingresso".
- `/eventos/teste-eventos-passados/checkout` → não permite compra (redireciona ou mostra vendas encerradas).
- Painel: login da equipe pelo dono não é necessário; conferir pelo banco que `published_at` foi preenchido.

Esconder pelo banco (simula o interruptor) e conferir que some de `/`:

```sql
update public.events set hidden_from_past = true where slug = 'teste-eventos-passados';
```

- [ ] **Step 8: Promover e limpar**

```powershell
& $g run revisions list --service=espaco-byla-eventos --region=us-central1 --limit=2
& $g run services update-traffic espaco-byla-eventos --region=us-central1 --to-revisions=<REVISAO_NOVA>=100 --remove-tags=previa
```

Conferir `https://ingressos.espacobyla.online/` → 200. Apagar o evento de teste:

```sql
delete from public.events where slug = 'teste-eventos-passados';
select count(*) from public.events;
```

Expected: o evento some (as sessões vão junto); contagem igual à de antes do teste.

- [ ] **Step 9: Pedir ao dono para testar o interruptor** na página de um evento no painel (quando houver um evento real publicado) e avisar em linguagem simples o que mudou.
