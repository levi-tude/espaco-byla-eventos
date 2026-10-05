-- Termos de compra: grava no pedido a versão dos termos aceita no checkout, como já
-- é feito com a Política de Privacidade.
--
-- Aditiva e compatível com o código no ar: colunas novas anuláveis (pedidos antigos
-- ficam com null) e create_checkout_order ganha só p_terms_version opcional (padrão
-- null); quem não manda o parâmetro continua funcionando e grava null.

alter table public.orders
  add column terms_version text,
  add column terms_accepted_at timestamptz,
  add constraint orders_terms_acceptance_pair check (
    (terms_version is null) = (terms_accepted_at is null)
  ),
  add constraint orders_terms_version_length check (
    terms_version is null or char_length(terms_version) between 1 and 32
  );

-- Checkout v6: igual à v5 (20261013100000_service_fee.sql), mais p_terms_version.
drop function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid, integer, integer);
create function public.create_checkout_order(
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
  v_fee_unit integer;
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

  select s.rate_bps, s.min_cents into v_fee_rate, v_fee_min
  from public.service_fee_settings s
  where s.id = 1 and s.enabled;
  if not found then
    v_fee_rate := 0;
    v_fee_min := 0;
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
    tickets_subtotal_cents, service_fee_cents, service_fee_rate_bps, service_fee_min_cents, status,
    public_token, payment_provider, payment_external_id, expires_at, privacy_policy_version,
    privacy_accepted_at, terms_version, terms_accepted_at
  ) values (
    v_order_id, p_event_id, v_session.id, btrim(p_buyer_name), lower(btrim(p_buyer_email)),
    nullif(btrim(p_buyer_phone), ''), v_total_cents + v_fee_cents,
    v_total_cents, v_fee_cents, v_fee_rate, v_fee_min, 'pendente', p_public_token,
    p_payment_provider, v_order_id::text, v_expires_at, v_privacy_version,
    case when v_privacy_version is not null then now() end,
    v_terms_version, case when v_terms_version is not null then now() end
  );

  -- Um ingresso por pessoa. O preço da linha (sem a taxa) é rateado entre os
  -- ingressos (o resto da divisão vai no primeiro) para a soma bater com o subtotal.
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