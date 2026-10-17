-- A tarifa do banco deixa de sair da parte do organizador e passa a sair da taxa
-- de serviço (receita da plataforma). Não muda service_fee_settings: o percentual
-- cobrado do comprador continua o que estiver no banco até o dono atualizar.
-- Não aplicar sem conferir o projeto Espaço Byla Eventos.
--
-- Parte do organizador = ingressos que continuam válidos (pago e não contestado).
-- Estorno e contestação tiram o valor do ingresso. A tarifa não entra nessa conta,
-- mesmo que o banco não a devolva no estorno. Pedido sem tarifa conhecida também
-- entra: a tarifa não muda mais o valor do organizador.
--
-- Taxa a repassar ao desenvolvedor: a coluna fee_due_cents continua sendo a taxa
-- de serviço bruta dos pedidos que contam. O saldo (balance_cents) desconta as
-- tarifas já conhecidas, inclusive as que sobraram em estorno ou contestação.
-- Tarifa ainda desconhecida só reduz o saldo quando for gravada. Se a tarifa for
-- maior que a taxa de serviço (taxa desligada ou ingresso barato), o saldo fica
-- negativo e abate o próximo repasse da taxa, como os outros descontos.

-- 1) Parte do organizador -------------------------------------------------------

create or replace function public.organizer_event_balance(p_event_id uuid)
returns table (
  sold_cents bigint, sold_orders integer, refunded_cents bigint, refunded_orders integer,
  contested_cents bigint, contested_orders integer, bank_fee_cents bigint,
  pending_fee_orders integer, pending_cents bigint, share_cents bigint,
  paid_out_cents bigint, balance_cents bigint, decision_orders integer, service_fee_cents bigint
)
language sql stable security definer set search_path = '' as $$
  with base as (
    select o.id, o.status::text as status, o.tickets_subtotal_cents::bigint as sub,
           o.service_fee_cents::bigint as svc, f.fee_cents::bigint as fee,
           (o.status = 'pago' and public.order_is_contested(o.id)) as contested
    from public.orders o
    left join public.order_payment_fees f on f.order_id = o.id
    where o.event_id = p_event_id and o.total_cents > 0
      and o.status in ('pago', 'estornado', 'aguardando_decisao')
  ),
  counted as (
    select b.*, (b.status = 'pago' and not b.contested) as keeps, b.fee is not null as known
    from base b where b.status in ('pago', 'estornado')
  ),
  totals as (
    select
      coalesce(sum(c.sub), 0)::bigint as sold,
      count(*)::integer as sold_orders,
      coalesce(sum(c.sub) filter (where c.status = 'estornado'), 0)::bigint as refunded,
      (count(*) filter (where c.status = 'estornado'))::integer as refunded_orders,
      coalesce(sum(c.sub) filter (where c.contested), 0)::bigint as contested,
      (count(*) filter (where c.contested))::integer as contested_orders,
      coalesce(sum(c.fee) filter (where c.known), 0)::bigint as fee,
      (count(*) filter (where not c.known))::integer as pending_orders,
      coalesce(sum(c.sub) filter (where c.keeps), 0)::bigint as share,
      coalesce(sum(c.svc) filter (where c.status = 'pago'), 0)::bigint as svc
    from counted c
  ),
  paid as (
    select coalesce(sum(i.amount_cents), 0)::bigint as v
    from public.organizer_payout_items i where i.event_id = p_event_id
  )
  select t.sold, t.sold_orders, t.refunded, t.refunded_orders, t.contested, t.contested_orders,
         t.fee, t.pending_orders, 0::bigint, t.share, p.v, t.share - p.v,
         (select count(*)::integer from base b where b.status = 'aguardando_decisao'), t.svc
  from totals t cross join paid p;
$$;

-- 2) Saldo da taxa de serviço, já sem a tarifa do banco -------------------------

create or replace function public.event_fee_balance(p_event_id uuid)
returns table (
  tickets_cents bigint,
  fee_cents bigint,
  paid_total_cents bigint,
  refunded_cents bigint,
  refunded_fee_cents bigint,
  refunded_orders integer,
  contested_cents bigint,
  contested_fee_cents bigint,
  contested_orders integer,
  fee_due_cents bigint,
  paid_out_cents bigint,
  balance_cents bigint,
  decision_orders integer,
  decision_cents bigint,
  decision_fee_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select o.status, o.total_cents, o.tickets_subtotal_cents, o.service_fee_cents,
      (o.status = 'pago' and public.order_is_contested(o.id)) as contested,
      f.fee_cents as bank_fee
    from public.orders o
    left join public.order_payment_fees f on f.order_id = o.id
    where o.event_id = p_event_id and o.status in ('pago', 'estornado', 'aguardando_decisao')
  ),
  paid as (
    select coalesce(sum(i.amount_cents), 0)::bigint as v
    from public.service_fee_payout_items i
    where i.event_id = p_event_id
  ),
  sums as (
    select
      coalesce(sum(o.tickets_subtotal_cents) filter (where o.status in ('pago', 'estornado')), 0)::bigint as tickets,
      coalesce(sum(o.service_fee_cents) filter (where o.status in ('pago', 'estornado')), 0)::bigint as fee,
      coalesce(sum(o.total_cents) filter (where o.status in ('pago', 'estornado')), 0)::bigint as paid_total,
      coalesce(sum(o.total_cents) filter (where o.status = 'estornado'), 0)::bigint as refunded,
      coalesce(sum(o.service_fee_cents) filter (where o.status = 'estornado'), 0)::bigint as refunded_fee,
      (count(*) filter (where o.status = 'estornado'))::integer as refunded_orders,
      coalesce(sum(o.total_cents) filter (where o.contested), 0)::bigint as contested,
      coalesce(sum(o.service_fee_cents) filter (where o.contested), 0)::bigint as contested_fee,
      (count(*) filter (where o.contested))::integer as contested_orders,
      coalesce(sum(o.service_fee_cents) filter (where o.status = 'pago' and not o.contested), 0)::bigint as fee_due,
      coalesce(sum(o.bank_fee) filter (
        where o.bank_fee is not null and o.status in ('pago', 'estornado')
      ), 0)::bigint as bank_fee,
      (count(*) filter (where o.status = 'aguardando_decisao'))::integer as decision_orders,
      coalesce(sum(o.total_cents) filter (where o.status = 'aguardando_decisao'), 0)::bigint as decision,
      coalesce(sum(o.service_fee_cents) filter (where o.status = 'aguardando_decisao'), 0)::bigint as decision_fee
    from o
  )
  select s.tickets, s.fee, s.paid_total, s.refunded, s.refunded_fee, s.refunded_orders,
    s.contested, s.contested_fee, s.contested_orders, s.fee_due, p.v,
    s.fee_due - s.bank_fee - p.v,
    s.decision_orders, s.decision, s.decision_fee
  from sums s cross join paid p;
$$;

-- 3) Repasse do organizador não espera a tarifa ---------------------------------

create or replace function public.record_organizer_payout(
  p_admin uuid, p_event_id uuid, p_expected_amount_cents integer, p_pix_date date, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_event public.events%rowtype;
  v_profile public.organizer_profiles%rowtype;
  v_start date;
  v_preview jsonb;
  v_balance bigint;
  v_left bigint;
  v_kind text;
  v_payout_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_finance_admin(p_admin, true);
  select * into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null or v_event.organizer_id is null then
    raise exception 'ORG_ACESSO: Evento sem organizador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_event.organizer_id::text, 0));

  v_start := public.event_fee_due_date(p_event_id);
  if v_start is null or v_today < v_start then
    raise exception 'ORG_PRAZO: O repasse só pode ser registrado depois da última sessão.';
  end if;
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'ORG_NOTA: Nota inválida.';
  end if;

  v_preview := public.organizer_payout_preview(p_event_id);
  v_balance := (v_preview ->> 'balance_cents')::bigint;
  if v_balance <= 0 then
    raise exception 'ORG_NADA: Nada a repassar neste evento.';
  end if;

  v_left := (v_preview ->> 'amount_cents')::bigint;
  if v_left is distinct from p_expected_amount_cents::bigint then
    raise exception 'ORG_MUDOU:%', v_left;
  end if;
  v_kind := v_preview ->> 'kind';
  if v_kind = 'repasse' and public.organizer_pix_change_pending(v_event.organizer_id) then
    raise exception 'ORG_PIX_PENDENTE: Troca de chave PIX aguardando decisão.';
  end if;
  if v_kind = 'repasse' and (p_pix_date is null or p_pix_date > v_today or p_pix_date < v_start) then
    raise exception 'ORG_DATA: Data do PIX inválida.';
  end if;

  select * into v_profile from public.organizer_profiles op where op.user_id = v_event.organizer_id;
  insert into public.organizer_payouts (
    organizer_id, kind, amount_cents, pix_date, pix_key_type, pix_key_snapshot,
    pix_holder_name_snapshot, pix_holder_document_snapshot, pix_key_changed_at_snapshot,
    note, created_by, created_by_name
  ) values (
    v_event.organizer_id, v_kind, v_left::integer,
    case when v_kind = 'repasse' then p_pix_date end,
    case when v_kind = 'repasse' then v_profile.pix_key_type end,
    case when v_kind = 'repasse' then v_profile.pix_key end,
    case when v_kind = 'repasse' then v_profile.pix_holder_name end,
    case when v_kind = 'repasse' then v_profile.pix_holder_document end,
    case when v_kind = 'repasse' then v_profile.pix_key_changed_at end,
    v_note, p_admin, public.staff_display_name(p_admin)
  ) returning id into v_payout_id;

  insert into public.organizer_payout_items (payout_id, event_id, amount_cents)
  select v_payout_id, (i ->> 'event_id')::uuid, (i ->> 'amount_cents')::integer
  from jsonb_array_elements(v_preview -> 'items') i;

  perform public.resolve_balance_flags(v_event.organizer_id);
  perform public.log_audit(p_admin, case when v_kind = 'repasse' then 'repasse_registrado' else 'repasse_compensado' end,
    p_event_id, null, v_event.organizer_id,
    jsonb_build_object('amount_cents', v_left, 'discount_cents', v_balance - v_left));
  return jsonb_build_object('payout_id', v_payout_id, 'kind', v_kind, 'amount_cents', v_left,
    'discount_cents', v_balance - v_left, 'organizer_id', v_event.organizer_id);
end;
$$;

-- 4) Dívida do organizador não espera a tarifa (ela não muda o saldo) ----------

create or replace function public.refresh_organizer_balance_flags()
returns table (flag_id uuid, organizer_id uuid, event_id uuid, event_name text, owed_cents bigint, return_due_date date)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  update public.organizer_balance_flags f set resolved_at = now()
  where f.resolved_at is null
    and (select b.balance_cents from public.organizer_event_balance(f.event_id) b) >= 0;

  insert into public.organizer_balance_flags (event_id, organizer_id, negative_since)
  select e.id, e.organizer_id, v_today
  from public.organizer_finance_event_ids() as ids(id)
  join public.events e on e.id = ids.id
  cross join lateral public.organizer_event_balance(e.id) b
  where b.balance_cents < 0
    and not exists (select 1 from public.organizer_balance_flags f where f.event_id = e.id and f.resolved_at is null);

  for r in
    update public.organizer_balance_flags f set return_due_date = v_today + 10
    where f.resolved_at is null and f.return_due_date is null and f.negative_since + 30 <= v_today
    returning f.event_id, f.organizer_id
  loop
    perform public.log_audit(null, 'devolucao_pendente', r.event_id, null, r.organizer_id, '{}'::jsonb);
  end loop;

  return query
  select f.id, f.organizer_id, f.event_id, e.name, -b.balance_cents, f.return_due_date
  from public.organizer_balance_flags f
  join public.events e on e.id = f.event_id
  cross join lateral public.organizer_event_balance(f.event_id) b
  where f.resolved_at is null and f.return_due_date is not null and f.return_notified_at is null
    and b.balance_cents < 0
  order by f.organizer_id, f.return_due_date;
end;
$$;

create or replace function public.organizer_overdue_refunds(p_organizer_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.organizer_balance_flags f
  cross join lateral public.organizer_event_balance(f.event_id) b
  where f.organizer_id = p_organizer_id and f.resolved_at is null
    and f.return_due_date < (now() at time zone 'America/Sao_Paulo')::date
    and b.balance_cents < 0;
$$;
