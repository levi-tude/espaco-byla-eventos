-- Fase 5 (tipos de ingresso configuráveis) da spec 2026-10-01-estorno-tipos-carrinho,
-- com as decisões do dono de 2026-10-03: todo evento tem os tipos prontos Inteira,
-- Meia-entrada, Casadinha (2 inteiras) e Pacote família (4 inteiras), com pessoas
-- fixas e preço sempre definido pela equipe; a equipe também cria tipos próprios
-- (sempre categoria inteira). O pedido guarda os itens com nome e preço do momento
-- da compra e gera um ingresso (um QR) por pessoa. Tipo nunca é apagado: sai da
-- venda (arquivado) e continua no histórico. O evento pode ter cotas opcionais de
-- inteiras e de meias (pessoas), dentro da lotação.

-- 1) Tipos de ingresso v2 ----------------------------------------------------

alter table public.ticket_types
  add column name text,
  add column preset text,
  add column people_per_unit integer not null default 1,
  add column max_units integer,
  add column sort_order integer not null default 0,
  add column archived_at timestamptz;

-- Tipos atuais: inteira e meia viram os tipos prontos com os mesmos preços;
-- 1 pessoa; ordem inteira/meia/cortesia. Desativado (active = false) = arquivado.
update public.ticket_types
set name = case kind
      when 'inteira' then 'Inteira'
      when 'meia' then 'Meia-entrada'
      else 'Cortesia'
    end,
    preset = case kind
      when 'inteira' then 'inteira'
      when 'meia' then 'meia'
    end,
    sort_order = case kind
      when 'inteira' then 0
      when 'meia' then 1
      else 1000
    end,
    archived_at = case when active then null else now() end;

alter table public.ticket_types
  alter column name set not null,
  add constraint ticket_types_name_format check (
    char_length(name) between 1 and 60 and name = btrim(name)
  ),
  add constraint ticket_types_people_per_unit_range check (people_per_unit between 1 and 10),
  add constraint ticket_types_max_units_range check (
    max_units is null or max_units between 1 and 100000
  ),
  add constraint ticket_types_active_matches_archive check (active = (archived_at is null)),
  add constraint ticket_types_courtesy_one_person check (
    kind <> 'cortesia' or (people_per_unit = 1 and preset is null)
  ),
  -- Tipos prontos: nome, categoria e pessoas fixos (o preço é da equipe).
  add constraint ticket_types_preset_definition check (
    preset is null
    or (preset = 'inteira' and kind = 'inteira' and people_per_unit = 1 and name = 'Inteira')
    or (preset = 'meia' and kind = 'meia' and people_per_unit = 1 and name = 'Meia-entrada')
    or (preset = 'casadinha' and kind = 'inteira' and people_per_unit = 2 and name = 'Casadinha')
    or (preset = 'familia' and kind = 'inteira' and people_per_unit = 4 and name = 'Pacote família')
  ),
  -- Tipo criado pela equipe é sempre categoria inteira (meia só pelo tipo pronto).
  add constraint ticket_types_custom_is_inteira check (
    preset is not null or kind in ('inteira', 'cortesia')
  );

-- Sai o "um tipo por categoria": Casadinha, Pacote família e os tipos da equipe
-- também são inteira. Procura pelo conteúdo para não depender do nome.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.ticket_types'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['event_id', 'kind']
  loop
    execute format('alter table public.ticket_types drop constraint %I', v_constraint);
  end loop;
end;
$$;

create unique index ticket_types_event_name_uidx
  on public.ticket_types (event_id, lower(name))
  where archived_at is null;

create unique index ticket_types_one_preset_uidx
  on public.ticket_types (event_id, preset)
  where preset is not null and archived_at is null;

create unique index ticket_types_one_courtesy_uidx
  on public.ticket_types (event_id)
  where kind = 'cortesia' and archived_at is null;

create index ticket_types_event_sort_idx
  on public.ticket_types (event_id, sort_order);

-- Leitura pública só dos tipos à venda; escrita só pelas funções abaixo
-- (service_role), que garantem as regras de vendas e da cortesia.
drop policy ticket_types_public_read on public.ticket_types;
drop policy ticket_types_staff_write on public.ticket_types;

create policy ticket_types_public_read on public.ticket_types
  for select using (
    (
      kind <> 'cortesia'
      and archived_at is null
      and active
      and exists (
        select 1
        from public.events e
        where e.id = event_id and e.sales_open = true
      )
    )
    or public.is_staff()
  );

-- Cotas por categoria (decisão de 2026-10-03), em pessoas: a de inteiras conta
-- todo ingresso inteira (Inteira, cada pessoa de Casadinha, Pacote família e
-- tipos da equipe); a de meias, os ingressos meia. Vazio = sem cota própria
-- (vale só a lotação). A cortesia conta só na lotação, como antes.
alter table public.events
  add column inteira_quota integer,
  add column meia_quota integer,
  add constraint events_inteira_quota_range check (
    inteira_quota is null or inteira_quota between 1 and capacity
  ),
  add constraint events_meia_quota_range check (
    meia_quota is null or meia_quota between 1 and capacity
  ),
  add constraint events_quotas_within_capacity check (
    coalesce(inteira_quota, 0) + coalesce(meia_quota, 0) <= capacity
  );

-- 2) Itens do pedido ---------------------------------------------------------

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id),
  -- Cópias do momento da compra: o histórico não muda se o tipo for editado.
  name text not null,
  kind public.ticket_kind not null,
  unit_price_cents integer not null,
  people_per_unit integer not null,
  quantity integer not null,
  line_total_cents integer not null,
  created_at timestamptz not null default now(),
  constraint order_items_name_length check (char_length(name) between 1 and 60),
  constraint order_items_unit_price_check check (unit_price_cents >= 0),
  constraint order_items_people_per_unit_range check (people_per_unit between 1 and 10),
  constraint order_items_quantity_positive check (quantity >= 1),
  constraint order_items_line_total_check check (line_total_cents = unit_price_cents * quantity)
);

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_ticket_type_id_idx on public.order_items (ticket_type_id);

alter table public.order_items enable row level security;
revoke all on table public.order_items from public, anon, authenticated;
grant select on table public.order_items to authenticated;
grant select, insert, update on table public.order_items to service_role;

-- Leitura só para a equipe; escrita só pelas funções (service_role).
create policy order_items_staff_read on public.order_items
  for select to authenticated
  using (public.is_staff());

alter table public.tickets
  add column order_item_id uuid references public.order_items (id);

-- Ingressos atuais: um item por (pedido, tipo, preço), 1 pessoa por unidade.
insert into public.order_items (
  order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit,
  quantity, line_total_cents, created_at
)
select
  t.order_id,
  t.ticket_type_id,
  tt.name,
  t.kind,
  t.price_cents,
  1,
  count(*)::integer,
  t.price_cents * count(*)::integer,
  min(t.created_at)
from public.tickets t
join public.ticket_types tt on tt.id = t.ticket_type_id
group by t.order_id, t.ticket_type_id, tt.name, t.kind, t.price_cents;

update public.tickets t
set order_item_id = oi.id
from public.order_items oi
where oi.order_id = t.order_id
  and oi.ticket_type_id = t.ticket_type_id
  and oi.kind = t.kind
  and oi.unit_price_cents = t.price_cents;

alter table public.tickets
  alter column order_item_id set not null;

create index tickets_order_item_id_idx on public.tickets (order_item_id);

-- 3) Contagem por tipo -------------------------------------------------------

-- Unidades de um tipo que ocupam lugar: mesma regra de event_occupied_count
-- (pago, reserva ativa, estorno ainda não concluído), contada por pessoas e
-- convertida em unidades pelo "pessoas por unidade" gravado no item.
create function public.ticket_type_units_taken(
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
      and (p_exclude_order_id is null or oi.order_id <> p_exclude_order_id)
      and (
        t.status in ('pago', 'check_in')
        or (
          t.status = 'nao_pago'
          and o.status = 'pendente'
          and o.expires_at > now()
        )
        or (
          t.status = 'estornado'
          and exists (
            select 1
            from public.order_refunds r
            where r.order_id = t.order_id
              and r.status = 'solicitado'
              and r.previous_ticket_statuses ->> t.id::text = 'pago'
          )
        )
      )
    group by oi.id, oi.people_per_unit
  ) x;
$$;

-- Pessoas de uma categoria que ocupam lugar (para as cotas): mesma regra de
-- event_occupied_count, filtrada pela categoria do ingresso.
create function public.event_kind_occupied_count(
  p_event_id uuid,
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
  where t.event_id = p_event_id
    and t.kind = p_kind
    and (p_exclude_order_id is null or t.order_id <> p_exclude_order_id)
    and (
      t.status in ('pago', 'check_in')
      or (
        t.status = 'nao_pago'
        and o.status = 'pendente'
        and o.expires_at > now()
      )
      or (
        t.status = 'estornado'
        and exists (
          select 1
          from public.order_refunds r
          where r.order_id = t.order_id
            and r.status = 'solicitado'
            and r.previous_ticket_statuses ->> t.id::text = 'pago'
        )
      )
    );
$$;

-- Lotação do evento (pessoas), cotas por categoria e situação de cada tipo à
-- venda ou de cortesia.
create function public.event_availability(p_event_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_capacity integer;
  v_sold bigint;
  v_occupied bigint;
  v_types jsonb;
  v_categories jsonb := '{}'::jsonb;
  v_kind public.ticket_kind;
  v_quota integer;
  v_kind_sold bigint;
  v_kind_taken bigint;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    return null;
  end if;
  v_capacity := v_event.capacity;

  select count(*) into v_sold
  from public.tickets t
  where t.event_id = p_event_id and t.status in ('pago', 'check_in');

  v_occupied := greatest(public.event_occupied_count(p_event_id), v_sold);

  foreach v_kind in array array['inteira', 'meia']::public.ticket_kind[] loop
    v_quota := case v_kind when 'inteira' then v_event.inteira_quota else v_event.meia_quota end;
    select count(*) into v_kind_sold
    from public.tickets t
    where t.event_id = p_event_id and t.kind = v_kind and t.status in ('pago', 'check_in');
    v_kind_taken := greatest(public.event_kind_occupied_count(p_event_id, v_kind), v_kind_sold);
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
        'units_taken', u.taken,
        'units_sold', s.sold,
        'max_units', tt.max_units,
        'remaining_units', case
          when tt.max_units is null then null
          else greatest(tt.max_units - u.taken, 0)
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
  cross join lateral (
    select public.ticket_type_units_taken(tt.id) as taken
  ) u
  cross join lateral (
    select coalesce(sum(ceil(x.people::numeric / x.people_per_unit)), 0)::bigint as sold
    from (
      select oi.people_per_unit, count(*) as people
      from public.order_items oi
      join public.tickets t on t.order_item_id = oi.id
      where oi.ticket_type_id = tt.id and t.status in ('pago', 'check_in')
      group by oi.id, oi.people_per_unit
    ) x
  ) s
  where tt.event_id = p_event_id and tt.archived_at is null;

  return jsonb_build_object(
    'capacity', v_capacity,
    'sold', v_sold,
    'held', v_occupied - v_sold,
    'remaining', greatest(v_capacity - v_occupied, 0),
    'categories', v_categories,
    'types', v_types
  );
end;
$$;

-- 4) Checkout v3 -------------------------------------------------------------

-- p_items = [{ "ticket_type_id": uuid, "qty": 1..10 }]. O formato anterior
-- [{ "kind": "inteira" | "meia", "qty" }] continua aceito para a versão do site
-- que estiver no ar enquanto esta migration é aplicada.
-- Erros com prefixo estável para a ação traduzir: TIPO_INDISPONIVEL,
-- LIMITE_PESSOAS, ESGOTADO_EVENTO:<restantes>, ESGOTADO_CATEGORIA:<inteira|meia>:<restantes>,
-- ESGOTADO_TIPO:<tipo>:<restantes>.
create or replace function public.create_checkout_order(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_payment_provider text,
  p_public_token text,
  p_items jsonb,
  p_privacy_policy_version text default null
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
  v_event public.events%rowtype;
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
  select * into v_event from public.events e where e.id = p_event_id for update;
  if not found then raise exception 'Evento não encontrado.'; end if;
  if not v_event.sales_open then raise exception 'As vendas deste evento estão fechadas.'; end if;
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
    where tt.id = any(v_type_ids)
      and tt.event_id = p_event_id
      and tt.archived_at is null
      and tt.active
      and tt.kind <> 'cortesia'
  ) <> cardinality(v_type_ids) then
    raise exception 'TIPO_INDISPONIVEL: Um dos tipos de ingresso selecionados está indisponível.';
  end if;

  select coalesce(sum(r.qty * tt.people_per_unit), 0)::integer,
         coalesce(sum(r.qty * tt.price_cents), 0)::integer
  into v_people, v_total_cents
  from unnest(v_type_ids, v_qtys) as r(ticket_type_id, qty)
  join public.ticket_types tt on tt.id = r.ticket_type_id;

  if v_people not between 1 and 10 then
    raise exception 'LIMITE_PESSOAS: Selecione de 1 a 10 pessoas por compra.';
  end if;
  if v_total_cents <= 0 then
    raise exception 'TIPO_INDISPONIVEL: Um dos tipos de ingresso selecionados está indisponível.';
  end if;

  v_occupied := public.event_occupied_count(p_event_id);
  if v_occupied + v_people > v_event.capacity then
    raise exception 'ESGOTADO_EVENTO:%', greatest(v_event.capacity - v_occupied, 0);
  end if;

  for v_line in
    select tt.kind, sum(r.qty * tt.people_per_unit)::integer as people
    from unnest(v_type_ids, v_qtys) as r(ticket_type_id, qty)
    join public.ticket_types tt on tt.id = r.ticket_type_id
    group by tt.kind
  loop
    v_quota := case v_line.kind
      when 'inteira' then v_event.inteira_quota
      when 'meia' then v_event.meia_quota
    end;
    if v_quota is not null then
      v_taken := public.event_kind_occupied_count(p_event_id, v_line.kind);
      if v_taken + v_line.people > v_quota then
        raise exception 'ESGOTADO_CATEGORIA:%:%', v_line.kind, greatest(v_quota - v_taken, 0);
      end if;
    end if;
  end loop;

  for v_line in
    select tt.id, tt.max_units, r.qty
    from unnest(v_type_ids, v_qtys) as r(ticket_type_id, qty)
    join public.ticket_types tt on tt.id = r.ticket_type_id
    where tt.max_units is not null
  loop
    v_taken := public.ticket_type_units_taken(v_line.id);
    if v_taken + v_line.qty > v_line.max_units then
      raise exception 'ESGOTADO_TIPO:%:%', v_line.id, greatest(v_line.max_units - v_taken, 0);
    end if;
  end loop;

  insert into public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, total_cents, status, public_token,
    payment_provider, payment_external_id, expires_at, privacy_policy_version, privacy_accepted_at
  ) values (
    v_order_id, p_event_id, btrim(p_buyer_name), lower(btrim(p_buyer_email)), nullif(btrim(p_buyer_phone), ''),
    v_total_cents, 'pendente', p_public_token, p_payment_provider, v_order_id::text, v_expires_at,
    v_privacy_version, case when v_privacy_version is not null then now() end
  );

  -- Um ingresso por pessoa. O preço da linha é rateado entre os ingressos
  -- (o resto da divisão vai no primeiro) para a soma bater com o total.
  for v_line in
    select tt.id, tt.name, tt.kind, tt.price_cents, tt.people_per_unit, r.qty
    from unnest(v_type_ids, v_qtys) with ordinality as r(ticket_type_id, qty, position)
    join public.ticket_types tt on tt.id = r.ticket_type_id
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
      order_id, event_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents
    )
    select
      v_order_id, p_event_id, v_line.id, v_item_id, v_line.kind, 'nao_pago',
      gen_random_uuid()::text, btrim(p_buyer_name),
      v_base + case when g.n = 1 then v_line_total - v_base * v_ticket_count else 0 end
    from generate_series(1, v_ticket_count) as g(n);
  end loop;

  return query select v_order_id, v_total_cents, v_expires_at;
end;
$$;

-- 5) Cortesia v2: usa o tipo de cortesia não arquivado e registra o item.
create or replace function public.issue_courtesy_ticket(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_public_token text
)
returns table (order_id uuid, ticket_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_type public.ticket_types%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
  v_ticket_id uuid := gen_random_uuid();
begin
  select * into v_event from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'Evento não encontrado.';
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
  if public.event_occupied_count(p_event_id) + 1 > v_event.capacity then
    raise exception 'Capacidade esgotada para este evento.';
  end if;

  insert into public.orders (
    id, event_id, buyer_name, buyer_email, total_cents, status, public_token,
    payment_provider, paid_at
  ) values (
    v_order_id, p_event_id, btrim(p_buyer_name), lower(btrim(p_buyer_email)), 0, 'pago',
    p_public_token, 'cortesia_interna', now()
  );

  insert into public.order_items (
    id, order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit,
    quantity, line_total_cents
  ) values (
    v_item_id, v_order_id, v_type.id, v_type.name, 'cortesia', 0, 1, 1, 0
  );

  insert into public.tickets (
    id, order_id, event_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents
  ) values (
    v_ticket_id, v_order_id, p_event_id, v_type.id, v_item_id, 'cortesia', 'pago',
    gen_random_uuid()::text, btrim(p_buyer_name), 0
  );

  return query select v_order_id, v_ticket_id;
end;
$$;

-- 6) Editor de tipos ---------------------------------------------------------

-- p_types = tipos à venda, na ordem de exibição. Tipo pronto:
--   { "preset": inteira|meia|casadinha|familia, "price_cents", "max_units": int | null }
-- (nome, categoria e pessoas vêm da definição do tipo pronto). Tipo da equipe:
--   { "id": uuid | null, "name", "people_per_unit", "price_cents", "max_units" }
-- (sempre categoria inteira). Tipos fora da lista saem da venda (arquivados),
-- nunca apagados; tipo pronto desmarcado e marcado de novo volta com o mesmo
-- registro. A cortesia é garantida automaticamente. Erros com prefixo TIPOS_*.
create function public.save_event_ticket_types(
  p_event_id uuid,
  p_types jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_raw text;
  v_id uuid;
  v_preset text;
  v_name text;
  v_kind text;
  v_price integer;
  v_people integer;
  v_max integer;
  v_existing public.ticket_types%rowtype;
  v_taken bigint;
  v_ids uuid[] := '{}';
  v_keep_ids uuid[] := '{}';
  v_custom_keep_ids uuid[] := '{}';
  v_presets text[] := '{}';
  v_names text[] := '{}';
  v_display_names text[] := '{}';
  v_kinds text[] := '{}';
  v_prices integer[] := '{}';
  v_peoples integer[] := '{}';
  v_maxes integer[] := '{}';
  i integer;
begin
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'TIPOS_EVENTO: Evento não encontrado.';
  end if;
  if p_types is null or jsonb_typeof(p_types) <> 'array'
    or jsonb_array_length(p_types) not between 1 and 20 then
    raise exception 'TIPOS_QUANTIDADE: Cadastre de 1 a 20 tipos de ingresso.';
  end if;

  for v_item in select e.item from jsonb_array_elements(p_types) as e(item) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'TIPOS_INVALIDO: Tipo de ingresso inválido.';
    end if;

    v_preset := null;
    if v_item -> 'preset' is not null and jsonb_typeof(v_item -> 'preset') <> 'null' then
      v_preset := v_item ->> 'preset';
      if jsonb_typeof(v_item -> 'preset') <> 'string'
        or v_preset not in ('inteira', 'meia', 'casadinha', 'familia') then
        raise exception 'TIPOS_INVALIDO: Tipo pronto inválido.';
      end if;
      if v_preset = any(v_presets) then
        raise exception 'TIPOS_INVALIDO: Tipo de ingresso repetido.';
      end if;
    end if;

    if v_preset is not null then
      v_name := case v_preset
        when 'inteira' then 'Inteira'
        when 'meia' then 'Meia-entrada'
        when 'casadinha' then 'Casadinha'
        else 'Pacote família'
      end;
      v_kind := case v_preset when 'meia' then 'meia' else 'inteira' end;
      v_people := case v_preset when 'casadinha' then 2 when 'familia' then 4 else 1 end;
    else
      v_name := btrim(coalesce(v_item ->> 'name', ''));
      if char_length(v_name) not between 1 and 60 then
        raise exception 'TIPOS_NOME: Nome do tipo inválido.';
      end if;
      -- Nomes dos tipos prontos e da cortesia não podem ser usados por tipos da
      -- equipe (que são sempre inteira): evita "Meia" cobrando como inteira.
      if lower(v_name) in (
        'cortesia', 'inteira', 'meia', 'meia-entrada', 'meia entrada',
        'casadinha', 'pacote família', 'pacote familia'
      ) then
        raise exception 'TIPOS_NOME_RESERVADO:%', v_name;
      end if;
      v_kind := 'inteira';

      v_raw := v_item ->> 'people_per_unit';
      if jsonb_typeof(v_item -> 'people_per_unit') is distinct from 'number'
        or v_raw !~ '^[0-9]{1,2}$' then
        raise exception 'TIPOS_PESSOAS: Pessoas por unidade inválido.';
      end if;
      v_people := v_raw::integer;
      if v_people not between 1 and 10 then
        raise exception 'TIPOS_PESSOAS: Pessoas por unidade inválido.';
      end if;
    end if;

    if lower(v_name) = any(v_names) then
      raise exception 'TIPOS_NOME_REPETIDO:%', v_name;
    end if;

    v_raw := v_item ->> 'price_cents';
    if jsonb_typeof(v_item -> 'price_cents') is distinct from 'number'
      or v_raw !~ '^[0-9]{1,9}$' then
      raise exception 'TIPOS_PRECO: Preço inválido.';
    end if;
    v_price := v_raw::integer;
    if v_price not between 1 and 10000000 then
      raise exception 'TIPOS_PRECO: Preço inválido.';
    end if;

    v_max := null;
    if v_item -> 'max_units' is not null and jsonb_typeof(v_item -> 'max_units') <> 'null' then
      v_raw := v_item ->> 'max_units';
      if jsonb_typeof(v_item -> 'max_units') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
        raise exception 'TIPOS_LIMITE: Limite inválido.';
      end if;
      v_max := v_raw::integer;
      if v_max not between 1 and 100000 then
        raise exception 'TIPOS_LIMITE: Limite inválido.';
      end if;
    end if;

    v_id := null;
    if v_preset is not null then
      -- O tipo pronto à venda; se não houver, o último que saiu da venda volta.
      select * into v_existing
      from public.ticket_types tt
      where tt.event_id = p_event_id and tt.preset = v_preset
      order by (tt.archived_at is null) desc, tt.archived_at desc nulls first
      limit 1
      for update;
      if found then
        v_id := v_existing.id;
      end if;
    elsif v_item -> 'id' is not null and jsonb_typeof(v_item -> 'id') <> 'null' then
      v_raw := v_item ->> 'id';
      if jsonb_typeof(v_item -> 'id') <> 'string'
        or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'TIPOS_INVALIDO: Tipo de ingresso inválido.';
      end if;
      v_id := v_raw::uuid;
      if v_id = any(v_keep_ids) then
        raise exception 'TIPOS_INVALIDO: Tipo de ingresso repetido.';
      end if;

      select * into v_existing
      from public.ticket_types tt
      where tt.id = v_id
        and tt.event_id = p_event_id
        and tt.archived_at is null
        and tt.preset is null
        and tt.kind <> 'cortesia'
      for update;
      if not found then
        raise exception 'TIPOS_DESATUALIZADO: Tipo não encontrado.';
      end if;

      -- O número de pessoas define quantos ingressos cada unidade gerou.
      if v_existing.people_per_unit <> v_people and exists (
        select 1 from public.order_items oi where oi.ticket_type_id = v_id
      ) then
        raise exception 'TIPOS_PESSOAS_COM_VENDAS:%', v_existing.name;
      end if;
      v_custom_keep_ids := v_custom_keep_ids || v_id;
    end if;

    if v_id is not null then
      if v_max is not null then
        v_taken := public.ticket_type_units_taken(v_id);
        if v_max < v_taken then
          raise exception 'TIPOS_LIMITE_MENOR:%:%', v_taken, v_name;
        end if;
      end if;
      v_keep_ids := v_keep_ids || v_id;
    end if;

    v_ids := v_ids || v_id;
    v_presets := v_presets || v_preset;
    v_names := v_names || lower(v_name);
    v_display_names := v_display_names || v_name;
    v_kinds := v_kinds || v_kind;
    v_prices := v_prices || v_price;
    v_peoples := v_peoples || v_people;
    v_maxes := v_maxes || v_max;
  end loop;

  update public.ticket_types tt
  set archived_at = now(),
      active = false
  where tt.event_id = p_event_id
    and tt.archived_at is null
    and tt.kind <> 'cortesia'
    and not (tt.id = any(v_keep_ids));

  -- Nome provisório antes de gravar os definitivos: permite trocar nomes entre
  -- tipos da equipe (A↔B) sem esbarrar no índice único de nome por evento.
  update public.ticket_types tt
  set name = '~' || tt.id::text
  where tt.id = any(v_custom_keep_ids);

  for i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    if v_ids[i] is not null then
      update public.ticket_types tt
      set name = v_display_names[i],
          price_cents = v_prices[i],
          people_per_unit = v_peoples[i],
          max_units = v_maxes[i],
          sort_order = i - 1,
          archived_at = null,
          active = true
      where tt.id = v_ids[i];
    else
      insert into public.ticket_types (
        event_id, kind, preset, name, price_cents, people_per_unit, max_units, sort_order, active
      ) values (
        p_event_id, v_kinds[i]::public.ticket_kind, v_presets[i], v_display_names[i],
        v_prices[i], v_peoples[i], v_maxes[i], i - 1, true
      );
    end if;
  end loop;

  if not exists (
    select 1 from public.ticket_types tt
    where tt.event_id = p_event_id and tt.kind = 'cortesia' and tt.archived_at is null
  ) then
    insert into public.ticket_types (
      event_id, kind, name, price_cents, people_per_unit, sort_order, active
    ) values (p_event_id, 'cortesia', 'Cortesia', 0, 1, 1000, true);
  end if;
end;
$$;

-- v3: sem os preços fixos de inteira/meia e com as cotas por categoria. Os tipos
-- são salvos na mesma transação (save_event_ticket_types), então evento, cotas e
-- tipos mudam juntos ou não mudam. Erros: COTA_INVALIDA, COTA_MENOR:<categoria>:<ocupado>.
drop function public.update_event_with_capacity(
  uuid, text, timestamptz, text, text, integer, text, integer, integer
);

create function public.update_event_with_capacity(
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
  v_taken bigint;
begin
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  if p_capacity < public.event_occupied_count(p_event_id) then
    raise exception 'A capacidade não pode ser menor que os ingressos já reservados.';
  end if;
  if (p_inteira_quota is not null and p_inteira_quota not between 1 and p_capacity)
    or (p_meia_quota is not null and p_meia_quota not between 1 and p_capacity)
    or coalesce(p_inteira_quota, 0) + coalesce(p_meia_quota, 0) > p_capacity then
    raise exception 'COTA_INVALIDA: As cotas precisam caber na lotação.';
  end if;
  if p_inteira_quota is not null then
    v_taken := public.event_kind_occupied_count(p_event_id, 'inteira');
    if p_inteira_quota < v_taken then
      raise exception 'COTA_MENOR:inteira:%', v_taken;
    end if;
  end if;
  if p_meia_quota is not null then
    v_taken := public.event_kind_occupied_count(p_event_id, 'meia');
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

-- 7) Pagamento v3: além da lotação, confere a cota da categoria e o limite de
-- cada tipo quando a reserva já tinha vencido (pedido expirado). Sem lugar →
-- aguardando decisão.
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
  v_event public.events%rowtype;
  v_ticket_count integer;
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

  select *
  into v_event
  from public.events
  where id = v_order.event_id
  for update;

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
        decision_reason = 'pago_apos_cancelamento',
        paid_at = coalesce(paid_at, now()),
        expires_at = null
    where id = v_order.id;
    return 'needs_decision_cancelled';
  end if;

  if v_order.status not in ('pendente', 'expirado') then
    return 'noop';
  end if;

  select count(*)::integer
  into v_ticket_count
  from public.tickets
  where order_id = v_order.id and status = 'nao_pago';

  if public.event_occupied_count(v_order.event_id, v_order.id)
       + v_ticket_count > v_event.capacity
    or exists (
      select 1
      from public.order_items oi
      join public.ticket_types tt on tt.id = oi.ticket_type_id
      where oi.order_id = v_order.id
        and tt.max_units is not null
        and public.ticket_type_units_taken(tt.id, v_order.id) + oi.quantity > tt.max_units
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
          when 'inteira' then v_event.inteira_quota
          when 'meia' then v_event.meia_quota
        end as quota
      ) q
      where q.quota is not null
        and public.event_kind_occupied_count(v_order.event_id, k.kind, v_order.id) + k.people > q.quota
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

-- 8) Permissões --------------------------------------------------------------

revoke all on function public.ticket_type_units_taken(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.event_kind_occupied_count(uuid, public.ticket_kind, uuid)
  from public, anon, authenticated;
revoke all on function public.event_availability(uuid)
  from public, anon, authenticated;
revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.issue_courtesy_ticket(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.save_event_ticket_types(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, jsonb, integer, integer)
  from public, anon, authenticated;
revoke all on function public.mark_order_paid_by_external(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.ticket_type_units_taken(uuid, uuid)
  to service_role;
grant execute on function public.event_kind_occupied_count(uuid, public.ticket_kind, uuid)
  to service_role;
grant execute on function public.event_availability(uuid)
  to service_role;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text)
  to service_role;
grant execute on function public.issue_courtesy_ticket(uuid, text, text, text)
  to service_role;
grant execute on function public.save_event_ticket_types(uuid, jsonb)
  to service_role;
grant execute on function public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, jsonb, integer, integer)
  to service_role;
grant execute on function public.mark_order_paid_by_external(text, text, text, text)
  to service_role;
