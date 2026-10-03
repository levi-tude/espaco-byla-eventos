-- Sessões dentro do evento, fase 1 (spec 2026-10-03-sessoes-design, aprovada em
-- 2026-10-03 20:19): cada evento passa a ter 1 ou mais sessões, cada uma com
-- horário, lotação, cotas e preços próprios; pedidos e ingressos pertencem a uma
-- sessão; a venda de cada sessão fecha sozinha 5 minutos depois do início.
--
-- Migration ADITIVA: aplicar ANTES do deploy do código novo. O código que está no
-- ar continua funcionando:
--   * evento novo (inserido direto pela equipe) ganha a sua sessão única por gatilho;
--   * evento e tipos editados pelas funções atuais espelham lotação, cotas, horário,
--     preço e limite na sessão única (gatilhos abaixo);
--   * create_checkout_order / issue_courtesy_ticket aceitam a chamada antiga (sem
--     sessão) e usam a sessão única do evento; com mais de uma sessão, recusam;
--   * event_availability continua existindo e devolve a disponibilidade da sessão única.
-- Os gatilhos de espelho valem só enquanto o evento tem 1 sessão e saem quando o
-- editor de sessões (fase 3) passar a gravar as sessões diretamente.

-- 1) Sessões -----------------------------------------------------------------

create table public.event_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Cascata só alcança sessões sem pedidos: orders.session_id não tem cascata e
  -- trava a exclusão. Necessária para desfazer a criação de um evento sem vendas.
  event_id uuid not null references public.events (id) on delete cascade,
  name text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity integer not null,
  inteira_quota integer,
  meia_quota integer,
  sales_open boolean not null default true,
  status text not null default 'ativa',
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancelled_by_name text,
  cancel_reason text,
  cancel_notice_sent_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_sessions_id_event_unique unique (id, event_id),
  constraint event_sessions_name_format check (
    name is null or (char_length(name) between 1 and 60 and name = btrim(name))
  ),
  constraint event_sessions_ends_after_start check (ends_at is null or ends_at > starts_at),
  constraint event_sessions_capacity_range check (capacity between 1 and 100000),
  constraint event_sessions_inteira_quota_range check (
    inteira_quota is null or inteira_quota between 1 and capacity
  ),
  constraint event_sessions_meia_quota_range check (
    meia_quota is null or meia_quota between 1 and capacity
  ),
  constraint event_sessions_quotas_within_capacity check (
    coalesce(inteira_quota, 0) + coalesce(meia_quota, 0) <= capacity
  ),
  constraint event_sessions_status_check check (status in ('ativa', 'cancelada')),
  constraint event_sessions_cancel_consistent check (
    (
      status = 'ativa'
      and cancelled_at is null
      and cancelled_by is null
      and cancelled_by_name is null
      and cancel_reason is null
    )
    or (
      status = 'cancelada'
      and cancelled_at is not null
      and cancelled_by_name is not null
      and char_length(cancelled_by_name) between 1 and 200
      and cancel_reason is not null
      and char_length(btrim(cancel_reason)) between 5 and 500
    )
  )
);

create index event_sessions_event_starts_idx on public.event_sessions (event_id, starts_at);

create unique index event_sessions_event_starts_uidx
  on public.event_sessions (event_id, starts_at)
  where archived_at is null;

alter table public.event_sessions enable row level security;
revoke all on table public.event_sessions from public, anon, authenticated;
grant select on table public.event_sessions to anon, authenticated;
grant select, insert, update, delete on table public.event_sessions to service_role;

-- Leitura pública só de sessão não removida de evento com venda aberta; a equipe
-- lê tudo. Sem política de escrita: só as funções (service_role) gravam.
create policy event_sessions_public_read on public.event_sessions
  for select using (
    (
      archived_at is null
      and exists (
        select 1 from public.events e
        where e.id = event_id and e.sales_open = true
      )
    )
    or public.is_staff()
  );

-- 2) Preço, "à venda" e limite de cada tipo em cada sessão --------------------

create table public.session_ticket_types (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.event_sessions (id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id) on delete cascade,
  price_cents integer not null,
  max_units integer,
  on_sale boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_ticket_types_unique unique (session_id, ticket_type_id),
  constraint session_ticket_types_price_range check (price_cents between 1 and 10000000),
  constraint session_ticket_types_max_units_range check (
    max_units is null or max_units between 1 and 100000
  )
);

create index session_ticket_types_ticket_type_idx on public.session_ticket_types (ticket_type_id);

alter table public.session_ticket_types enable row level security;
revoke all on table public.session_ticket_types from public, anon, authenticated;
grant select on table public.session_ticket_types to anon, authenticated;
grant select, insert, update, delete on table public.session_ticket_types to service_role;

create policy session_ticket_types_public_read on public.session_ticket_types
  for select using (
    (
      on_sale
      and exists (
        select 1
        from public.event_sessions s
        join public.events e on e.id = s.event_id
        join public.ticket_types tt on tt.id = ticket_type_id
        where s.id = session_id
          and s.archived_at is null
          and e.sales_open = true
          and tt.archived_at is null
          and tt.kind <> 'cortesia'
      )
    )
    or public.is_staff()
  );

-- 3) Pedido e ingressos apontam para a sessão ----------------------------------

alter table public.orders add column session_id uuid;
alter table public.tickets add column session_id uuid;

alter table public.orders
  drop constraint orders_decision_reason_check,
  add constraint orders_decision_reason_check check (
    decision_reason is null
    or decision_reason in ('sem_vaga', 'pago_apos_cancelamento', 'sessao_encerrada', 'sessao_cancelada')
  ),
  drop constraint orders_cancel_reason_check,
  add constraint orders_cancel_reason_check check (
    cancel_reason is null
    or cancel_reason in ('alterado_pelo_comprador', 'equipe', 'capacidade_legado', 'sessao_cancelada')
  );

-- 4) Migração dos dados: cada evento vira 1 sessão com os números atuais ----------

insert into public.event_sessions (
  event_id, starts_at, capacity, inteira_quota, meia_quota, sales_open, created_at, updated_at
)
select e.id, e.starts_at, e.capacity, e.inteira_quota, e.meia_quota, true, e.created_at, now()
from public.events e;

-- Cortesia nunca é vendida (sem preço na sessão); tipo sem preço válido não tem o
-- que vender (o checkout atual já recusa pedido de valor zero).
insert into public.session_ticket_types (session_id, ticket_type_id, price_cents, max_units, on_sale)
select s.id, tt.id, tt.price_cents, tt.max_units, true
from public.ticket_types tt
join public.event_sessions s on s.event_id = tt.event_id
where tt.kind <> 'cortesia'
  and tt.archived_at is null
  and tt.price_cents >= 1;

update public.orders o
set session_id = s.id
from public.event_sessions s
where s.event_id = o.event_id;

update public.tickets t
set session_id = o.session_id
from public.orders o
where o.id = t.order_id;

alter table public.orders
  alter column session_id set not null,
  add constraint orders_id_session_unique unique (id, session_id),
  add constraint orders_session_event_fkey foreign key (session_id, event_id)
    references public.event_sessions (id, event_id);

alter table public.tickets
  alter column session_id set not null,
  add constraint tickets_order_session_fkey foreign key (order_id, session_id)
    references public.orders (id, session_id) on delete cascade,
  add constraint tickets_session_event_fkey foreign key (session_id, event_id)
    references public.event_sessions (id, event_id);

create index orders_session_active_holds_idx
  on public.orders (session_id, expires_at)
  where status = 'pendente';
create index orders_session_status_idx on public.orders (session_id, status);
create index tickets_session_status_idx on public.tickets (session_id, status);

-- 5) Contagens por sessão (mesma regra das contagens por evento) ----------------

-- Pessoas que ocupam lugar na sessão: pago, entrada registrada, reserva ativa e
-- estorno ainda não concluído de ingresso que estava pago.
create function public.session_occupied_count(
  p_session_id uuid,
  p_exclude_order_id uuid default null
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*)
  from public.tickets t
  join public.orders o on o.id = t.order_id
  where t.session_id = p_session_id
    and (p_exclude_order_id is null or t.order_id <> p_exclude_order_id)
    and (
      t.status in ('pago', 'check_in')
      or (t.status = 'nao_pago' and o.status = 'pendente' and o.expires_at > now())
      or (
        t.status = 'estornado'
        and exists (
          select 1 from public.order_refunds r
          where r.order_id = t.order_id
            and r.status = 'solicitado'
            and r.previous_ticket_statuses ->> t.id::text = 'pago'
        )
      )
    );
$$;

create function public.session_kind_occupied_count(
  p_session_id uuid,
  p_kind public.ticket_kind,
  p_exclude_order_id uuid default null
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*)
  from public.tickets t
  join public.orders o on o.id = t.order_id
  where t.session_id = p_session_id
    and t.kind = p_kind
    and (p_exclude_order_id is null or t.order_id <> p_exclude_order_id)
    and (
      t.status in ('pago', 'check_in')
      or (t.status = 'nao_pago' and o.status = 'pendente' and o.expires_at > now())
      or (
        t.status = 'estornado'
        and exists (
          select 1 from public.order_refunds r
          where r.order_id = t.order_id
            and r.status = 'solicitado'
            and r.previous_ticket_statuses ->> t.id::text = 'pago'
        )
      )
    );
$$;

-- Unidades de um tipo ocupadas na sessão (1 Casadinha = 1 unidade).
create function public.session_type_units_taken(
  p_session_id uuid,
  p_ticket_type_id uuid,
  p_exclude_order_id uuid default null
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(ceil(x.people::numeric / x.people_per_unit)), 0)::bigint
  from (
    select oi.id, oi.people_per_unit, count(*) as people
    from public.order_items oi
    join public.tickets t on t.order_item_id = oi.id
    join public.orders o on o.id = oi.order_id
    where oi.ticket_type_id = p_ticket_type_id
      and t.session_id = p_session_id
      and (p_exclude_order_id is null or oi.order_id <> p_exclude_order_id)
      and (
        t.status in ('pago', 'check_in')
        or (t.status = 'nao_pago' and o.status = 'pendente' and o.expires_at > now())
        or (
          t.status = 'estornado'
          and exists (
            select 1 from public.order_refunds r
            where r.order_id = t.order_id
              and r.status = 'solicitado'
              and r.previous_ticket_statuses ->> t.id::text = 'pago'
          )
        )
      )
    group by oi.id, oi.people_per_unit
  ) x;
$$;

-- 6) Conferência da migração: só contagens, nada de dados pessoais ----------------

do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.events e
  where (select count(*) from public.event_sessions s where s.event_id = e.id) <> 1;
  if v_bad <> 0 then
    raise exception 'MIGRACAO_SESSOES: % evento(s) sem exatamente 1 sessão', v_bad;
  end if;

  select count(*) into v_bad
  from public.event_sessions s
  join public.events e on e.id = s.event_id
  where s.starts_at <> e.starts_at
    or s.capacity <> e.capacity
    or s.inteira_quota is distinct from e.inteira_quota
    or s.meia_quota is distinct from e.meia_quota;
  if v_bad <> 0 then
    raise exception 'MIGRACAO_SESSOES: % sessão(ões) com horário/lotação/cotas diferentes do evento', v_bad;
  end if;

  select count(*) into v_bad
  from public.tickets t
  join public.orders o on o.id = t.order_id
  where t.session_id is distinct from o.session_id;
  if v_bad <> 0 then
    raise exception 'MIGRACAO_SESSOES: % ingresso(s) em sessão diferente do pedido', v_bad;
  end if;

  select count(*) into v_bad
  from public.event_sessions s
  where public.session_occupied_count(s.id) <> public.event_occupied_count(s.event_id)
    or public.session_kind_occupied_count(s.id, 'inteira') <> public.event_kind_occupied_count(s.event_id, 'inteira')
    or public.session_kind_occupied_count(s.id, 'meia') <> public.event_kind_occupied_count(s.event_id, 'meia')
    or public.session_kind_occupied_count(s.id, 'cortesia') <> public.event_kind_occupied_count(s.event_id, 'cortesia');
  if v_bad <> 0 then
    raise exception 'MIGRACAO_SESSOES: % sessão(ões) com ocupação diferente do evento', v_bad;
  end if;

  select count(*) into v_bad
  from public.ticket_types tt
  join public.event_sessions s on s.event_id = tt.event_id
  where public.session_type_units_taken(s.id, tt.id) <> public.ticket_type_units_taken(tt.id);
  if v_bad <> 0 then
    raise exception 'MIGRACAO_SESSOES: % tipo(s) com unidades ocupadas diferentes', v_bad;
  end if;

  select count(*) into v_bad
  from public.ticket_types tt
  join public.event_sessions s on s.event_id = tt.event_id
  left join public.session_ticket_types stt
    on stt.session_id = s.id and stt.ticket_type_id = tt.id
  where tt.kind <> 'cortesia'
    and tt.archived_at is null
    and tt.price_cents >= 1
    and (
      stt.id is null
      or stt.price_cents <> tt.price_cents
      or stt.max_units is distinct from tt.max_units
      or not stt.on_sale
    );
  if v_bad <> 0 then
    raise exception 'MIGRACAO_SESSOES: % preço(s) da sessão diferentes do tipo', v_bad;
  end if;
end;
$$;

-- 7) Integridade e compatibilidade (gatilhos) ------------------------------------

-- O pedido (e seus ingressos) nunca muda de sessão: garante que uma ação sobre uma
-- sessão (ex.: estorno em lote) nunca alcance pedido de outra.
create function public.forbid_session_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id then
    raise exception 'SESSAO_IMUTAVEL: A sessão de um pedido não pode mudar.';
  end if;
  return new;
end;
$$;

create trigger orders_session_immutable
  before update of session_id on public.orders
  for each row execute function public.forbid_session_id_change();
create trigger tickets_session_immutable
  before update of session_id on public.tickets
  for each row execute function public.forbid_session_id_change();

create function public.forbid_session_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_id is distinct from old.event_id then
    raise exception 'SESSAO_IMUTAVEL: A sessão não pode mudar de evento.';
  end if;
  return new;
end;
$$;

create trigger event_sessions_event_immutable
  before update of event_id on public.event_sessions
  for each row execute function public.forbid_session_event_change();

-- Sessão única do evento (não removida), ou null se houver 0 ou mais de 1.
create function public.event_single_session_id(p_event_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(s.id))[1] end
  from public.event_sessions s
  where s.event_id = p_event_id and s.archived_at is null;
$$;

-- Pedido sem sessão (chamada antiga): usa a sessão única do evento; com mais de
-- uma, recusa (falha fechada). O ingresso herda a sessão do pedido.
create function public.orders_fill_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id is null then
    new.session_id := public.event_single_session_id(new.event_id);
    if new.session_id is null then
      raise exception 'SESSAO_INDISPONIVEL: Escolha a sessão.';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_fill_session
  before insert on public.orders
  for each row execute function public.orders_fill_session();

create function public.tickets_fill_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id is null then
    select o.session_id into new.session_id from public.orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;

create trigger tickets_fill_session
  before insert on public.tickets
  for each row execute function public.tickets_fill_session();

-- Evento criado pelo formulário atual (insert direto da equipe): ganha a sessão
-- única com o horário, a lotação e as cotas do evento. Security definer porque a
-- equipe não grava sessões diretamente.
create function public.events_create_single_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_sessions (event_id, starts_at, capacity, inteira_quota, meia_quota)
  values (new.id, new.starts_at, new.capacity, new.inteira_quota, new.meia_quota);
  return null;
end;
$$;

create trigger events_create_single_session
  after insert on public.events
  for each row execute function public.events_create_single_session();

-- Evento de sessão única editado pelas funções atuais: a sessão acompanha.
create function public.events_sync_single_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid := public.event_single_session_id(new.id);
begin
  if v_session_id is not null then
    update public.event_sessions s
    set starts_at = new.starts_at,
        capacity = new.capacity,
        inteira_quota = new.inteira_quota,
        meia_quota = new.meia_quota,
        updated_at = now()
    where s.id = v_session_id
      and (s.starts_at, s.capacity, s.inteira_quota, s.meia_quota)
        is distinct from (new.starts_at, new.capacity, new.inteira_quota, new.meia_quota);
  end if;
  return null;
end;
$$;

create trigger events_sync_single_session
  after update of starts_at, capacity, inteira_quota, meia_quota on public.events
  for each row execute function public.events_sync_single_session();

-- Tipo criado ou editado (preço, limite, volta à venda) em evento de sessão única:
-- o preço e o limite da sessão acompanham. Tipo arquivado sai da venda pelo próprio
-- arquivamento; a linha de preço fica para o histórico.
create function public.ticket_types_sync_single_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if new.kind = 'cortesia' or new.price_cents < 1 then
    return null;
  end if;
  v_session_id := public.event_single_session_id(new.event_id);
  if v_session_id is null then
    return null;
  end if;
  insert into public.session_ticket_types as stt (session_id, ticket_type_id, price_cents, max_units)
  values (v_session_id, new.id, new.price_cents, new.max_units)
  on conflict (session_id, ticket_type_id) do update
    set price_cents = excluded.price_cents,
        max_units = excluded.max_units,
        updated_at = now()
    where (stt.price_cents, stt.max_units) is distinct from (excluded.price_cents, excluded.max_units);
  return null;
end;
$$;

create trigger ticket_types_sync_single_session
  after insert or update of price_cents, max_units, archived_at on public.ticket_types
  for each row execute function public.ticket_types_sync_single_session();

-- 8) Venda pelo horário -----------------------------------------------------------

-- Constante única: a venda da sessão fecha 5 min depois do início (espelhada em
-- src/lib/domain/sessions.ts).
create function public.session_sales_close_offset()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '5 minutes';
$$;

-- Vende só com o evento e a sessão abertos, sessão ativa e não removida, e antes
-- de início + 5 min. Sessão inexistente = não vende.
create function public.session_is_selling(p_session_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select e.sales_open
      and s.sales_open
      and s.status = 'ativa'
      and s.archived_at is null
      and now() < s.starts_at + public.session_sales_close_offset()
    from public.event_sessions s
    join public.events e on e.id = s.event_id
    where s.id = p_session_id
  ), false);
$$;

-- Pedido pendente pode gerar PIX? Só dentro da reserva, sem PIX anterior e com a
-- sessão ainda vendendo (o PIX estenderia a reserva para depois do fechamento).
create function public.order_pix_allowed(p_order_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select o.status = 'pendente'
      and o.expires_at > now()
      and o.hold_extended_at is null
      and public.session_is_selling(o.session_id)
    from public.orders o
    where o.id = p_order_id
  ), false);
$$;

-- 9) Disponibilidade -----------------------------------------------------------------

-- Lotação, cotas e cada tipo (com preço, "à venda" e limite desta sessão), no
-- formato de event_availability, mais a situação da venda da sessão.
create function public.session_availability(p_session_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_session public.event_sessions%rowtype;
  v_sold bigint;
  v_occupied bigint;
  v_types jsonb;
  v_categories jsonb := '{}'::jsonb;
  v_kind public.ticket_kind;
  v_quota integer;
  v_kind_sold bigint;
  v_kind_taken bigint;
begin
  select * into v_session from public.event_sessions s where s.id = p_session_id;
  if not found then
    return null;
  end if;

  select count(*) into v_sold
  from public.tickets t
  where t.session_id = p_session_id and t.status in ('pago', 'check_in');

  v_occupied := greatest(public.session_occupied_count(p_session_id), v_sold);

  foreach v_kind in array array['inteira', 'meia']::public.ticket_kind[] loop
    v_quota := case v_kind when 'inteira' then v_session.inteira_quota else v_session.meia_quota end;
    select count(*) into v_kind_sold
    from public.tickets t
    where t.session_id = p_session_id and t.kind = v_kind and t.status in ('pago', 'check_in');
    v_kind_taken := greatest(public.session_kind_occupied_count(p_session_id, v_kind), v_kind_sold);
    v_categories := v_categories || jsonb_build_object(
      v_kind::text,
      jsonb_build_object(
        'quota', v_quota,
        'sold', v_kind_sold,
        'taken', v_kind_taken,
        'remaining', case when v_quota is null then null else greatest(v_quota - v_kind_taken, 0) end
      )
    );
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ticket_type_id', tt.id,
        'price_cents', stt.price_cents,
        'on_sale', coalesce(stt.on_sale, false) and tt.kind <> 'cortesia',
        'units_taken', u.taken,
        'units_sold', s.sold,
        'max_units', stt.max_units,
        'remaining_units', case
          when stt.max_units is null then null
          else greatest(stt.max_units - u.taken, 0)
        end,
        'has_sales', exists (
          select 1 from public.order_items oi where oi.ticket_type_id = tt.id
        )
      )
      order by tt.sort_order, tt.id
    ),
    '[]'::jsonb
  )
  into v_types
  from public.ticket_types tt
  left join public.session_ticket_types stt
    on stt.session_id = p_session_id and stt.ticket_type_id = tt.id
  cross join lateral (
    select public.session_type_units_taken(p_session_id, tt.id) as taken
  ) u
  cross join lateral (
    select coalesce(sum(ceil(x.people::numeric / x.people_per_unit)), 0)::bigint as sold
    from (
      select oi.people_per_unit, count(*) as people
      from public.order_items oi
      join public.tickets t on t.order_item_id = oi.id
      where oi.ticket_type_id = tt.id
        and t.session_id = p_session_id
        and t.status in ('pago', 'check_in')
      group by oi.id, oi.people_per_unit
    ) x
  ) s
  where tt.event_id = v_session.event_id and tt.archived_at is null;

  return jsonb_build_object(
    'session_id', v_session.id,
    'starts_at', v_session.starts_at,
    'closes_at', v_session.starts_at + public.session_sales_close_offset(),
    'selling', public.session_is_selling(v_session.id),
    'capacity', v_session.capacity,
    'sold', v_sold,
    'held', v_occupied - v_sold,
    'remaining', greatest(v_session.capacity - v_occupied, 0),
    'categories', v_categories,
    'types', v_types
  );
end;
$$;

-- v2 (compatibilidade): evento de sessão única = disponibilidade da sessão (agora
-- com "selling"). Com várias sessões não há um número único: devolve null e quem
-- chama deve usar session_availability / event_sessions_summary.
create or replace function public.event_availability(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.session_availability(public.event_single_session_id(p_event_id));
$$;

-- Resumo das sessões do evento (home, página do evento, painel): uma chamada só.
-- "min_price_cents" = menor preço à venda e não esgotado.
create function public.event_sessions_summary(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with sessions as (
    select
      s.id, s.name, s.starts_at, s.ends_at, s.status, s.sales_open,
      public.session_is_selling(s.id) as selling,
      greatest(s.capacity - public.session_occupied_count(s.id), 0) as remaining,
      (
        select min(stt.price_cents)
        from public.session_ticket_types stt
        join public.ticket_types tt on tt.id = stt.ticket_type_id
        where stt.session_id = s.id
          and stt.on_sale
          and tt.archived_at is null
          and tt.active
          and tt.kind <> 'cortesia'
          and (
            stt.max_units is null
            or public.session_type_units_taken(s.id, tt.id) < stt.max_units
          )
      ) as type_min_price
    from public.event_sessions s
    where s.event_id = p_event_id and s.archived_at is null
  )
  select jsonb_build_object(
    'min_price_cents', (
      select min(x.type_min_price) from sessions x where x.selling and x.remaining > 0
    ),
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'name', x.name,
          'starts_at', x.starts_at,
          'ends_at', x.ends_at,
          'status', x.status,
          'sales_open', x.sales_open,
          'selling', x.selling,
          'sold_out', x.remaining = 0,
          'remaining', x.remaining,
          'min_price_cents', case when x.remaining > 0 then x.type_min_price end
        )
        order by x.starts_at, x.id
      )
      from sessions x
    ), '[]'::jsonb)
  );
$$;

-- 10) Checkout v4: por sessão ----------------------------------------------------

-- Travas sempre na ordem evento → sessão (a mesma do formulário do evento): o
-- evento em modo compartilhado (compras em sessões diferentes não se esperam; a
-- edição do evento espera) e a SESSÃO exclusiva. Preço, "à venda", limite, lotação
-- e cotas vêm da sessão. Erros novos: SESSAO_INDISPONIVEL (inexistente, removida,
-- cancelada ou de outro evento) e SESSAO_ENCERRADA (venda fechada pela equipe ou
-- pelo horário; a mensagem antiga continua no texto para o código anterior).
-- p_session_id nulo (código anterior) usa a sessão única do evento; com mais de
-- uma, recusa.
drop function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text);

create function public.create_checkout_order(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_payment_provider text,
  p_public_token text,
  p_items jsonb,
  p_privacy_policy_version text default null,
  p_session_id uuid default null
)
returns table (
  order_id uuid,
  total_cents integer,
  expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_session public.event_sessions%rowtype;
  v_session_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '15 minutes';
  v_privacy_version text := nullif(btrim(p_privacy_policy_version), '');
  v_item jsonb;
  v_qty integer;
  v_type_id uuid;
  v_type_ids uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_people integer;
  v_total_cents integer;
  v_occupied bigint;
  v_taken bigint;
  v_quota integer;
  v_line record;
  v_item_id uuid;
  v_ticket_count integer;
  v_line_total integer;
  v_base integer;
begin
  perform 1 from public.events e where e.id = p_event_id for share;
  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  v_session_id := coalesce(p_session_id, public.event_single_session_id(p_event_id));
  if v_session_id is null then
    raise exception 'SESSAO_INDISPONIVEL: Escolha a sessão.';
  end if;
  select * into v_session from public.event_sessions s where s.id = v_session_id for update;
  if not found
    or v_session.event_id is distinct from p_event_id
    or v_session.archived_at is not null
    or v_session.status <> 'ativa' then
    raise exception 'SESSAO_INDISPONIVEL: Sessão indisponível.';
  end if;
  if not public.session_is_selling(v_session.id) then
    raise exception 'SESSAO_ENCERRADA: As vendas deste evento estão fechadas.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'TIPO_INDISPONIVEL: Selecione quantidades válidas de ingressos.';
  end if;
  if nullif(btrim(p_buyer_name), '') is null or nullif(btrim(p_buyer_email), '') is null then
    raise exception 'Preencha nome e e-mail para continuar.';
  end if;

  for v_item in select e.item from jsonb_array_elements(p_items) as e(item) loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item -> 'qty') is distinct from 'number'
      or (v_item ->> 'qty') !~ '^[0-9]{1,2}$' then
      raise exception 'TIPO_INDISPONIVEL: Selecione quantidades válidas de ingressos.';
    end if;
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty not between 1 and 10 then
      raise exception 'TIPO_INDISPONIVEL: Selecione quantidades válidas de ingressos.';
    end if;

    v_type_id := null;
    if v_item ? 'ticket_type_id' then
      if coalesce(v_item ->> 'ticket_type_id', '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'TIPO_INDISPONIVEL: Tipo de ingresso inválido.';
      end if;
      v_type_id := (v_item ->> 'ticket_type_id')::uuid;
    elsif v_item ->> 'kind' in ('inteira', 'meia') then
      select tt.id into v_type_id
      from public.ticket_types tt
      where tt.event_id = p_event_id
        and tt.preset = (v_item ->> 'kind')
        and tt.archived_at is null
        and tt.active;
    end if;

    if v_type_id is null or v_type_id = any(v_type_ids) then
      raise exception 'TIPO_INDISPONIVEL: Um dos tipos de ingresso selecionados está indisponível.';
    end if;
    v_type_ids := v_type_ids || v_type_id;
    v_qtys := v_qtys || v_qty;
  end loop;

  if (
    select count(*)
    from public.ticket_types tt
    join public.session_ticket_types stt
      on stt.ticket_type_id = tt.id and stt.session_id = v_session.id
    where tt.id = any(v_type_ids)
      and tt.event_id = p_event_id
      and tt.archived_at is null
      and tt.active
      and tt.kind <> 'cortesia'
      and stt.on_sale
  ) <> cardinality(v_type_ids) then
    raise exception 'TIPO_INDISPONIVEL: Um dos tipos de ingresso selecionados está indisponível.';
  end if;

  select coalesce(sum(r.qty * tt.people_per_unit), 0)::integer,
         coalesce(sum(r.qty * stt.price_cents), 0)::integer
  into v_people, v_total_cents
  from unnest(v_type_ids, v_qtys) as r(ticket_type_id, qty)
  join public.ticket_types tt on tt.id = r.ticket_type_id
  join public.session_ticket_types stt
    on stt.ticket_type_id = tt.id and stt.session_id = v_session.id;

  if v_people not between 1 and 10 then
    raise exception 'LIMITE_PESSOAS: Selecione de 1 a 10 pessoas por compra.';
  end if;
  if v_total_cents <= 0 then
    raise exception 'TIPO_INDISPONIVEL: Um dos tipos de ingresso selecionados está indisponível.';
  end if;

  v_occupied := public.session_occupied_count(v_session.id);
  if v_occupied + v_people > v_session.capacity then
    raise exception 'ESGOTADO_EVENTO:%', greatest(v_session.capacity - v_occupied, 0);
  end if;

  for v_line in
    select tt.kind, sum(r.qty * tt.people_per_unit)::integer as people
    from unnest(v_type_ids, v_qtys) as r(ticket_type_id, qty)
    join public.ticket_types tt on tt.id = r.ticket_type_id
    group by tt.kind
  loop
    v_quota := case v_line.kind
      when 'inteira' then v_session.inteira_quota
      when 'meia' then v_session.meia_quota
    end;
    if v_quota is not null then
      v_taken := public.session_kind_occupied_count(v_session.id, v_line.kind);
      if v_taken + v_line.people > v_quota then
        raise exception 'ESGOTADO_CATEGORIA:%:%', v_line.kind, greatest(v_quota - v_taken, 0);
      end if;
    end if;
  end loop;

  for v_line in
    select tt.id, stt.max_units, r.qty
    from unnest(v_type_ids, v_qtys) as r(ticket_type_id, qty)
    join public.ticket_types tt on tt.id = r.ticket_type_id
    join public.session_ticket_types stt
      on stt.ticket_type_id = tt.id and stt.session_id = v_session.id
    where stt.max_units is not null
  loop
    v_taken := public.session_type_units_taken(v_session.id, v_line.id);
    if v_taken + v_line.qty > v_line.max_units then
      raise exception 'ESGOTADO_TIPO:%:%', v_line.id, greatest(v_line.max_units - v_taken, 0);
    end if;
  end loop;

  insert into public.orders (
    id, event_id, session_id, buyer_name, buyer_email, buyer_phone, total_cents, status,
    public_token, payment_provider, payment_external_id, expires_at, privacy_policy_version,
    privacy_accepted_at
  ) values (
    v_order_id, p_event_id, v_session.id, btrim(p_buyer_name), lower(btrim(p_buyer_email)),
    nullif(btrim(p_buyer_phone), ''), v_total_cents, 'pendente', p_public_token,
    p_payment_provider, v_order_id::text, v_expires_at, v_privacy_version,
    case when v_privacy_version is not null then now() end
  );

  -- Um ingresso por pessoa. O preço da linha é rateado entre os ingressos
  -- (o resto da divisão vai no primeiro) para a soma bater com o total.
  for v_line in
    select tt.id, tt.name, tt.kind, stt.price_cents, tt.people_per_unit, r.qty
    from unnest(v_type_ids, v_qtys) with ordinality as r(ticket_type_id, qty, position)
    join public.ticket_types tt on tt.id = r.ticket_type_id
    join public.session_ticket_types stt
      on stt.ticket_type_id = tt.id and stt.session_id = v_session.id
    order by r.position
  loop
    v_item_id := gen_random_uuid();
    v_line_total := v_line.price_cents * v_line.qty;
    v_ticket_count := v_line.qty * v_line.people_per_unit;
    v_base := v_line_total / v_ticket_count;

    insert into public.order_items (
      id, order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit,
      quantity, line_total_cents
    ) values (
      v_item_id, v_order_id, v_line.id, v_line.name, v_line.kind, v_line.price_cents,
      v_line.people_per_unit, v_line.qty, v_line_total
    );

    insert into public.tickets (
      order_id, event_id, session_id, ticket_type_id, order_item_id, kind, status, code,
      buyer_name, price_cents
    )
    select
      v_order_id, p_event_id, v_session.id, v_line.id, v_item_id, v_line.kind, 'nao_pago',
      gen_random_uuid()::text, btrim(p_buyer_name),
      v_base + case when g.n = 1 then v_line_total - v_base * v_ticket_count else 0 end
    from generate_series(1, v_ticket_count) as g(n);
  end loop;

  return query select v_order_id, v_total_cents, v_expires_at;
end;
$$;

-- 11) Reserva estendida pelo PIX: não estende depois que a sessão parou de vender ---

create or replace function public.extend_order_hold_for_pix(
  p_order_id uuid,
  p_pix_expires_at timestamptz
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_expires_at timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if not found or v_order.status <> 'pendente' then
    return null;
  end if;
  if v_order.hold_extended_at is not null
    or v_order.expires_at is null
    or v_order.expires_at <= now()
    or p_pix_expires_at is null
    or p_pix_expires_at <= now()
    or not public.session_is_selling(v_order.session_id) then
    return v_order.expires_at;
  end if;

  v_expires_at := greatest(
    v_order.expires_at,
    least(p_pix_expires_at + interval '2 minutes', now() + interval '33 minutes')
  );

  update public.orders
  set expires_at = v_expires_at,
      hold_extended_at = now()
  where id = v_order.id;

  return v_expires_at;
end;
$$;

-- 12) Pagamento v4: por sessão, com fim da venda e sessão cancelada ----------------

-- Trava o pedido e depois a sessão. Resultados novos:
--   needs_decision_sales_closed     → pago depois de a reserva vencer com a venda da
--                                     sessão já encerrada (decision_reason = 'sessao_encerrada');
--   needs_decision_session_cancelled → sessão cancelada: nunca vira pago sozinho
--                                     (decision_reason = 'sessao_cancelada').
-- Dentro da reserva (pendente e não vencido) o pagamento vale mesmo com a venda
-- encerrada: o lugar já estava garantido.
create or replace function public.mark_order_paid_by_external(
  p_provider text,
  p_external_id text,
  p_provider_order_id text default null,
  p_provider_payment_id text default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_session public.event_sessions%rowtype;
  v_ticket_count integer;
  v_hold_valid boolean;
  v_provider_order_id text := nullif(btrim(p_provider_order_id), '');
  v_provider_payment_id text := nullif(btrim(p_provider_payment_id), '');
begin
  select *
  into v_order
  from public.orders o
  where o.payment_provider = p_provider
    and (
      o.payment_external_id = p_external_id
      or (
        p_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and o.id = p_external_id::uuid
      )
    )
  order by (o.payment_external_id = p_external_id) desc
  limit 1
  for update;

  if not found then
    return 'noop';
  end if;

  select * into v_session from public.event_sessions s where s.id = v_order.session_id for update;

  if (v_provider_order_id is not null and v_order.provider_order_id is null)
    or (v_provider_payment_id is not null and v_order.provider_payment_id is null) then
    update public.orders
    set provider_order_id = coalesce(provider_order_id, v_provider_order_id),
        provider_payment_id = coalesce(provider_payment_id, v_provider_payment_id)
    where id = v_order.id;
  end if;

  if v_order.status = 'pago' then
    if exists (
      select 1 from public.tickets
      where order_id = v_order.id and status = 'nao_pago'
    ) then
      update public.tickets
      set status = 'pago'
      where order_id = v_order.id and status = 'nao_pago';
      return 'repaired';
    end if;
    return 'noop';
  end if;

  if v_order.status = 'cancelado' then
    update public.orders
    set status = 'aguardando_decisao',
        decision_reason = case
          when v_session.status = 'cancelada' then 'sessao_cancelada'
          else 'pago_apos_cancelamento'
        end,
        paid_at = coalesce(paid_at, now()),
        expires_at = null
    where id = v_order.id;
    return case
      when v_session.status = 'cancelada' then 'needs_decision_session_cancelled'
      else 'needs_decision_cancelled'
    end;
  end if;

  if v_order.status not in ('pendente', 'expirado') then
    return 'noop';
  end if;

  if v_session.status = 'cancelada' then
    update public.orders
    set status = 'aguardando_decisao',
        decision_reason = 'sessao_cancelada',
        paid_at = coalesce(paid_at, now()),
        expires_at = null
    where id = v_order.id;
    return 'needs_decision_session_cancelled';
  end if;

  v_hold_valid := v_order.status = 'pendente' and v_order.expires_at > now();
  if not v_hold_valid and not public.session_is_selling(v_session.id) then
    update public.orders
    set status = 'aguardando_decisao',
        decision_reason = 'sessao_encerrada',
        paid_at = coalesce(paid_at, now()),
        expires_at = null
    where id = v_order.id;
    return 'needs_decision_sales_closed';
  end if;

  select count(*)::integer
  into v_ticket_count
  from public.tickets
  where order_id = v_order.id and status = 'nao_pago';

  if public.session_occupied_count(v_session.id, v_order.id) + v_ticket_count > v_session.capacity
    or exists (
      select 1
      from public.order_items oi
      join public.session_ticket_types stt
        on stt.ticket_type_id = oi.ticket_type_id and stt.session_id = v_session.id
      where oi.order_id = v_order.id
        and stt.max_units is not null
        and public.session_type_units_taken(v_session.id, oi.ticket_type_id, v_order.id)
          + oi.quantity > stt.max_units
    )
    or exists (
      select 1
      from (
        select t.kind, count(*) as people
        from public.tickets t
        where t.order_id = v_order.id and t.status = 'nao_pago'
        group by t.kind
      ) k
      cross join lateral (
        select case k.kind
          when 'inteira' then v_session.inteira_quota
          when 'meia' then v_session.meia_quota
        end as quota
      ) q
      where q.quota is not null
        and public.session_kind_occupied_count(v_session.id, k.kind, v_order.id) + k.people > q.quota
    ) then
    -- Ingressos seguem "nao_pago" (não ocupam vaga) até a equipe decidir.
    update public.orders
    set status = 'aguardando_decisao',
        decision_reason = 'sem_vaga',
        paid_at = coalesce(paid_at, now()),
        expires_at = null
    where id = v_order.id;
    return 'needs_decision_capacity';
  end if;

  update public.orders
  set status = 'pago',
      paid_at = coalesce(paid_at, now()),
      payment_external_id = coalesce(payment_external_id, p_external_id),
      expires_at = null
  where id = v_order.id;

  update public.tickets
  set status = 'pago'
  where order_id = v_order.id and status = 'nao_pago';

  return 'updated';
end;
$$;

-- 13) "Aceitar mesmo assim": trava a sessão; pedido de sessão cancelada só se estorna ---

create or replace function public.accept_paid_order(
  p_order_id uuid,
  p_staff_user_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_session_status text;
begin
  if p_staff_user_id is null or not exists (
    select 1 from public.staff_profiles where user_id = p_staff_user_id
  ) then
    raise exception 'Acesso restrito à equipe.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  select s.status into v_session_status
  from public.event_sessions s
  where s.id = v_order.session_id
  for update;

  if v_order.status = 'pago' and v_order.decided_at is not null then
    return 'noop';
  end if;
  if v_order.status <> 'aguardando_decisao' then
    raise exception 'O pedido não está aguardando decisão.';
  end if;
  if v_session_status = 'cancelada' or v_order.decision_reason = 'sessao_cancelada' then
    raise exception 'SESSAO_CANCELADA: Sessão cancelada: este pedido só pode ser estornado.';
  end if;

  update public.orders
  set status = 'pago',
      decided_by = p_staff_user_id,
      decided_at = now(),
      paid_at = coalesce(paid_at, now()),
      expires_at = null
  where id = v_order.id;

  update public.tickets
  set status = 'pago',
      cancelled_at = null
  where order_id = v_order.id and status in ('nao_pago', 'cancelado');

  return 'accepted';
end;
$$;

-- 14) Cortesia v3: por sessão; permitida com a venda encerrada (é a equipe que emite) ---

drop function public.issue_courtesy_ticket(uuid, text, text, text);

create function public.issue_courtesy_ticket(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_public_token text,
  p_session_id uuid default null
)
returns table (order_id uuid, ticket_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_session public.event_sessions%rowtype;
  v_session_id uuid;
  v_type public.ticket_types%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
  v_ticket_id uuid := gen_random_uuid();
begin
  perform 1 from public.events e where e.id = p_event_id for share;
  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  v_session_id := coalesce(p_session_id, public.event_single_session_id(p_event_id));
  if v_session_id is null then
    raise exception 'SESSAO_INDISPONIVEL: Escolha a sessão.';
  end if;
  select * into v_session from public.event_sessions s where s.id = v_session_id for update;
  if not found
    or v_session.event_id is distinct from p_event_id
    or v_session.archived_at is not null
    or v_session.status <> 'ativa' then
    raise exception 'SESSAO_INDISPONIVEL: Sessão indisponível.';
  end if;
  if nullif(btrim(p_buyer_name), '') is null
    or nullif(btrim(p_buyer_email), '') is null then
    raise exception 'Preencha nome e e-mail válidos.';
  end if;

  select * into v_type
  from public.ticket_types tt
  where tt.event_id = p_event_id
    and tt.kind = 'cortesia'
    and tt.archived_at is null
    and tt.active;
  if not found then
    raise exception 'Cortesia indisponível para este evento.';
  end if;
  if public.session_occupied_count(v_session.id) + 1 > v_session.capacity then
    raise exception 'Capacidade esgotada para este evento.';
  end if;

  insert into public.orders (
    id, event_id, session_id, buyer_name, buyer_email, total_cents, status, public_token,
    payment_provider, paid_at
  ) values (
    v_order_id, p_event_id, v_session.id, btrim(p_buyer_name), lower(btrim(p_buyer_email)), 0,
    'pago', p_public_token, 'cortesia_interna', now()
  );

  insert into public.order_items (
    id, order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit,
    quantity, line_total_cents
  ) values (
    v_item_id, v_order_id, v_type.id, v_type.name, 'cortesia', 0, 1, 1, 0
  );

  insert into public.tickets (
    id, order_id, event_id, session_id, ticket_type_id, order_item_id, kind, status, code,
    buyer_name, price_cents
  ) values (
    v_ticket_id, v_order_id, p_event_id, v_session.id, v_type.id, v_item_id, 'cortesia', 'pago',
    gen_random_uuid()::text, btrim(p_buyer_name), 0
  );

  return query select v_order_id, v_ticket_id;
end;
$$;

-- 15) Formulário atual do evento: grava na sessão única (com a trava da sessão) ------

-- Mesma assinatura e mensagens da v3. Evento com mais de uma sessão é recusado: o
-- editor de sessões (fase 3) é o caminho. A sessão acompanha o evento pelo gatilho
-- events_sync_single_session e os preços pelo ticket_types_sync_single_session.
create or replace function public.update_event_with_capacity(
  p_event_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_venue text,
  p_description text,
  p_capacity integer,
  p_cover_image_url text,
  p_ticket_types jsonb,
  p_inteira_quota integer,
  p_meia_quota integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_taken bigint;
begin
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  v_session_id := public.event_single_session_id(p_event_id);
  if v_session_id is null then
    raise exception 'SESSAO_VARIAS: Este evento tem mais de uma sessão.';
  end if;
  perform 1 from public.event_sessions s where s.id = v_session_id for update;

  if p_capacity < public.session_occupied_count(v_session_id) then
    raise exception 'A capacidade não pode ser menor que os ingressos já reservados.';
  end if;
  if (p_inteira_quota is not null and p_inteira_quota not between 1 and p_capacity)
    or (p_meia_quota is not null and p_meia_quota not between 1 and p_capacity)
    or coalesce(p_inteira_quota, 0) + coalesce(p_meia_quota, 0) > p_capacity then
    raise exception 'COTA_INVALIDA: As cotas precisam caber na lotação.';
  end if;
  if p_inteira_quota is not null then
    v_taken := public.session_kind_occupied_count(v_session_id, 'inteira');
    if p_inteira_quota < v_taken then
      raise exception 'COTA_MENOR:inteira:%', v_taken;
    end if;
  end if;
  if p_meia_quota is not null then
    v_taken := public.session_kind_occupied_count(v_session_id, 'meia');
    if p_meia_quota < v_taken then
      raise exception 'COTA_MENOR:meia:%', v_taken;
    end if;
  end if;

  update public.events e
  set name = p_name,
      starts_at = p_starts_at,
      venue = p_venue,
      description = p_description,
      capacity = p_capacity,
      inteira_quota = p_inteira_quota,
      meia_quota = p_meia_quota,
      cover_image_url = p_cover_image_url,
      updated_at = now()
  where e.id = p_event_id;

  perform public.save_event_ticket_types(p_event_id, p_ticket_types);
end;
$$;

-- 16) Lembrete v2: critério pela sessão do pedido e dados da sessão no e-mail ------

drop function public.claim_abandoned_order_reminders(integer, integer, text);

create function public.claim_abandoned_order_reminders(
  p_limit integer,
  p_daily_cap integer,
  p_min_policy_version text
)
returns table (
  order_id uuid,
  public_token text,
  buyer_name text,
  buyer_email text,
  optout_token text,
  event_name text,
  event_slug text,
  event_venue text,
  event_starts_at timestamptz,
  items jsonb,
  session_id uuid,
  session_name text,
  session_starts_at timestamptz,
  session_ends_at timestamptz
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_used integer;
  v_take integer;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'LEMBRETE_LIMITE_INVALIDO';
  end if;
  if p_daily_cap is null or p_daily_cap not between 1 and 100 then
    raise exception 'LEMBRETE_TETO_INVALIDO';
  end if;
  if p_min_policy_version is null or p_min_policy_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'LEMBRETE_POLITICA_INVALIDA';
  end if;

  -- Uma execução por vez: o teto diário e a regra de 1 lembrete por e-mail e
  -- evento não podem ser furados por execuções sobrepostas.
  perform pg_advisory_xact_lock(hashtextextended('byla:abandoned-reminders', 0));

  -- Janela móvel de 24 h: nunca passa do teto em nenhum dia do calendário.
  select count(*) into v_used
  from public.orders o
  where o.reminder_claimed_at > now() - interval '24 hours';

  v_take := least(p_limit, p_daily_cap - v_used);
  if v_take <= 0 then
    return;
  end if;

  return query
  with candidates as (
    select o.id
    from public.orders o
    join public.event_sessions s on s.id = o.session_id
    where (
        o.status = 'expirado'
        or (o.status = 'pendente' and o.expires_at <= now())
      )
      and o.total_cents > 0
      and o.created_at <= now() - interval '60 minutes'
      and o.created_at > now() - interval '24 hours'
      and o.reminder_sent_at is null
      and (
        o.reminder_claimed_at is null
        or o.reminder_claimed_at < now() - interval '30 minutes'
      )
      and o.reminder_attempts < 3
      and o.privacy_policy_version ~ '^\d{4}-\d{2}-\d{2}$'
      and o.privacy_policy_version >= p_min_policy_version
      -- A sessão do pedido ainda vende e tem lugar.
      and public.session_is_selling(s.id)
      and s.capacity > public.session_occupied_count(s.id)
      -- Só o pedido mais novo do e-mail no evento, e no máximo 1 lembrete por e-mail e evento.
      and not exists (
        select 1
        from public.orders other
        where other.event_id = o.event_id
          and other.id <> o.id
          and lower(btrim(other.buyer_email)) = lower(btrim(o.buyer_email))
          and (
            other.created_at > o.created_at
            or other.reminder_claimed_at is not null
            or other.reminder_sent_at is not null
          )
      )
      and not exists (
        select 1
        from public.email_reminder_optouts x
        where x.email_hash = public.reminder_email_hash(o.buyer_email)
      )
    order by o.created_at
    limit v_take
    for update of o skip locked
  ),
  claimed as (
    update public.orders o
    set reminder_claimed_at = now(),
        reminder_attempts = o.reminder_attempts + 1,
        reminder_optout_token = coalesce(
          o.reminder_optout_token,
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
        )
    from candidates c
    where o.id = c.id
    returning o.id, o.public_token, o.buyer_name, o.buyer_email,
      o.reminder_optout_token, o.event_id, o.session_id, o.created_at
  )
  select
    c.id,
    c.public_token,
    c.buyer_name,
    c.buyer_email,
    c.reminder_optout_token,
    e.name,
    e.slug,
    e.venue,
    s.starts_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('name', i.name, 'quantity', i.quantity)
          order by i.created_at, i.id
        )
        from public.order_items i
        where i.order_id = c.id
      ),
      '[]'::jsonb
    ),
    s.id,
    s.name,
    s.starts_at,
    s.ends_at
  from claimed c
  join public.events e on e.id = c.event_id
  join public.event_sessions s on s.id = c.session_id
  order by c.created_at;
end;
$$;

-- 17) Permissões --------------------------------------------------------------------

revoke all on function public.session_occupied_count(uuid, uuid) from public, anon, authenticated;
revoke all on function public.session_kind_occupied_count(uuid, public.ticket_kind, uuid) from public, anon, authenticated;
revoke all on function public.session_type_units_taken(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.forbid_session_id_change() from public, anon, authenticated;
revoke all on function public.forbid_session_event_change() from public, anon, authenticated;
revoke all on function public.event_single_session_id(uuid) from public, anon, authenticated;
revoke all on function public.orders_fill_session() from public, anon, authenticated;
revoke all on function public.tickets_fill_session() from public, anon, authenticated;
revoke all on function public.events_create_single_session() from public, anon, authenticated;
revoke all on function public.events_sync_single_session() from public, anon, authenticated;
revoke all on function public.ticket_types_sync_single_session() from public, anon, authenticated;
revoke all on function public.session_sales_close_offset() from public, anon, authenticated;
revoke all on function public.session_is_selling(uuid) from public, anon, authenticated;
revoke all on function public.order_pix_allowed(uuid) from public, anon, authenticated;
revoke all on function public.session_availability(uuid) from public, anon, authenticated;
revoke all on function public.event_availability(uuid) from public, anon, authenticated;
revoke all on function public.event_sessions_summary(uuid) from public, anon, authenticated;
revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.extend_order_hold_for_pix(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_order_paid_by_external(text, text, text, text) from public, anon, authenticated;
revoke all on function public.accept_paid_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_courtesy_ticket(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_abandoned_order_reminders(integer, integer, text) from public, anon, authenticated;

grant execute on function public.session_occupied_count(uuid, uuid) to service_role;
grant execute on function public.session_kind_occupied_count(uuid, public.ticket_kind, uuid) to service_role;
grant execute on function public.session_type_units_taken(uuid, uuid, uuid) to service_role;
grant execute on function public.event_single_session_id(uuid) to service_role;
grant execute on function public.session_sales_close_offset() to service_role;
grant execute on function public.session_is_selling(uuid) to service_role;
grant execute on function public.order_pix_allowed(uuid) to service_role;
grant execute on function public.session_availability(uuid) to service_role;
grant execute on function public.event_availability(uuid) to service_role;
grant execute on function public.event_sessions_summary(uuid) to service_role;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid) to service_role;
grant execute on function public.extend_order_hold_for_pix(uuid, timestamptz) to service_role;
grant execute on function public.mark_order_paid_by_external(text, text, text, text) to service_role;
grant execute on function public.accept_paid_order(uuid, uuid) to service_role;
grant execute on function public.issue_courtesy_ticket(uuid, text, text, text, uuid) to service_role;
grant execute on function public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, jsonb, integer, integer) to service_role;
grant execute on function public.claim_abandoned_order_reminders(integer, integer, text) to service_role;
