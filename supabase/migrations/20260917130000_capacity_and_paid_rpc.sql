alter table public.orders
  add column expires_at timestamptz;

update public.orders
set expires_at = created_at + interval '30 minutes'
where status = 'pendente' and expires_at is null;

create index orders_active_holds_idx
  on public.orders (event_id, expires_at)
  where status = 'pendente';

create or replace function public.event_occupied_count(
  p_event_id uuid,
  p_exclude_order_id uuid default null
)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from public.tickets t
  join public.orders o on o.id = t.order_id
  where t.event_id = p_event_id
    and (p_exclude_order_id is null or t.order_id <> p_exclude_order_id)
    and (
      t.status in ('pago', 'check_in')
      or (
        t.status = 'nao_pago'
        and o.status = 'pendente'
        and o.expires_at > now()
      )
    );
$$;

create or replace function public.create_checkout_order(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_payment_provider text,
  p_public_token text,
  p_items jsonb
)
returns table (
  order_id uuid,
  total_cents integer,
  expires_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_quantity integer;
  v_total_cents integer;
  v_expires_at timestamptz := now() + interval '30 minutes';
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  if not v_event.sales_open then
    raise exception 'As vendas deste evento estão fechadas.';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Selecione quantidades válidas de ingressos.';
  end if;
  if nullif(btrim(p_buyer_name), '') is null
    or nullif(btrim(p_buyer_email), '') is null then
    raise exception 'Preencha nome e e-mail para continuar.';
  end if;

  with requested as (
    select item.kind, sum(item.qty)::integer as qty
    from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
    group by item.kind
  )
  select coalesce(sum(requested.qty), 0)::integer,
         coalesce(sum(requested.qty * tt.price_cents), 0)::integer
  into v_quantity, v_total_cents
  from requested
  join public.ticket_types tt
    on tt.event_id = p_event_id
   and tt.kind = requested.kind
   and tt.active
  where requested.kind in ('inteira', 'meia')
    and requested.qty > 0;

  if v_quantity < 1 or v_quantity > 10 then
    raise exception 'Selecione de 1 a 10 ingressos por pedido.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
    where item.kind not in ('inteira', 'meia') or item.qty <= 0
  ) then
    raise exception 'Um dos tipos de ingresso selecionados está indisponível.';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
  ) <> (
    select count(*)
    from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
    join public.ticket_types tt
      on tt.event_id = p_event_id
     and tt.kind = item.kind
     and tt.active
  ) then
    raise exception 'Um dos tipos de ingresso selecionados está indisponível.';
  end if;

  if public.event_occupied_count(p_event_id) + v_quantity > v_event.capacity then
    raise exception 'Capacidade esgotada para este evento.';
  end if;

  insert into public.orders (
    id,
    event_id,
    buyer_name,
    buyer_email,
    buyer_phone,
    total_cents,
    status,
    public_token,
    payment_provider,
    payment_external_id,
    expires_at
  ) values (
    v_order_id,
    p_event_id,
    btrim(p_buyer_name),
    lower(btrim(p_buyer_email)),
    nullif(btrim(p_buyer_phone), ''),
    v_total_cents,
    'pendente',
    p_public_token,
    p_payment_provider,
    v_order_id::text,
    v_expires_at
  );

  insert into public.tickets (
    order_id,
    event_id,
    ticket_type_id,
    kind,
    status,
    code,
    buyer_name,
    price_cents
  )
  select
    v_order_id,
    p_event_id,
    tt.id,
    tt.kind,
    'nao_pago',
    gen_random_uuid()::text,
    btrim(p_buyer_name),
    tt.price_cents
  from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
  join public.ticket_types tt
    on tt.event_id = p_event_id
   and tt.kind = item.kind
   and tt.active
  cross join lateral generate_series(1, item.qty);

  return query select v_order_id, v_total_cents, v_expires_at;
end;
$$;

create or replace function public.issue_courtesy_ticket(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_public_token text
)
returns table (order_id uuid, ticket_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_ticket_type_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_ticket_id uuid := gen_random_uuid();
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  if nullif(btrim(p_buyer_name), '') is null
    or nullif(btrim(p_buyer_email), '') is null then
    raise exception 'Preencha nome e e-mail válidos.';
  end if;

  select id
  into v_ticket_type_id
  from public.ticket_types
  where event_id = p_event_id and kind = 'cortesia' and active;

  if v_ticket_type_id is null then
    raise exception 'Cortesia indisponível para este evento.';
  end if;
  if public.event_occupied_count(p_event_id) + 1 > v_event.capacity then
    raise exception 'Capacidade esgotada para este evento.';
  end if;

  insert into public.orders (
    id,
    event_id,
    buyer_name,
    buyer_email,
    total_cents,
    status,
    public_token,
    payment_provider,
    paid_at
  ) values (
    v_order_id,
    p_event_id,
    btrim(p_buyer_name),
    lower(btrim(p_buyer_email)),
    0,
    'pago',
    p_public_token,
    'cortesia_interna',
    now()
  );

  insert into public.tickets (
    id,
    order_id,
    event_id,
    ticket_type_id,
    kind,
    status,
    code,
    buyer_name,
    price_cents
  ) values (
    v_ticket_id,
    v_order_id,
    p_event_id,
    v_ticket_type_id,
    'cortesia',
    'pago',
    gen_random_uuid()::text,
    btrim(p_buyer_name),
    0
  );

  return query select v_order_id, v_ticket_id;
end;
$$;

create or replace function public.mark_order_paid_by_external(
  p_provider text,
  p_external_id text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event public.events%rowtype;
  v_ticket_count integer;
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

  if v_order.status <> 'pendente' then
    return 'noop';
  end if;

  select count(*)::integer
  into v_ticket_count
  from public.tickets
  where order_id = v_order.id and status = 'nao_pago';

  if public.event_occupied_count(v_order.event_id, v_order.id)
       + v_ticket_count > v_event.capacity then
    update public.orders
    set status = 'cancelado'
    where id = v_order.id;

    update public.tickets
    set status = 'cancelado', cancelled_at = now()
    where order_id = v_order.id and status = 'nao_pago';

    return 'cancelled_capacity';
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

create or replace function public.cancel_order_by_external(
  p_provider text,
  p_external_id text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
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

  if not found or v_order.status <> 'pendente' then
    return 'noop';
  end if;

  update public.orders
  set status = 'cancelado', expires_at = null
  where id = v_order.id;

  update public.tickets
  set status = 'cancelado', cancelled_at = now()
  where order_id = v_order.id and status = 'nao_pago';

  return 'updated';
end;
$$;

create or replace function public.update_event_with_capacity(
  p_event_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_venue text,
  p_description text,
  p_capacity integer,
  p_cover_image_url text,
  p_full_price_cents integer,
  p_half_price_cents integer
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_event public.events%rowtype;
begin
  select *
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.';
  end if;
  if p_capacity < public.event_occupied_count(p_event_id) then
    raise exception 'A capacidade não pode ser menor que os ingressos já reservados.';
  end if;

  update public.events
  set name = p_name,
      starts_at = p_starts_at,
      venue = p_venue,
      description = p_description,
      capacity = p_capacity,
      cover_image_url = p_cover_image_url,
      updated_at = now()
  where id = p_event_id;

  insert into public.ticket_types (event_id, kind, price_cents, active)
  values
    (p_event_id, 'inteira', p_full_price_cents, true),
    (p_event_id, 'meia', p_half_price_cents, true),
    (p_event_id, 'cortesia', 0, true)
  on conflict (event_id, kind)
  do update set price_cents = excluded.price_cents, active = true;
end;
$$;

revoke all on function public.event_occupied_count(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.issue_courtesy_ticket(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_order_paid_by_external(text, text) from public, anon, authenticated;
revoke all on function public.cancel_order_by_external(text, text) from public, anon, authenticated;
revoke all on function public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, integer, integer) from public, anon, authenticated;

grant execute on function public.event_occupied_count(uuid, uuid) to service_role;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.issue_courtesy_ticket(uuid, text, text, text) to service_role;
grant execute on function public.mark_order_paid_by_external(text, text) to service_role;
grant execute on function public.cancel_order_by_external(text, text) to service_role;
grant execute on function public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, integer, integer) to service_role;
