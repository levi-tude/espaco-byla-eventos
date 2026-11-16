-- Tipos com código (unlock_code_hash) são extras: fora do total da sessão e das
-- cotas de inteira/meia, cada um limitado só pelo próprio max_units.
-- Deixa o pagamento (mark_order_paid_by_external) e a disponibilidade
-- (session_availability) iguais ao create_checkout_order, e protege as regras:
--   * não liga/desliga código em tipo que já tem vendas (mudaria as contas);
--   * tipo com código à venda precisa de limite por sessão (senão venderia sem fim).
-- NÃO aplicado: aguarda aprovação do Levi.

begin;

create or replace function public.mark_order_paid_by_external(p_provider text, p_external_id text, p_provider_order_id text DEFAULT NULL::text, p_provider_payment_id text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Só ingressos que ocupam o total: tipos com código são extras (fora da lotação),
  -- igual a create_checkout_order; o limite próprio (max_units) é conferido abaixo.
  select count(*)::integer
  into v_ticket_count
  from public.tickets t
  join public.ticket_types tt on tt.id = t.ticket_type_id
  where t.order_id = v_order.id and t.status = 'nao_pago'
    and tt.unlock_code_hash is null;

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
        join public.ticket_types tt on tt.id = t.ticket_type_id
        where t.order_id = v_order.id and t.status = 'nao_pago'
          and tt.unlock_code_hash is null
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
$function$;

create or replace function public.session_availability(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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

  -- "Vendidos" do total: sem os extras com código (fora da lotação), senão o
  -- "restam X" cai e a sessão parece esgotada sem estar.
  select count(*) into v_sold
  from public.tickets t
  join public.ticket_types tt on tt.id = t.ticket_type_id
  where t.session_id = p_session_id and t.status in ('pago', 'check_in')
    and tt.unlock_code_hash is null;

  v_occupied := greatest(public.session_occupied_count(p_session_id), v_sold);

  foreach v_kind in array array['inteira', 'meia']::public.ticket_kind[] loop
    v_quota := case v_kind when 'inteira' then v_session.inteira_quota else v_session.meia_quota end;
    select count(*) into v_kind_sold
    from public.tickets t
    join public.ticket_types tt on tt.id = t.ticket_type_id
    where t.session_id = p_session_id and t.kind = v_kind and t.status in ('pago', 'check_in')
      and tt.unlock_code_hash is null;
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
$function$;

-- Ligar/desligar o código muda se o tipo conta na lotação: bloqueado com vendas.
-- Trocar um código por outro (hash -> outro hash) continua permitido.
create or replace function public.ticket_types_guard_unlock_toggle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.unlock_code_hash is null) is distinct from (new.unlock_code_hash is null)
     and exists (select 1 from public.order_items oi where oi.ticket_type_id = new.id) then
    raise exception 'TIPOS_CODIGO_COM_VENDAS:%', new.name;
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_types_guard_unlock_toggle on public.ticket_types;
create trigger ticket_types_guard_unlock_toggle
  before update of unlock_code_hash on public.ticket_types
  for each row execute function public.ticket_types_guard_unlock_toggle();

-- Tipo com código à venda numa sessão precisa de limite (max_units).
create or replace function public.session_ticket_types_require_unlock_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.on_sale and new.max_units is null then
    select tt.name into v_name
    from public.ticket_types tt
    where tt.id = new.ticket_type_id and tt.unlock_code_hash is not null;
    if found then
      raise exception 'TIPOS_CODIGO_SEM_LIMITE:%', v_name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists session_ticket_types_require_unlock_limit on public.session_ticket_types;
create trigger session_ticket_types_require_unlock_limit
  before insert or update of on_sale, max_units on public.session_ticket_types
  for each row execute function public.session_ticket_types_require_unlock_limit();

revoke all on function public.ticket_types_guard_unlock_toggle() from public, anon, authenticated;
revoke all on function public.session_ticket_types_require_unlock_limit() from public, anon, authenticated;
revoke all on function public.mark_order_paid_by_external(text, text, text, text) from public, anon, authenticated;
revoke all on function public.session_availability(uuid) from public, anon, authenticated;
grant execute on function public.mark_order_paid_by_external(text, text, text, text) to service_role;
grant execute on function public.session_availability(uuid) to service_role;

commit;
