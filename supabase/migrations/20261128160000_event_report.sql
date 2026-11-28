-- Relatório do evento (fase 1). Não aplicar sem conferir o projeto Espaço Byla Eventos.
--
-- Três funções separadas, para um erro de tela não mostrar o que não deve:
--   event_report            quantidades (equipe e dono do evento)
--   event_report_finance    dinheiro completo (só admin e admin_dev)
--   event_report_organizer  dinheiro simples do dono (sem tarifa e sem taxa líquida)
--
-- Chamadas com a sessão de quem está logado (authenticated). anon e service_role
-- não executam. A função confere auth.uid(), o código do e-mail e o acesso ao evento.
-- Não devolve nome, e-mail, telefone, código nem token.
--
-- Lotação = ingressos pagos ou com entrada, sem tipo de código (capacitação).
-- Bônus conta na lotação. Casadinha conta pessoas (cada ingresso), não a unidade.
-- O dinheiro reusa event_fee_balance e organizer_event_balance.

-- 1) Índices de apoio -----------------------------------------------------------

create index if not exists tickets_event_session_status_idx
  on public.tickets (event_id, session_id, status);

create index if not exists orders_event_status_paid_at_idx
  on public.orders (event_id, status, paid_at);

create index if not exists tickets_session_checked_in_at_idx
  on public.tickets (session_id, checked_in_at)
  where checked_in_at is not null;

-- 2) Auditoria da exportação ----------------------------------------------------

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action = any (array[
  'convite_gerado', 'convite_revogado', 'convite_usado', 'link_senha_gerado', 'link_senha_pedido',
  'senha_redefinida_link', 'conta_criada', 'conta_suspensa', 'conta_reativada', 'conta_encerrada',
  'aparelhos_esquecidos', 'evento_criado', 'evento_enviado', 'evento_envio_desfeito',
  'evento_aprovado', 'evento_recusado', 'evento_alterado_pos_aprovacao', 'evento_excluido',
  'vendas_abertas', 'vendas_pausadas', 'pedido_estorno_criado', 'pedido_exclusao_criado',
  'pedido_mudanca_criado', 'pedido_atendido', 'pedido_recusado', 'pedido_cancelado',
  'tarifa_lancada', 'repasse_registrado', 'repasse_compensado', 'repasse_ajuste',
  'devolucao_recebida', 'devolucao_pendente', 'pix_troca_pedida', 'pix_troca_cancelada',
  'pix_troca_confirmada', 'pix_troca_recusada', 'relatorio_exportado'
]::text[]));

-- 3) Quantidades ----------------------------------------------------------------

create or replace function public.event_report(p_actor uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  v_access text;
  v_sessions jsonb;
  v_last_end timestamptz;
begin
  if p_actor is null
     or p_actor is distinct from (select auth.uid())
     or not public.session_is_verified() then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;
  v_access := public.actor_event_access(p_actor, p_event_id);
  if v_access is null then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;

  with classified as (
    select
      t.id as ticket_id,
      t.session_id,
      t.order_id,
      t.order_item_id,
      t.status::text as status,
      t.checked_in_at,
      (tt.unlock_code_hash is not null) as outside,
      case
        when tt.unlock_code_hash is not null then 'capacitacao'
        when t.kind = 'cortesia' then 'bonus'
        when t.kind = 'meia' then 'meia'
        when tt.preset = 'familia' or coalesce(tt.people_per_unit, 1) >= 4 then 'familia'
        when tt.preset = 'casadinha' or coalesce(tt.people_per_unit, 1) > 1 then 'casadinha'
        else 'inteira'
      end as bucket
    from public.tickets t
    join public.ticket_types tt on tt.id = t.ticket_type_id
    where t.event_id = p_event_id
  ),
  valid as (
    select * from classified c where c.status in ('pago', 'check_in')
  ),
  qty as (
    select
      v.session_id,
      count(*) filter (where not v.outside) as occupied,
      count(*) filter (where v.outside) as training,
      count(*) filter (where v.status = 'check_in') as present,
      count(*) filter (where v.status = 'check_in' and v.outside) as present_training,
      count(*) filter (where v.status = 'pago' and not v.outside) as waiting,
      count(*) filter (where v.status = 'pago' and v.outside) as waiting_training,
      count(*) filter (where v.bucket = 'inteira') as inteira,
      count(*) filter (where v.bucket = 'casadinha') as casadinha,
      count(*) filter (where v.bucket = 'familia') as familia,
      count(*) filter (where v.bucket = 'meia') as meia,
      count(*) filter (where v.bucket = 'bonus') as bonus
    from valid v
    group by v.session_id
  ),
  units as (
    select
      x.session_id,
      coalesce(sum(ceil(x.people::numeric / greatest(x.people_per_unit, 1))) filter (where x.bucket = 'casadinha'), 0) as casadinha_units,
      coalesce(sum(ceil(x.people::numeric / greatest(x.people_per_unit, 1))) filter (where x.bucket = 'familia'), 0) as familia_units
    from (
      select v.session_id, v.bucket, oi.people_per_unit, count(*) as people
      from valid v
      join public.order_items oi on oi.id = v.order_item_id
      where v.bucket in ('casadinha', 'familia')
      group by v.session_id, v.bucket, oi.id, oi.people_per_unit
    ) x
    group by x.session_id
  ),
  holds as (
    select c.session_id, count(*) as held
    from classified c
    join public.orders o on o.id = c.order_id
    where c.status = 'nao_pago'
      and not c.outside
      and o.status = 'pendente'
      and o.expires_at > v_now
    group by c.session_id
  ),
  pending as (
    select
      o.session_id,
      count(*) filter (where o.expires_at > v_now) as active_orders,
      count(*) filter (where o.expires_at is null or o.expires_at <= v_now) as expired_orders,
      coalesce(sum((
        select count(*) from public.tickets tk
        where tk.order_id = o.id and tk.status = 'nao_pago'
      )) filter (where o.expires_at is null or o.expires_at <= v_now), 0) as expired_tickets
    from public.orders o
    where o.event_id = p_event_id and o.status = 'pendente'
    group by o.session_id
  ),
  others as (
    select
      c.session_id,
      count(*) filter (where c.status = 'cancelado') as cancelled_tickets,
      count(*) filter (where c.status = 'estornado') as refunded_tickets
    from classified c
    group by c.session_id
  ),
  refunds as (
    select
      o.session_id,
      count(*) filter (where r.status = 'solicitado') as open_count,
      count(*) filter (where r.status = 'concluido') as done_count
    from public.order_refunds r
    join public.orders o on o.id = r.order_id
    where o.event_id = p_event_id
    group by o.session_id
  ),
  meia_latest as (
    select distinct on (c.ticket_id) c.ticket_id, c.result
    from public.meia_checks c
    where c.event_id = p_event_id
    order by c.ticket_id, c.created_at desc, c.id desc
  ),
  meia as (
    select
      v.session_id,
      count(*) filter (where v.status = 'check_in' and l.result = 'comprovante_ok') as ok,
      count(*) filter (where v.status = 'check_in' and l.result = 'pagou_diferenca') as diff,
      count(*) filter (where v.status = 'pago' and l.result = 'recusado') as refused,
      count(*) filter (where v.status = 'check_in' and (l.result is null or l.result = 'recusado')) as unmarked
    from valid v
    left join meia_latest l on l.ticket_id = v.ticket_id
    where v.bucket = 'meia'
    group by v.session_id
  ),
  pays as (
    select
      o.session_id,
      count(*) filter (where o.total_cents > 0 and o.payment_method = 'pix') as pix,
      count(*) filter (where o.total_cents > 0 and o.payment_method = 'card') as card,
      count(*) filter (where o.total_cents > 0 and coalesce(o.payment_method, '') not in ('pix', 'card')) as other,
      count(*) filter (where o.total_cents = 0) as bonus
    from public.orders o
    where o.event_id = p_event_id and o.status = 'pago'
    group by o.session_id
  ),
  daily as (
    select
      v.session_id,
      (coalesce(o.paid_at, o.created_at) at time zone 'America/Sao_Paulo')::date as day,
      count(*) as tickets
    from valid v
    join public.orders o on o.id = v.order_id
    group by v.session_id, 2
  ),
  daily_json as (
    select d.session_id, coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'tickets', d.tickets) order by d.day), '[]'::jsonb) as days
    from daily d
    group by d.session_id
  ),
  arrival as (
    select
      v.session_id,
      to_char(
        date_trunc('hour', v.checked_in_at at time zone 'America/Sao_Paulo')
        + ((extract(minute from v.checked_in_at at time zone 'America/Sao_Paulo')::int / 10) * interval '10 minutes'),
        'HH24:MI'
      ) as label,
      count(*) as n
    from valid v
    where v.status = 'check_in' and v.checked_in_at is not null
    group by v.session_id, 2
  ),
  arrival_json as (
    select a.session_id, coalesce(jsonb_agg(jsonb_build_object('label', a.label, 'count', a.n) order by a.label), '[]'::jsonb) as buckets
    from arrival a
    group by a.session_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'starts_at', s.starts_at,
      'ends_at', s.ends_at,
      'status', s.status,
      'capacity', s.capacity,
      'occupied', coalesce(q.occupied, 0),
      'training', coalesce(q.training, 0),
      'present', coalesce(q.present, 0),
      'present_training', coalesce(q.present_training, 0),
      'no_show', case
        when s.status <> 'ativa' or s.ends_at is null or s.ends_at > v_now then null
        else coalesce(q.waiting, 0)
      end,
      'no_show_training', case
        when s.status <> 'ativa' or s.ends_at is null or s.ends_at > v_now then null
        else coalesce(q.waiting_training, 0)
      end,
      'buckets', jsonb_build_object(
        'inteira', coalesce(q.inteira, 0),
        'casadinha', coalesce(q.casadinha, 0),
        'familia', coalesce(q.familia, 0),
        'meia', coalesce(q.meia, 0),
        'bonus', coalesce(q.bonus, 0),
        'capacitacao', coalesce(q.training, 0)
      ),
      'casadinha_units', coalesce(u.casadinha_units, 0),
      'familia_units', coalesce(u.familia_units, 0),
      'held_tickets', coalesce(h.held, 0),
      'pending_active_orders', coalesce(p.active_orders, 0),
      'pending_expired_orders', coalesce(p.expired_orders, 0),
      'pending_expired_tickets', coalesce(p.expired_tickets, 0),
      'cancelled_tickets', coalesce(ot.cancelled_tickets, 0),
      'refunded_tickets', coalesce(ot.refunded_tickets, 0),
      'refunds_open', coalesce(rf.open_count, 0),
      'refunds_done', coalesce(rf.done_count, 0),
      'meia_check', jsonb_build_object(
        'comprovante_ok', coalesce(m.ok, 0),
        'pagou_diferenca', coalesce(m.diff, 0),
        'recusadas', coalesce(m.refused, 0),
        'nao_registradas', coalesce(m.unmarked, 0)
      ),
      'payments', jsonb_build_object(
        'pix', coalesce(py.pix, 0),
        'card', coalesce(py.card, 0),
        'other', coalesce(py.other, 0),
        'bonus', coalesce(py.bonus, 0)
      ),
      'daily', coalesce(dj.days, '[]'::jsonb),
      'arrival', coalesce(aj.buckets, '[]'::jsonb)
    )
    order by s.starts_at, s.id
  ), '[]'::jsonb)
  into v_sessions
  from public.event_sessions s
  left join qty q on q.session_id = s.id
  left join units u on u.session_id = s.id
  left join holds h on h.session_id = s.id
  left join pending p on p.session_id = s.id
  left join others ot on ot.session_id = s.id
  left join refunds rf on rf.session_id = s.id
  left join meia m on m.session_id = s.id
  left join pays py on py.session_id = s.id
  left join daily_json dj on dj.session_id = s.id
  left join arrival_json aj on aj.session_id = s.id
  where s.event_id = p_event_id and s.archived_at is null;

  if v_sessions is null then
    v_sessions := '[]'::jsonb;
  end if;

  select max(coalesce(s.ends_at, s.starts_at)) into v_last_end
  from public.event_sessions s
  where s.event_id = p_event_id and s.archived_at is null and s.status = 'ativa';

  return jsonb_build_object(
    'generated_at', v_now,
    'live', v_last_end is not null and v_last_end > v_now,
    'sessions', v_sessions
  );
end;
$$;

-- 4) Financeiro completo (admin) ------------------------------------------------

create or replace function public.event_report_finance(p_actor uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  v_access text;
  v_share bigint;
  v_sold bigint;
  v_org_refunded bigint;
  v_org_refunded_orders integer;
  v_pending_fees integer;
  v_org_paid bigint;
  v_org_balance bigint;
  v_fee_due bigint;
  v_refunded_total bigint;
  v_refunded_fee bigint;
  v_refunded_orders integer;
  v_contested bigint;
  v_contested_orders integer;
  v_fee_paid bigint;
  v_fee_balance bigint;
  v_provider bigint;
  v_refund_provider bigint;
  v_refunds_checked integer;
  v_paying_orders integer;
  v_paying_people integer;
  v_sessions jsonb;
  v_daily jsonb;
begin
  if p_actor is null
     or p_actor is distinct from (select auth.uid())
     or not public.session_is_verified() then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;
  v_access := public.actor_event_access(p_actor, p_event_id);
  if v_access is distinct from 'equipe' then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;
  perform public.assert_finance_admin(p_actor, false);

  select b.share_cents, b.sold_cents, b.refunded_cents, b.refunded_orders, b.pending_fee_orders,
         b.paid_out_cents, b.balance_cents
    into v_share, v_sold, v_org_refunded, v_org_refunded_orders, v_pending_fees, v_org_paid, v_org_balance
  from public.organizer_event_balance(p_event_id) b;

  select f.fee_due_cents, f.refunded_cents, f.refunded_fee_cents, f.refunded_orders,
         f.contested_cents, f.contested_orders, f.paid_out_cents, f.balance_cents
    into v_fee_due, v_refunded_total, v_refunded_fee, v_refunded_orders,
         v_contested, v_contested_orders, v_fee_paid, v_fee_balance
  from public.event_fee_balance(p_event_id) f;

  -- Tarifa conhecida de pagos e estornados: a mesma conta do saldo da taxa.
  v_provider := coalesce(v_fee_due, 0) - coalesce(v_fee_balance, 0) - coalesce(v_fee_paid, 0);

  select coalesce(sum(f.fee_cents), 0)::bigint,
         count(*) filter (where f.refund_checked_at is not null)::integer
    into v_refund_provider, v_refunds_checked
  from public.orders o
  join public.order_payment_fees f on f.order_id = o.id
  where o.event_id = p_event_id and o.status = 'estornado' and f.fee_cents is not null;

  select count(*)::integer into v_paying_orders
  from public.orders o
  where o.event_id = p_event_id and o.status = 'pago' and o.total_cents > 0
    and not public.order_is_contested(o.id);

  select count(*)::integer into v_paying_people
  from public.tickets t
  join public.orders o on o.id = t.order_id
  where t.event_id = p_event_id
    and t.status in ('pago', 'check_in')
    and t.kind <> 'cortesia'
    and o.status = 'pago'
    and not public.order_is_contested(o.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'ticket_cents', coalesce(tk.cents, 0),
    'pending_active_cents', coalesce(p.active_cents, 0),
    'pending_expired_cents', coalesce(p.expired_cents, 0)
  ) order by s.starts_at, s.id), '[]'::jsonb)
  into v_sessions
  from public.event_sessions s
  left join lateral (
    select sum(t.price_cents)::bigint as cents
    from public.tickets t
    join public.orders o on o.id = t.order_id
    where t.session_id = s.id
      and t.status in ('pago', 'check_in')
      and o.status = 'pago'
      and not public.order_is_contested(o.id)
  ) tk on true
  left join lateral (
    select
      coalesce(sum(o.total_cents) filter (where o.expires_at > v_now), 0)::bigint as active_cents,
      coalesce(sum(o.total_cents) filter (where o.expires_at is null or o.expires_at <= v_now), 0)::bigint as expired_cents
    from public.orders o
    where o.session_id = s.id and o.event_id = p_event_id and o.status = 'pendente'
  ) p on true
  where s.event_id = p_event_id and s.archived_at is null;

  if v_sessions is null then
    v_sessions := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'ticket_cents', d.cents) order by d.day), '[]'::jsonb)
  into v_daily
  from (
    select (coalesce(o.paid_at, o.created_at) at time zone 'America/Sao_Paulo')::date as day,
           sum(o.tickets_subtotal_cents)::bigint as cents
    from public.orders o
    where o.event_id = p_event_id and o.status = 'pago' and not public.order_is_contested(o.id)
    group by 1
  ) d;

  if v_daily is null then
    v_daily := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'client_paid_cents', coalesce(v_share, 0) + coalesce(v_fee_due, 0),
    'organizer_cents', coalesce(v_share, 0),
    'gross_fee_cents', coalesce(v_fee_due, 0),
    'provider_fee_cents', coalesce(v_provider, 0),
    'net_fee_cents', coalesce(v_fee_balance, 0) + coalesce(v_fee_paid, 0),
    'fees_pending_orders', coalesce(v_pending_fees, 0),
    'organizer_sold_cents', coalesce(v_sold, 0),
    'organizer_refunded_cents', coalesce(v_org_refunded, 0),
    'refunded_orders', coalesce(v_refunded_orders, v_org_refunded_orders, 0),
    'refunded_client_cents', coalesce(v_refunded_total, 0),
    'refunded_fee_cents', coalesce(v_refunded_fee, 0),
    'provider_fee_on_refunds_cents', coalesce(v_refund_provider, 0),
    'refunds_checked', coalesce(v_refunds_checked, 0),
    'contested_orders', coalesce(v_contested_orders, 0),
    'contested_cents', coalesce(v_contested, 0),
    'paying_orders', coalesce(v_paying_orders, 0),
    'paying_people', coalesce(v_paying_people, 0),
    'organizer_paid_out_cents', coalesce(v_org_paid, 0),
    'organizer_balance_cents', coalesce(v_org_balance, 0),
    'fee_paid_out_cents', coalesce(v_fee_paid, 0),
    'fee_balance_cents', coalesce(v_fee_balance, 0),
    'payout_due_date', public.event_payout_due_date(p_event_id),
    'fee_due_date', public.event_fee_due_date(p_event_id),
    'sessions', v_sessions,
    'daily', v_daily
  );
end;
$$;

-- 5) Financeiro simples do organizador ------------------------------------------
-- @@event_report_organizer

create or replace function public.event_report_organizer(p_actor uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_access text;
  v_share bigint;
  v_sold bigint;
  v_refunded bigint;
  v_refunded_orders integer;
  v_paid bigint;
  v_balance bigint;
  v_contested bigint;
  v_contested_orders integer;
  v_fee_due bigint;
  v_sessions jsonb;
  v_daily jsonb;
begin
  if p_actor is null
     or p_actor is distinct from (select auth.uid())
     or not public.session_is_verified() then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;
  v_access := public.actor_event_access(p_actor, p_event_id);
  if v_access is distinct from 'dono' then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;

  select b.share_cents, b.sold_cents, b.refunded_cents, b.refunded_orders,
         b.paid_out_cents, b.balance_cents, b.contested_cents, b.contested_orders
    into v_share, v_sold, v_refunded, v_refunded_orders, v_paid, v_balance, v_contested, v_contested_orders
  from public.organizer_event_balance(p_event_id) b;

  select f.fee_due_cents into v_fee_due
  from public.event_fee_balance(p_event_id) f;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'ticket_cents', coalesce(tk.cents, 0)
  ) order by s.starts_at, s.id), '[]'::jsonb)
  into v_sessions
  from public.event_sessions s
  left join lateral (
    select sum(t.price_cents)::bigint as cents
    from public.tickets t
    join public.orders o on o.id = t.order_id
    where t.session_id = s.id
      and t.status in ('pago', 'check_in')
      and o.status = 'pago'
      and not public.order_is_contested(o.id)
  ) tk on true
  where s.event_id = p_event_id and s.archived_at is null;

  if v_sessions is null then
    v_sessions := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'ticket_cents', d.cents) order by d.day), '[]'::jsonb)
  into v_daily
  from (
    select (coalesce(o.paid_at, o.created_at) at time zone 'America/Sao_Paulo')::date as day,
           sum(o.tickets_subtotal_cents)::bigint as cents
    from public.orders o
    where o.event_id = p_event_id and o.status = 'pago' and not public.order_is_contested(o.id)
    group by 1
  ) d;

  if v_daily is null then
    v_daily := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'tickets_sold_cents', coalesce(v_sold, 0),
    'refunded_cents', coalesce(v_refunded, 0),
    'refunded_orders', coalesce(v_refunded_orders, 0),
    'you_receive_cents', coalesce(v_share, 0),
    'service_fee_cents', coalesce(v_fee_due, 0),
    'client_paid_cents', coalesce(v_share, 0) + coalesce(v_fee_due, 0),
    'paid_out_cents', coalesce(v_paid, 0),
    'balance_cents', coalesce(v_balance, 0),
    'payout_due_date', public.event_payout_due_date(p_event_id),
    'contested_orders', coalesce(v_contested_orders, 0),
    'contested_cents', coalesce(v_contested, 0),
    'sessions', v_sessions,
    'daily', v_daily
  );
end;
$$;

-- @@end event_report_organizer

-- 6) Registro da exportação (sem dado pessoal) ----------------------------------

create or replace function public.log_event_report_export(p_actor uuid, p_event_id uuid, p_format text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_access text;
begin
  if p_actor is null
     or p_actor is distinct from (select auth.uid())
     or not public.session_is_verified() then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;
  if p_format is null or p_format not in ('csv', 'pdf') then
    raise exception 'RELATORIO_DADOS: Dados inválidos.';
  end if;
  v_access := public.actor_event_access(p_actor, p_event_id);
  if v_access is null then
    raise exception 'RELATORIO_ACESSO: Acesso não autorizado.';
  end if;
  perform public.log_audit(
    p_actor,
    'relatorio_exportado',
    p_event_id,
    null,
    null,
    jsonb_build_object('format', p_format, 'access', v_access)
  );
end;
$$;

-- 7) Permissões: só a sessão autenticada ----------------------------------------

revoke all on function public.event_report(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.event_report_finance(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.event_report_organizer(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.log_event_report_export(uuid, uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.event_report(uuid, uuid) to authenticated;
grant execute on function public.event_report_finance(uuid, uuid) to authenticated;
grant execute on function public.event_report_organizer(uuid, uuid) to authenticated;
grant execute on function public.log_event_report_export(uuid, uuid, text) to authenticated;
