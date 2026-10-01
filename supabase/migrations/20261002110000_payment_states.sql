-- Fase 2 (pagamento mais seguro) da spec 2026-10-01-estorno-tipos-carrinho:
-- IDs do Mercado Pago no pedido, reserva de 15 min estendida pelo PIX, pagamento
-- sem vaga vira "aguardando decisão" (não cancela mais com o dinheiro recebido)
-- e pendentes vencidos passam a "expirado". Usa os enums da migration anterior.

alter table public.orders
  add column provider_order_id text,
  add column provider_payment_id text,
  add column cancel_reason text,
  add column decision_reason text,
  add column decided_by uuid references auth.users (id) on delete set null,
  add column decided_at timestamptz,
  add column hold_extended_at timestamptz;

alter table public.orders
  add constraint orders_provider_ids_length check (
    (provider_order_id is null or char_length(provider_order_id) between 1 and 100)
    and (provider_payment_id is null or char_length(provider_payment_id) between 1 and 100)
  ),
  add constraint orders_cancel_reason_check check (
    cancel_reason is null
    or cancel_reason in ('alterado_pelo_comprador', 'equipe', 'capacidade_legado')
  ),
  add constraint orders_decision_reason_check check (
    decision_reason is null
    or decision_reason in ('sem_vaga', 'pago_apos_cancelamento')
  ),
  add constraint orders_decision_consistent check (
    status <> 'aguardando_decisao' or decision_reason is not null
  );

create unique index orders_provider_order_id_uidx
  on public.orders (payment_provider, provider_order_id)
  where provider_order_id is not null;

-- Reserva de 15 minutos (antes 30). Mesma assinatura e regras de lotação.
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
  v_quantity integer;
  v_total_cents integer;
  v_expires_at timestamptz := now() + interval '15 minutes';
  v_privacy_version text := nullif(btrim(p_privacy_policy_version), '');
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'Evento não encontrado.'; end if;
  if not v_event.sales_open then raise exception 'As vendas deste evento estão fechadas.'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Selecione quantidades válidas de ingressos.'; end if;
  if nullif(btrim(p_buyer_name), '') is null or nullif(btrim(p_buyer_email), '') is null then
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
  join public.ticket_types tt on tt.event_id = p_event_id and tt.kind = requested.kind and tt.active
  where requested.kind in ('inteira', 'meia') and requested.qty > 0;

  if v_quantity < 1 or v_quantity > 10 then raise exception 'Selecione de 1 a 10 ingressos por pedido.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
    where item.kind not in ('inteira', 'meia') or item.qty <= 0
  ) then raise exception 'Um dos tipos de ingresso selecionados está indisponível.'; end if;
  if (
    select count(*) from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
  ) <> (
    select count(*) from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
    join public.ticket_types tt on tt.event_id = p_event_id and tt.kind = item.kind and tt.active
  ) then raise exception 'Um dos tipos de ingresso selecionados está indisponível.'; end if;
  if public.event_occupied_count(p_event_id) + v_quantity > v_event.capacity then
    raise exception 'Capacidade esgotada para este evento.';
  end if;

  insert into public.orders (
    id, event_id, buyer_name, buyer_email, buyer_phone, total_cents, status, public_token,
    payment_provider, payment_external_id, expires_at, privacy_policy_version, privacy_accepted_at
  ) values (
    v_order_id, p_event_id, btrim(p_buyer_name), lower(btrim(p_buyer_email)), nullif(btrim(p_buyer_phone), ''),
    v_total_cents, 'pendente', p_public_token, p_payment_provider, v_order_id::text, v_expires_at,
    v_privacy_version, case when v_privacy_version is not null then now() end
  );

  insert into public.tickets (order_id, event_id, ticket_type_id, kind, status, code, buyer_name, price_cents)
  select v_order_id, p_event_id, tt.id, tt.kind, 'nao_pago', gen_random_uuid()::text, btrim(p_buyer_name), tt.price_cents
  from jsonb_to_recordset(p_items) as item(kind public.ticket_kind, qty integer)
  join public.ticket_types tt on tt.event_id = p_event_id and tt.kind = item.kind and tt.active
  cross join lateral generate_series(1, item.qty);

  return query select v_order_id, v_total_cents, v_expires_at;
end;
$$;

-- O PIX do Mercado Pago vale no mínimo 30 min, mais que a reserva. Ao gerar o PIX
-- dentro da reserva, ela passa a valer até o vencimento do PIX + 2 min (teto de
-- 33 min a partir de agora), uma vez só. Não rechecar lotação: o lugar já está reservado.
create function public.extend_order_hold_for_pix(
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
    or p_pix_expires_at <= now() then
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

-- v2: guarda os IDs do Mercado Pago, aceita pedido expirado e, sem vaga ou com o
-- pedido cancelado, deixa o pedido "aguardando decisão" em vez de cancelar com o
-- dinheiro recebido. Assinatura nova: a antiga (2 parâmetros) sai para não haver
-- ambiguidade na chamada.
drop function public.mark_order_paid_by_external(text, text);

create function public.mark_order_paid_by_external(
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
       + v_ticket_count > v_event.capacity then
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

-- "Aceitar mesmo assim": ignora a lotação de propósito (a equipe confirmou na tela)
-- e registra quem decidiu.
create function public.accept_paid_order(
  p_order_id uuid,
  p_staff_user_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
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

  perform 1 from public.events where id = v_order.event_id for update;

  if v_order.status = 'pago' and v_order.decided_at is not null then
    return 'noop';
  end if;
  if v_order.status <> 'aguardando_decisao' then
    raise exception 'O pedido não está aguardando decisão.';
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

-- Cancela só pedido pendente e libera os lugares na hora (usado pela fase 4).
create function public.cancel_pending_order(
  p_order_id uuid,
  p_reason text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_reason is null
    or p_reason not in ('alterado_pelo_comprador', 'equipe', 'capacidade_legado') then
    raise exception 'Motivo de cancelamento inválido.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'pendente' then
    return 'noop';
  end if;

  update public.orders
  set status = 'cancelado',
      cancel_reason = p_reason,
      expires_at = null
  where id = v_order.id;

  update public.tickets
  set status = 'cancelado',
      cancelled_at = now()
  where order_id = v_order.id and status = 'nao_pago';

  return 'updated';
end;
$$;

-- Pendentes com reserva vencida já não ocupam lugar; passam a "expirado".
-- Os ingressos continuam "nao_pago".
update public.orders
set status = 'expirado'
where status = 'pendente'
  and expires_at < now();

revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.extend_order_hold_for_pix(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.mark_order_paid_by_external(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.accept_paid_order(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_pending_order(uuid, text)
  from public, anon, authenticated;

grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text)
  to service_role;
grant execute on function public.extend_order_hold_for_pix(uuid, timestamptz)
  to service_role;
grant execute on function public.mark_order_paid_by_external(text, text, text, text)
  to service_role;
grant execute on function public.accept_paid_order(uuid, uuid)
  to service_role;
grant execute on function public.cancel_pending_order(uuid, text)
  to service_role;
