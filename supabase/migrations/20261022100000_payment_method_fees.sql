-- Taxa por forma de pagamento ("4% off no Pix").
--
-- ADITIVA: colunas novas com default; per_method_enabled = false → cobrança idêntica
-- à atual (usa rate_bps). NÃO altera rate_bps nem liga a flag. Defaults de
-- card_rate_bps/pix_rate_bps documentam a meta (1000/556) para quando o dono ligar.

-- 1) Configuração -----------------------------------------------------------------

alter table public.service_fee_settings
  add column if not exists card_rate_bps integer not null default 1000
    check (card_rate_bps between 0 and 2000),
  add column if not exists pix_rate_bps integer not null default 556
    check (pix_rate_bps between 0 and 2000),
  add column if not exists per_method_enabled boolean not null default false;

alter table public.service_fee_settings
  drop constraint if exists service_fee_settings_pix_le_card;

alter table public.service_fee_settings
  add constraint service_fee_settings_pix_le_card
    check (pix_rate_bps <= card_rate_bps);

-- Retorno muda de 3 para 6 colunas: CREATE OR REPLACE não troca o tipo OUT.
drop function if exists public.service_fee_policy();

create or replace function public.service_fee_policy()
returns table (
  enabled boolean,
  rate_bps integer,
  min_cents integer,
  card_rate_bps integer,
  pix_rate_bps integer,
  per_method_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.enabled,
    s.rate_bps,
    s.min_cents,
    s.card_rate_bps,
    s.pix_rate_bps,
    s.per_method_enabled
  from public.service_fee_settings s
  where s.id = 1;
$$;

revoke all on function public.service_fee_policy() from public, anon, authenticated;
grant execute on function public.service_fee_policy() to service_role;

-- 2) Pedido: método + snapshots das duas taxas ------------------------------------

alter table public.orders
  add column if not exists payment_method text,
  add column if not exists fee_priced_at timestamptz,
  add column if not exists card_rate_bps_snapshot integer,
  add column if not exists pix_rate_bps_snapshot integer;

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
    check (payment_method is null or payment_method in ('pix', 'card'));

alter table public.orders
  drop constraint if exists orders_fee_snapshots_check;

alter table public.orders
  add constraint orders_fee_snapshots_check
    check (
      (card_rate_bps_snapshot is null) = (pix_rate_bps_snapshot is null)
      and (card_rate_bps_snapshot is null or card_rate_bps_snapshot between 0 and 2000)
      and (pix_rate_bps_snapshot is null or pix_rate_bps_snapshot between 0 and 2000)
      and (
        card_rate_bps_snapshot is null
        or pix_rate_bps_snapshot <= card_rate_bps_snapshot
      )
    );

-- Pedidos já existentes: snapshots = taxa gravada (comportamento de taxa única).
update public.orders
set
  card_rate_bps_snapshot = coalesce(card_rate_bps_snapshot, service_fee_rate_bps),
  pix_rate_bps_snapshot = coalesce(pix_rate_bps_snapshot, service_fee_rate_bps),
  fee_priced_at = coalesce(fee_priced_at, created_at)
where card_rate_bps_snapshot is null or pix_rate_bps_snapshot is null;

-- 3) Imutabilidade: só a RPC de reprecificação pode mudar valores de taxa ----------

create or replace function public.orders_fee_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_fee_reprice', true) = '1' then
    return new;
  end if;
  if new.total_cents is distinct from old.total_cents
    or new.tickets_subtotal_cents is distinct from old.tickets_subtotal_cents
    or new.service_fee_cents is distinct from old.service_fee_cents
    or new.service_fee_rate_bps is distinct from old.service_fee_rate_bps
    or new.service_fee_min_cents is distinct from old.service_fee_min_cents
    or new.payment_method is distinct from old.payment_method
    or new.fee_priced_at is distinct from old.fee_priced_at
    or new.card_rate_bps_snapshot is distinct from old.card_rate_bps_snapshot
    or new.pix_rate_bps_snapshot is distinct from old.pix_rate_bps_snapshot then
    raise exception 'TAXA_IMUTAVEL: Valores do pedido não podem ser alterados.';
  end if;
  return new;
end;
$$;

-- 4) Checkout: grava snapshots; com flag ligada precifica como cartão --------------

create or replace function public.create_checkout_order(
  p_event_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone text,
  p_payment_provider text,
  p_public_token text,
  p_items jsonb,
  p_privacy_policy_version text default null,
  p_session_id uuid default null,
  p_expected_fee_rate_bps integer default null,
  p_expected_fee_min_cents integer default null,
  p_terms_version text default null
)
returns table (
  order_id uuid,
  total_cents integer,
  expires_at timestamptz,
  service_fee_cents integer
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
  v_terms_version text := nullif(btrim(p_terms_version), '');
  v_item jsonb;
  v_qty integer;
  v_type_id uuid;
  v_type_ids uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_people integer;
  v_total_cents integer;
  v_fee_cents integer;
  v_fee_rate integer := 0;
  v_fee_min integer := 0;
  v_card_snap integer := 0;
  v_pix_snap integer := 0;
  v_fee_unit integer;
  v_occupied bigint;
  v_taken bigint;
  v_quota integer;
  v_line record;
  v_item_id uuid;
  v_ticket_count integer;
  v_line_total integer;
  v_base integer;
  v_settings public.service_fee_settings%rowtype;
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

  select * into v_settings from public.service_fee_settings s where s.id = 1;
  if found and v_settings.enabled then
    v_fee_min := v_settings.min_cents;
    if v_settings.per_method_enabled then
      v_fee_rate := v_settings.card_rate_bps;
      v_card_snap := v_settings.card_rate_bps;
      v_pix_snap := v_settings.pix_rate_bps;
    else
      -- Flag desligada: taxa única (= rate_bps); snapshots iguais evitam reprecificação.
      v_fee_rate := v_settings.rate_bps;
      v_card_snap := v_settings.rate_bps;
      v_pix_snap := v_settings.rate_bps;
    end if;
  else
    v_fee_rate := 0;
    v_fee_min := 0;
    v_card_snap := 0;
    v_pix_snap := 0;
  end if;

  if p_expected_fee_rate_bps is not null
    and (p_expected_fee_rate_bps <> v_fee_rate
      or coalesce(p_expected_fee_min_cents, v_fee_min) <> v_fee_min) then
    raise exception 'TAXA_MUDOU: Os valores foram atualizados.';
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
         coalesce(sum(r.qty * stt.price_cents), 0)::integer,
         coalesce(sum(r.qty * public.service_fee_for_price(stt.price_cents, v_fee_rate, v_fee_min)), 0)::integer
  into v_people, v_total_cents, v_fee_cents
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
    id, event_id, session_id, buyer_name, buyer_email, buyer_phone, total_cents,
    tickets_subtotal_cents, service_fee_cents, service_fee_rate_bps, service_fee_min_cents,
    card_rate_bps_snapshot, pix_rate_bps_snapshot, fee_priced_at, payment_method, status,
    public_token, payment_provider, payment_external_id, expires_at, privacy_policy_version,
    privacy_accepted_at, terms_version, terms_accepted_at
  ) values (
    v_order_id, p_event_id, v_session.id, btrim(p_buyer_name), lower(btrim(p_buyer_email)),
    nullif(btrim(p_buyer_phone), ''), v_total_cents + v_fee_cents,
    v_total_cents, v_fee_cents, v_fee_rate, v_fee_min,
    v_card_snap, v_pix_snap, now(), null, 'pendente', p_public_token,
    p_payment_provider, v_order_id::text, v_expires_at, v_privacy_version,
    case when v_privacy_version is not null then now() end,
    v_terms_version, case when v_terms_version is not null then now() end
  );

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
    v_fee_unit := public.service_fee_for_price(v_line.price_cents, v_fee_rate, v_fee_min);

    insert into public.order_items (
      id, order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit,
      quantity, line_total_cents, service_fee_unit_cents, service_fee_total_cents
    ) values (
      v_item_id, v_order_id, v_line.id, v_line.name, v_line.kind, v_line.price_cents,
      v_line.people_per_unit, v_line.qty, v_line_total, v_fee_unit, v_fee_unit * v_line.qty
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

  return query select v_order_id, v_total_cents + v_fee_cents, v_expires_at, v_fee_cents;
end;
$$;

revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid, integer, integer, text) to service_role;

-- 5) RPC: escolher forma e recalcular total no servidor ----------------------------

create or replace function public.set_order_payment_method(
  p_order_id uuid,
  p_method text
)
returns table (
  payment_method text,
  service_fee_cents integer,
  total_cents integer,
  service_fee_rate_bps integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_method text := lower(btrim(coalesce(p_method, '')));
  v_rate integer;
  v_fee integer := 0;
  v_item record;
  v_fee_unit integer;
begin
  if v_method not in ('pix', 'card') then
    raise exception 'FORMA_INVALIDA: Forma de pagamento inválida.';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'PEDIDO: Pedido não encontrado.';
  end if;
  if v_order.status is distinct from 'pendente' then
    raise exception 'FORMA_STATUS: Só é possível escolher a forma em pedido pendente.';
  end if;
  if v_order.expires_at is not null and v_order.expires_at <= now() then
    raise exception 'FORMA_EXPIRADO: A reserva deste pedido expirou.';
  end if;
  if v_order.total_cents <= 0 then
    raise exception 'FORMA_ZERO: Pedido sem cobrança não escolhe forma de pagamento.';
  end if;

  -- Idempotente: mesmo método e total já bate com a taxa do método.
  v_rate := case v_method
    when 'pix' then coalesce(v_order.pix_rate_bps_snapshot, v_order.service_fee_rate_bps)
    else coalesce(v_order.card_rate_bps_snapshot, v_order.service_fee_rate_bps)
  end;
  if v_order.payment_method is not distinct from v_method
    and v_order.service_fee_rate_bps is not distinct from v_rate then
    return query
      select v_order.payment_method, v_order.service_fee_cents, v_order.total_cents, v_order.service_fee_rate_bps;
    return;
  end if;

  select coalesce(sum(
    public.service_fee_for_price(oi.unit_price_cents, v_rate, v_order.service_fee_min_cents) * oi.quantity
  ), 0)::integer
  into v_fee
  from public.order_items oi
  where oi.order_id = v_order.id;

  perform set_config('app.allow_fee_reprice', '1', true);

  for v_item in
    select oi.id, oi.unit_price_cents, oi.quantity
    from public.order_items oi
    where oi.order_id = v_order.id
  loop
    v_fee_unit := public.service_fee_for_price(
      v_item.unit_price_cents, v_rate, v_order.service_fee_min_cents
    );
    update public.order_items
    set
      service_fee_unit_cents = v_fee_unit,
      service_fee_total_cents = v_fee_unit * v_item.quantity
    where id = v_item.id;
  end loop;

  update public.orders
  set
    payment_method = v_method,
    service_fee_rate_bps = v_rate,
    service_fee_cents = v_fee,
    total_cents = v_order.tickets_subtotal_cents + v_fee,
    fee_priced_at = now()
  where id = v_order.id
  returning
    orders.payment_method,
    orders.service_fee_cents,
    orders.total_cents,
    orders.service_fee_rate_bps
  into payment_method, service_fee_cents, total_cents, service_fee_rate_bps;

  return next;
end;
$$;

revoke all on function public.set_order_payment_method(uuid, text) from public, anon, authenticated;
grant execute on function public.set_order_payment_method(uuid, text) to service_role;

-- 6) Reaceite dos Termos do organizador (N16) --------------------------------------

create or replace function public.accept_organizer_terms(
  p_user_id uuid,
  p_terms_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := nullif(btrim(p_terms_version), '');
begin
  if p_user_id is null then
    raise exception 'ORG_ACESSO: Conta inválida.';
  end if;
  if v_version is null or char_length(v_version) not between 8 and 20 then
    raise exception 'ORG_TERMOS: Versão dos termos inválida.';
  end if;
  update public.organizer_profiles
  set
    terms_version = v_version,
    terms_accepted_at = now()
  where user_id = p_user_id;
  if not found then
    raise exception 'ORG_ACESSO: Perfil de organizador não encontrado.';
  end if;
end;
$$;

revoke all on function public.accept_organizer_terms(uuid, text) from public, anon, authenticated;
grant execute on function public.accept_organizer_terms(uuid, text) to service_role;
