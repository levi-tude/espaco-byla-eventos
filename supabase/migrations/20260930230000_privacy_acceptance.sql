-- Registro do aceite da Política de Privacidade no checkout.
-- Pedidos antigos e cortesias ficam com as colunas nulas (não passaram pelo aceite).

alter table public.orders
  add column privacy_policy_version text,
  add column privacy_accepted_at timestamptz;

alter table public.orders
  add constraint orders_privacy_acceptance_consistent check (
    (privacy_policy_version is null) = (privacy_accepted_at is null)
  ),
  add constraint orders_privacy_policy_version_length check (
    privacy_policy_version is null or char_length(privacy_policy_version) between 1 and 32
  );

drop function public.create_checkout_order(uuid, text, text, text, text, text, jsonb);

create function public.create_checkout_order(
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
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_quantity integer;
  v_total_cents integer;
  v_expires_at timestamptz := now() + interval '30 minutes';
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

revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text)
  to service_role;
