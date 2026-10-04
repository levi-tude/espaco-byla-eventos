-- Sessões, fase 3 (spec 2026-10-03-sessoes-design, seções 6.5, 9.1 e 9.4.1): a
-- equipe cria e edita as sessões do evento, com preço, "à venda" e limite de cada
-- tipo por sessão, e encerra a venda de cada sessão.
--
-- Migration ADITIVA: aplicar DEPOIS de 20261011100000 e 20261011110000 e ANTES do
-- deploy do código da fase 3. O código anterior continua funcionando:
--   * os gatilhos de espelho da sessão única continuam valendo para o formulário
--     antigo; o editor novo os desliga só dentro da própria transação;
--   * update_event_with_capacity e save_event_ticket_types não mudam.

-- 1) Registro das mudanças de horário (o e-mail de aviso é a fase 5) ---------------

-- Uma linha por mudança de início/término de sessão com pedidos pagos. Guarda só
-- horários e contagem (nada do comprador). Nunca editada nem apagada pela equipe.
create table public.session_schedule_changes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.event_sessions (id) on delete cascade,
  previous_starts_at timestamptz not null,
  previous_ends_at timestamptz,
  new_starts_at timestamptz not null,
  new_ends_at timestamptz,
  paid_orders integer not null,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint session_schedule_changes_paid_orders_check check (paid_orders >= 1)
);

create index session_schedule_changes_session_idx
  on public.session_schedule_changes (session_id, created_at desc);

alter table public.session_schedule_changes enable row level security;
revoke all on table public.session_schedule_changes from public, anon, authenticated;
grant select on table public.session_schedule_changes to authenticated;
grant select, insert on table public.session_schedule_changes to service_role;

create policy session_schedule_changes_staff_read on public.session_schedule_changes
  for select to authenticated using (public.is_staff());

-- 2) Gatilhos de espelho: desligados enquanto o editor de sessões grava ------------

-- O editor grava sessões, preços e o resumo do evento diretamente; os gatilhos da
-- sessão única (código anterior) não podem sobrescrever o que ele acabou de gravar.
-- A chave vale só dentro da transação (set_config local).
create function public.session_editor_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('byla.session_editor', true), '') = 'on';
$$;

create or replace function public.events_create_single_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.session_editor_active() then
    return null;
  end if;
  insert into public.event_sessions (event_id, starts_at, capacity, inteira_quota, meia_quota)
  values (new.id, new.starts_at, new.capacity, new.inteira_quota, new.meia_quota);
  return null;
end;
$$;

create or replace function public.events_sync_single_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if public.session_editor_active() then
    return null;
  end if;
  v_session_id := public.event_single_session_id(new.id);
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

create or replace function public.ticket_types_sync_single_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if public.session_editor_active() then
    return null;
  end if;
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

-- 3) Sessão com vendas que impedem a remoção ---------------------------------------

-- Pago (inclui cortesia válida), aguardando decisão, reserva ativa ou estorno em
-- andamento. Sessão assim só pode ser cancelada (fase 6), nunca removida.
create function public.session_has_live_orders(p_session_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.session_id = p_session_id
      and (
        o.status in ('pago', 'aguardando_decisao')
        or (o.status = 'pendente' and o.expires_at > now())
      )
  ) or public.session_occupied_count(p_session_id) > 0;
$$;

-- 4) Gravar as sessões do evento --------------------------------------------------

-- Chamada por save_event_with_sessions, na mesma transação que grava o evento e os
-- tipos (os tipos já estão salvos, na ordem da lista: "type_index" = posição).
-- p_sessions = sessões ativas na ordem da tela (1 a 20):
--   { "id": uuid | null, "name": text | null, "starts_at": timestamptz,
--     "ends_at": timestamptz | null, "capacity": int, "inteira_quota": int | null,
--     "meia_quota": int | null,
--     "prices": [{ "type_index": int, "price_cents": int | null,
--                  "max_units": int | null, "on_sale": bool }] }
-- Sessão ativa omitida: com vendas → SESSAO_COM_VENDAS:<id>; com pedidos só
-- vencidos/cancelados → arquivada; sem nenhum pedido → apagada. Sessão cancelada
-- não entra na lista e não muda. Erros com a posição (1..N) da sessão na lista:
-- SESSAO_INVALIDA:<pos>, SESSAO_HORARIO_REPETIDO:<pos>, SESSAO_CANCELADA:<pos>,
-- SESSAO_PRECO:<pos>, SESSAO_SEM_TIPO:<pos>, SESSAO_LOTACAO_MENOR:<pos>:<ocupado>,
-- SESSAO_COTA_MENOR:<pos>:<categoria>:<ocupado>, SESSAO_LIMITE_MENOR:<pos>:<ocupado>:<tipo>.
create function public.save_event_sessions(
  p_event_id uuid,
  p_sessions jsonb,
  p_staff_user_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_type_ids uuid[];
  v_type_names text[];
  v_type_count integer;
  v_item jsonb;
  v_price jsonb;
  v_raw text;
  v_pos integer := 0;
  v_ids uuid[] := '{}';
  v_prev_starts timestamptz[] := '{}';
  v_prev_ends timestamptz[] := '{}';
  v_names text[] := '{}';
  v_starts timestamptz[] := '{}';
  v_ends timestamptz[] := '{}';
  v_capacities integer[] := '{}';
  v_inteiras integer[] := '{}';
  v_meias integer[] := '{}';
  v_id uuid;
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_capacity integer;
  v_inteira integer;
  v_meia integer;
  v_existing public.event_sessions%rowtype;
  v_session public.event_sessions%rowtype;
  v_taken bigint;
  v_paid integer;
  v_type_index integer;
  v_type_id uuid;
  v_price_cents integer;
  v_max integer;
  v_on_sale boolean;
  v_seen_types uuid[];
  v_on_sale_count integer;
  i integer;
begin
  if p_staff_user_id is null
    or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id) then
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'SESSAO_EVENTO: Evento não encontrado.';
  end if;
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array'
    or jsonb_array_length(p_sessions) not between 1 and 20 then
    raise exception 'SESSAO_QUANTIDADE: Cadastre de 1 a 20 sessões.';
  end if;

  -- Trava todas as sessões do evento (ordem fixa: evento → sessões por id).
  perform 1 from public.event_sessions s where s.event_id = p_event_id order by s.id for update;

  select coalesce(array_agg(tt.id order by tt.sort_order, tt.id), '{}'),
         coalesce(array_agg(tt.name order by tt.sort_order, tt.id), '{}')
  into v_type_ids, v_type_names
  from public.ticket_types tt
  where tt.event_id = p_event_id and tt.archived_at is null and tt.kind <> 'cortesia';
  v_type_count := coalesce(array_length(v_type_ids, 1), 0);

  -- 4.1) Leitura e validação de formato de cada sessão.
  for v_item in select e.item from jsonb_array_elements(p_sessions) as e(item) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;

    v_id := null;
    if v_item -> 'id' is not null and jsonb_typeof(v_item -> 'id') <> 'null' then
      v_raw := v_item ->> 'id';
      if jsonb_typeof(v_item -> 'id') <> 'string'
        or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_id := v_raw::uuid;
      if v_id = any(v_ids) then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      select * into v_existing
      from public.event_sessions s
      where s.id = v_id and s.event_id = p_event_id and s.archived_at is null;
      if not found then
        raise exception 'SESSAO_DESATUALIZADA: Sessão não encontrada.';
      end if;
      if v_existing.status <> 'ativa' then
        raise exception 'SESSAO_CANCELADA:%', v_pos;
      end if;
    end if;

    v_name := null;
    if v_item -> 'name' is not null and jsonb_typeof(v_item -> 'name') <> 'null' then
      if jsonb_typeof(v_item -> 'name') <> 'string' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_name := nullif(btrim(v_item ->> 'name'), '');
      if v_name is not null and char_length(v_name) > 60 then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
    end if;

    if jsonb_typeof(v_item -> 'starts_at') is distinct from 'string' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    begin
      v_start := (v_item ->> 'starts_at')::timestamptz;
      v_end := null;
      if v_item -> 'ends_at' is not null and jsonb_typeof(v_item -> 'ends_at') <> 'null' then
        if jsonb_typeof(v_item -> 'ends_at') <> 'string' then
          raise exception 'SESSAO_INVALIDA:%', v_pos;
        end if;
        v_end := (v_item ->> 'ends_at')::timestamptz;
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end;
    if v_end is not null and v_end <= v_start then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    if v_start = any(v_starts) or exists (
      select 1 from public.event_sessions s
      where s.event_id = p_event_id
        and s.archived_at is null
        and s.status <> 'ativa'
        and s.starts_at = v_start
    ) then
      raise exception 'SESSAO_HORARIO_REPETIDO:%', v_pos;
    end if;

    v_raw := v_item ->> 'capacity';
    if jsonb_typeof(v_item -> 'capacity') is distinct from 'number' or v_raw !~ '^[0-9]{1,6}$' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    v_capacity := v_raw::integer;
    if v_capacity not between 1 and 100000 then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;

    v_inteira := null;
    if v_item -> 'inteira_quota' is not null and jsonb_typeof(v_item -> 'inteira_quota') <> 'null' then
      v_raw := v_item ->> 'inteira_quota';
      if jsonb_typeof(v_item -> 'inteira_quota') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_inteira := v_raw::integer;
    end if;
    v_meia := null;
    if v_item -> 'meia_quota' is not null and jsonb_typeof(v_item -> 'meia_quota') <> 'null' then
      v_raw := v_item ->> 'meia_quota';
      if jsonb_typeof(v_item -> 'meia_quota') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_meia := v_raw::integer;
    end if;
    if (v_inteira is not null and v_inteira not between 1 and v_capacity)
      or (v_meia is not null and v_meia not between 1 and v_capacity)
      or coalesce(v_inteira, 0) + coalesce(v_meia, 0) > v_capacity then
      raise exception 'SESSAO_COTA_INVALIDA:%', v_pos;
    end if;

    if v_id is not null then
      v_taken := public.session_occupied_count(v_id);
      if v_capacity < v_taken then
        raise exception 'SESSAO_LOTACAO_MENOR:%:%', v_pos, v_taken;
      end if;
      if v_inteira is not null then
        v_taken := public.session_kind_occupied_count(v_id, 'inteira');
        if v_inteira < v_taken then
          raise exception 'SESSAO_COTA_MENOR:%:inteira:%', v_pos, v_taken;
        end if;
      end if;
      if v_meia is not null then
        v_taken := public.session_kind_occupied_count(v_id, 'meia');
        if v_meia < v_taken then
          raise exception 'SESSAO_COTA_MENOR:%:meia:%', v_pos, v_taken;
        end if;
      end if;
    end if;

    -- Preços: um item por tipo, no máximo; tipo à venda exige preço.
    if jsonb_typeof(v_item -> 'prices') is distinct from 'array' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    v_seen_types := '{}';
    v_on_sale_count := 0;
    for v_price in select e.item from jsonb_array_elements(v_item -> 'prices') as e(item) loop
      if jsonb_typeof(v_price) <> 'object' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_raw := v_price ->> 'type_index';
      if jsonb_typeof(v_price -> 'type_index') is distinct from 'number' or v_raw !~ '^[0-9]{1,2}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_type_index := v_raw::integer;
      if v_type_index >= v_type_count then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_type_id := v_type_ids[v_type_index + 1];
      if v_type_id = any(v_seen_types) then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_seen_types := v_seen_types || v_type_id;

      if jsonb_typeof(v_price -> 'on_sale') is distinct from 'boolean' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_on_sale := (v_price ->> 'on_sale')::boolean;

      v_price_cents := null;
      if v_price -> 'price_cents' is not null and jsonb_typeof(v_price -> 'price_cents') <> 'null' then
        v_raw := v_price ->> 'price_cents';
        if jsonb_typeof(v_price -> 'price_cents') <> 'number' or v_raw !~ '^[0-9]{1,9}$' then
          raise exception 'SESSAO_PRECO:%', v_pos;
        end if;
        v_price_cents := v_raw::integer;
        if v_price_cents not between 1 and 10000000 then
          raise exception 'SESSAO_PRECO:%', v_pos;
        end if;
      end if;
      if v_on_sale and v_price_cents is null then
        raise exception 'SESSAO_PRECO:%', v_pos;
      end if;

      v_max := null;
      if v_price -> 'max_units' is not null and jsonb_typeof(v_price -> 'max_units') <> 'null' then
        v_raw := v_price ->> 'max_units';
        if jsonb_typeof(v_price -> 'max_units') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
          raise exception 'SESSAO_INVALIDA:%', v_pos;
        end if;
        v_max := v_raw::integer;
        if v_max not between 1 and 100000 then
          raise exception 'SESSAO_INVALIDA:%', v_pos;
        end if;
        if v_id is not null then
          v_taken := public.session_type_units_taken(v_id, v_type_id);
          if v_max < v_taken then
            raise exception 'SESSAO_LIMITE_MENOR:%:%:%', v_pos, v_taken, v_type_names[v_type_index + 1];
          end if;
        end if;
      end if;

      if v_on_sale then
        v_on_sale_count := v_on_sale_count + 1;
      end if;
    end loop;
    if v_on_sale_count = 0 then
      raise exception 'SESSAO_SEM_TIPO:%', v_pos;
    end if;

    v_ids := v_ids || v_id;
    v_prev_starts := v_prev_starts || case when v_id is null then null else v_existing.starts_at end;
    v_prev_ends := v_prev_ends || case when v_id is null then null else v_existing.ends_at end;
    v_names := v_names || v_name;
    v_starts := v_starts || v_start;
    v_ends := v_ends || v_end;
    v_capacities := v_capacities || v_capacity;
    v_inteiras := v_inteiras || v_inteira;
    v_meias := v_meias || v_meia;
  end loop;

  -- 4.2) Sessões ativas que saíram da lista: apagar, arquivar ou recusar.
  for v_session in
    select * from public.event_sessions s
    where s.event_id = p_event_id
      and s.archived_at is null
      and s.status = 'ativa'
      and not (s.id = any(array_remove(v_ids, null)))
    order by s.id
  loop
    if public.session_has_live_orders(v_session.id) then
      raise exception 'SESSAO_COM_VENDAS:%', v_session.id;
    elsif exists (select 1 from public.orders o where o.session_id = v_session.id) then
      update public.event_sessions s
      set archived_at = now(), sales_open = false, updated_at = now()
      where s.id = v_session.id;
    else
      delete from public.event_sessions s where s.id = v_session.id;
    end if;
  end loop;

  -- 4.3) Horário provisório nas sessões mantidas: permite trocar horários entre
  -- sessões (19h ↔ 20h30) sem esbarrar no índice único de horário por evento.
  update public.event_sessions s
  set starts_at = timestamptz '1900-01-01 00:00:00+00' + make_interval(mins => x.n),
      ends_at = null
  from (
    select u.id, row_number() over (order by u.id)::integer as n
    from unnest(array_remove(v_ids, null)) as u(id)
  ) x
  where s.id = x.id;

  -- 4.4) Grava cada sessão e os seus preços.
  v_pos := 0;
  for v_item in select e.item from jsonb_array_elements(p_sessions) as e(item) loop
    v_pos := v_pos + 1;
    v_id := v_ids[v_pos];

    if v_id is null then
      insert into public.event_sessions (
        event_id, name, starts_at, ends_at, capacity, inteira_quota, meia_quota
      ) values (
        p_event_id, v_names[v_pos], v_starts[v_pos], v_ends[v_pos],
        v_capacities[v_pos], v_inteiras[v_pos], v_meias[v_pos]
      )
      returning id into v_id;
    else
      -- Mudou o horário de sessão com pedidos pagos: registro para o aviso (fase 5).
      if (v_prev_starts[v_pos], v_prev_ends[v_pos]) is distinct from (v_starts[v_pos], v_ends[v_pos]) then
        select count(*)::integer into v_paid
        from public.orders o
        where o.session_id = v_id
          and o.status = 'pago'
          and exists (
            select 1 from public.tickets t
            where t.order_id = o.id and t.status in ('pago', 'check_in')
          );
        if v_paid > 0 then
          insert into public.session_schedule_changes (
            session_id, previous_starts_at, previous_ends_at, new_starts_at, new_ends_at,
            paid_orders, changed_by
          ) values (
            v_id, v_prev_starts[v_pos], v_prev_ends[v_pos], v_starts[v_pos], v_ends[v_pos],
            v_paid, p_staff_user_id
          );
        end if;
      end if;

      update public.event_sessions s
      set name = v_names[v_pos],
          starts_at = v_starts[v_pos],
          ends_at = v_ends[v_pos],
          capacity = v_capacities[v_pos],
          inteira_quota = v_inteiras[v_pos],
          meia_quota = v_meias[v_pos],
          updated_at = now()
      where s.id = v_id;
    end if;

    for v_price in select e.item from jsonb_array_elements(v_item -> 'prices') as e(item) loop
      v_type_id := v_type_ids[(v_price ->> 'type_index')::integer + 1];
      v_on_sale := (v_price ->> 'on_sale')::boolean;
      v_price_cents := nullif(v_price ->> 'price_cents', '')::integer;
      v_max := nullif(v_price ->> 'max_units', '')::integer;
      if v_price_cents is null then
        -- Fora da venda e sem preço: a linha antiga (se houver) só sai da venda.
        update public.session_ticket_types stt
        set on_sale = false, max_units = v_max, updated_at = now()
        where stt.session_id = v_id and stt.ticket_type_id = v_type_id;
      else
        insert into public.session_ticket_types as stt (
          session_id, ticket_type_id, price_cents, max_units, on_sale
        ) values (v_id, v_type_id, v_price_cents, v_max, v_on_sale)
        on conflict (session_id, ticket_type_id) do update
          set price_cents = excluded.price_cents,
              max_units = excluded.max_units,
              on_sale = excluded.on_sale,
              updated_at = now();
      end if;
    end loop;

    -- Tipo do evento que não veio na lista desta sessão: fora da venda nela.
    update public.session_ticket_types stt
    set on_sale = false, updated_at = now()
    where stt.session_id = v_id
      and stt.on_sale
      and stt.ticket_type_id = any(v_type_ids)
      and not exists (
        select 1 from jsonb_array_elements(v_item -> 'prices') as e(item)
        where v_type_ids[(e.item ->> 'type_index')::integer + 1] = stt.ticket_type_id
      );
  end loop;
end;
$$;

-- 5) Formulário do evento com sessões ---------------------------------------------

-- Evento, tipos e sessões mudam juntos ou não mudam. Os tipos vão no formato de
-- save_event_ticket_types (o preço/limite do tipo é só espelho para o código
-- anterior; quem vale é o da sessão). O resumo do evento (início, lotação e cotas)
-- passa a ser o da primeira sessão ativa.
create function public.save_event_with_sessions(
  p_event_id uuid,
  p_name text,
  p_venue text,
  p_description text,
  p_cover_image_url text,
  p_ticket_types jsonb,
  p_sessions jsonb,
  p_staff_user_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_first public.event_sessions%rowtype;
begin
  if p_staff_user_id is null
    or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id) then
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'SESSAO_EVENTO: Evento não encontrado.';
  end if;

  perform set_config('byla.session_editor', 'on', true);

  perform public.save_event_ticket_types(p_event_id, p_ticket_types);
  perform public.save_event_sessions(p_event_id, p_sessions, p_staff_user_id);

  select * into v_first
  from public.event_sessions s
  where s.event_id = p_event_id and s.archived_at is null and s.status = 'ativa'
  order by s.starts_at, s.id
  limit 1;

  update public.events e
  set name = p_name,
      venue = p_venue,
      description = p_description,
      cover_image_url = p_cover_image_url,
      starts_at = v_first.starts_at,
      capacity = v_first.capacity,
      inteira_quota = v_first.inteira_quota,
      meia_quota = v_first.meia_quota,
      updated_at = now()
  where e.id = p_event_id;

  perform set_config('byla.session_editor', '', true);
end;
$$;

-- 6) Encerrar / reabrir a venda de uma sessão -------------------------------------

-- Reabrir depois do horário não faz voltar a vender (session_is_selling manda).
-- Trava na ordem evento → sessão. Devolve o novo valor.
create function public.set_session_sales_open(
  p_session_id uuid,
  p_open boolean,
  p_staff_user_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_session public.event_sessions%rowtype;
begin
  if p_staff_user_id is null
    or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id) then
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  if p_open is null then
    raise exception 'SESSAO_INVALIDA: Valor inválido.';
  end if;
  select s.event_id into v_event_id from public.event_sessions s where s.id = p_session_id;
  if v_event_id is null then
    raise exception 'SESSAO_INDISPONIVEL: Sessão não encontrada.';
  end if;
  perform 1 from public.events e where e.id = v_event_id for share;
  select * into v_session from public.event_sessions s where s.id = p_session_id for update;
  if v_session.archived_at is not null or v_session.status <> 'ativa' then
    raise exception 'SESSAO_INDISPONIVEL: Sessão não encontrada.';
  end if;
  update public.event_sessions s
  set sales_open = p_open, updated_at = now()
  where s.id = p_session_id and s.sales_open is distinct from p_open;
  return p_open;
end;
$$;

-- 7) Permissões ---------------------------------------------------------------------

revoke all on function public.session_editor_active() from public, anon, authenticated;
revoke all on function public.session_has_live_orders(uuid) from public, anon, authenticated;
revoke all on function public.save_event_sessions(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.save_event_with_sessions(uuid, text, text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.set_session_sales_open(uuid, boolean, uuid) from public, anon, authenticated;

grant execute on function public.session_editor_active() to service_role;
grant execute on function public.session_has_live_orders(uuid) to service_role;
grant execute on function public.save_event_sessions(uuid, jsonb, uuid) to service_role;
grant execute on function public.save_event_with_sessions(uuid, text, text, text, text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.set_session_sales_open(uuid, boolean, uuid) to service_role;
