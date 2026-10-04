-- Sessões, fases 5 e 6 (spec 2026-10-03-sessoes-design, seções 6.4, 9.4 e 10):
--   * aviso por e-mail de mudança de horário da sessão (1 por pedido e alteração);
--   * cancelar sessão (soft: nada é apagado, nada é estornado sozinho);
--   * "Estornar todos" da sessão cancelada, em lote retomável e idempotente;
--   * fila de e-mails por sessão que respeita a cota diária do serviço de e-mail.
--
-- Migration ADITIVA: só cria tabelas e funções novas. O código no ar (a82404b) não
-- usa nada daqui e continua igual. Aplicar ANTES do deploy do código destas fases.
-- Todas as funções: SECURITY DEFINER, search_path vazio, só service_role executa;
-- as que agem pela equipe recebem p_staff_user_id e conferem staff_profiles.

-- 1) Tabelas ---------------------------------------------------------------------

-- Registro do que a equipe fez em cada sessão. Só contagens e valores (nada do
-- comprador). Nunca editado nem apagado.
create table public.session_audit_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.event_sessions (id),
  action text not null,
  staff_user_id uuid references auth.users (id) on delete set null,
  staff_name text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint session_audit_log_action_check check (action in (
    'cancelada', 'aviso_horario_pedido', 'aviso_cancelamento_pedido',
    'lote_estorno_iniciado', 'lote_estorno_retomado', 'lote_estorno_concluido'
  )),
  constraint session_audit_log_text_lengths check (
    (staff_name is null or char_length(staff_name) between 1 and 200)
    and (reason is null or char_length(reason) between 1 and 500)
  ),
  constraint session_audit_log_details_object check (jsonb_typeof(details) = 'object')
);

create index session_audit_log_session_idx on public.session_audit_log (session_id, created_at desc);

-- Um comunicado por e-mail da sessão: mudança de horário (ligado à alteração
-- registrada pelo editor), cancelamento e "valor devolvido" da sessão cancelada.
create table public.session_notices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.event_sessions (id),
  kind text not null,
  schedule_change_id uuid references public.session_schedule_changes (id),
  new_starts_at timestamptz,
  new_ends_at timestamptz,
  reason text,
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_name text,
  created_at timestamptz not null default now(),
  constraint session_notices_kind_check check (
    kind in ('alteracao_horario', 'cancelamento', 'estorno_cancelamento')
  ),
  constraint session_notices_schedule_consistent check (
    (kind = 'alteracao_horario') = (schedule_change_id is not null and new_starts_at is not null)
  ),
  constraint session_notices_text_lengths check (
    (reason is null or char_length(reason) between 1 and 500)
    and (requested_by_name is null or char_length(requested_by_name) between 1 and 200)
  )
);

-- A mesma alteração nunca gera dois comunicados; cancelamento e "valor devolvido"
-- têm um comunicado só por sessão.
create unique index session_notices_change_uidx
  on public.session_notices (schedule_change_id)
  where schedule_change_id is not null;
create unique index session_notices_session_kind_uidx
  on public.session_notices (session_id, kind)
  where kind in ('cancelamento', 'estorno_cancelamento');
create index session_notices_session_idx on public.session_notices (session_id, created_at desc);

-- Uma linha por comunicado e pedido: o mesmo e-mail nunca vai duas vezes ao
-- mesmo pedido. Guarda o pedido, nunca o e-mail copiado.
create table public.session_notice_deliveries (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.session_notices (id),
  order_id uuid not null references public.orders (id),
  status text not null default 'pendente',
  attempts integer not null default 0,
  previous_starts_at timestamptz,
  previous_ends_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_notice_deliveries_unique unique (notice_id, order_id),
  constraint session_notice_deliveries_status_check check (
    status in ('pendente', 'enviando', 'enviado', 'falhou', 'pulado')
  ),
  constraint session_notice_deliveries_attempts_range check (attempts between 0 and 20),
  constraint session_notice_deliveries_sent_consistent check ((status = 'enviado') = (sent_at is not null)),
  constraint session_notice_deliveries_error_length check (
    error_code is null or char_length(error_code) between 1 and 100
  )
);

create index session_notice_deliveries_queue_idx
  on public.session_notice_deliveries (created_at)
  where status in ('pendente', 'enviando');
create index session_notice_deliveries_order_idx on public.session_notice_deliveries (order_id);

-- Pausa da fila quando o uso diário do serviço de e-mail chega ao teto (reserva
-- para ingressos e alertas). Uma linha só.
create table public.email_quota_pause (
  id boolean primary key default true,
  paused_until timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint email_quota_pause_single_row check (id)
);

-- "Estornar todos": um lote por vez em cada sessão.
create table public.session_refund_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.event_sessions (id),
  status text not null default 'em_andamento',
  reason text not null,
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_name text not null,
  expected_count integer not null,
  expected_total_cents bigint not null,
  consecutive_errors integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint session_refund_batches_status_check check (
    status in ('em_andamento', 'concluido', 'concluido_com_falhas')
  ),
  constraint session_refund_batches_reason_length check (char_length(btrim(reason)) between 5 and 500),
  constraint session_refund_batches_name_length check (char_length(requested_by_name) between 1 and 200),
  constraint session_refund_batches_counts check (
    expected_count >= 1 and expected_total_cents >= 1 and consecutive_errors >= 0
  ),
  constraint session_refund_batches_finished_consistent check (
    (status = 'em_andamento') = (finished_at is null)
  )
);

create unique index session_refund_batches_one_open_uidx
  on public.session_refund_batches (session_id)
  where status = 'em_andamento';
create index session_refund_batches_session_idx on public.session_refund_batches (session_id, created_at desc);

-- Foto dos pedidos do lote, tirada pelo banco só da sessão do lote.
create table public.session_refund_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.session_refund_batches (id),
  order_id uuid not null references public.orders (id),
  amount_cents integer not null,
  status text not null default 'pendente',
  refund_id uuid references public.order_refunds (id),
  code text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_refund_batch_items_unique unique (batch_id, order_id),
  constraint session_refund_batch_items_status_check check (
    status in ('pendente', 'processando', 'estornado', 'em_processamento', 'falhou', 'pulado')
  ),
  constraint session_refund_batch_items_amount check (amount_cents >= 0),
  constraint session_refund_batch_items_attempts check (attempts between 0 and 20),
  constraint session_refund_batch_items_code_length check (code is null or char_length(code) between 1 and 100)
);

create index session_refund_batch_items_batch_idx on public.session_refund_batch_items (batch_id, status);
create index session_refund_batch_items_order_idx on public.session_refund_batch_items (order_id);

-- RLS: a equipe logada só lê; nenhuma política de escrita (só as funções abaixo,
-- com service_role, gravam). A pausa da fila não é lida por ninguém além do servidor.
alter table public.session_audit_log enable row level security;
alter table public.session_notices enable row level security;
alter table public.session_notice_deliveries enable row level security;
alter table public.email_quota_pause enable row level security;
alter table public.session_refund_batches enable row level security;
alter table public.session_refund_batch_items enable row level security;

revoke all on table public.session_audit_log from public, anon, authenticated;
revoke all on table public.session_notices from public, anon, authenticated;
revoke all on table public.session_notice_deliveries from public, anon, authenticated;
revoke all on table public.email_quota_pause from public, anon, authenticated;
revoke all on table public.session_refund_batches from public, anon, authenticated;
revoke all on table public.session_refund_batch_items from public, anon, authenticated;
revoke all on table public.session_audit_log from service_role;

grant select on table public.session_audit_log to authenticated;
grant select on table public.session_notices to authenticated;
grant select on table public.session_notice_deliveries to authenticated;
grant select on table public.session_refund_batches to authenticated;
grant select on table public.session_refund_batch_items to authenticated;

grant select, insert on table public.session_audit_log to service_role;
grant select, insert, update on table public.session_notices to service_role;
grant select, insert, update on table public.session_notice_deliveries to service_role;
grant select, insert, update on table public.email_quota_pause to service_role;
grant select, insert, update on table public.session_refund_batches to service_role;
grant select, insert, update on table public.session_refund_batch_items to service_role;

create policy session_audit_log_staff_read on public.session_audit_log
  for select to authenticated using (public.is_staff());
create policy session_notices_staff_read on public.session_notices
  for select to authenticated using (public.is_staff());
create policy session_notice_deliveries_staff_read on public.session_notice_deliveries
  for select to authenticated using (public.is_staff());
create policy session_refund_batches_staff_read on public.session_refund_batches
  for select to authenticated using (public.is_staff());
create policy session_refund_batch_items_staff_read on public.session_refund_batch_items
  for select to authenticated using (public.is_staff());

-- 2) Apoio -----------------------------------------------------------------------

-- Nome da pessoa da equipe (null se não for da equipe).
create function public.staff_display_name(p_staff_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(sp.display_name, 200)
  from public.staff_profiles sp
  where p_staff_user_id is not null and sp.user_id = p_staff_user_id;
$$;

-- Quem precisa saber do horário novo: pedido pago da sessão (inclui cortesia) com
-- ingresso válido, feito ANTES de uma alteração ainda não avisada a ele. "Antes" é
-- o horário que o comprador conhecia: o da primeira alteração depois da compra ou
-- do último aviso de horário que ele recebeu. Se o horário voltou ao que ele
-- conhecia, não há o que avisar.
create function public.session_schedule_recipients(p_session_id uuid)
returns table (order_id uuid, previous_starts_at timestamptz, previous_ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, c.previous_starts_at, c.previous_ends_at
  from public.orders o
  join public.event_sessions s on s.id = o.session_id
  cross join lateral (
    select sc.previous_starts_at, sc.previous_ends_at
    from public.session_schedule_changes sc
    where sc.session_id = o.session_id
      and sc.created_at > o.created_at
      and sc.created_at > coalesce((
        select max(n.created_at)
        from public.session_notice_deliveries d
        join public.session_notices n on n.id = d.notice_id
        where d.order_id = o.id and n.kind = 'alteracao_horario'
      ), '-infinity'::timestamptz)
    order by sc.created_at, sc.id
    limit 1
  ) c
  where o.session_id = p_session_id
    and o.status = 'pago'
    and s.status = 'ativa'
    and exists (
      select 1 from public.tickets t
      where t.order_id = o.id and t.status in ('pago', 'check_in')
    )
    and (c.previous_starts_at, c.previous_ends_at) is distinct from (s.starts_at, s.ends_at);
$$;

-- Pedidos que entram no "Estornar todos" (decidido só no banco): pagos ou
-- aguardando decisão, cobrados pelo provedor, com valor; também o pedido com
-- estorno já pedido e sem resposta (a nova tentativa usa a mesma chave). Entram
-- "pulados" os com entrada registrada e os com mais de 180 dias.
create function public.session_refund_candidates(p_session_id uuid)
returns table (order_id uuid, amount_cents integer, skip_code text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.total_cents,
    case
      when exists (
        select 1 from public.tickets t where t.order_id = o.id and t.status = 'check_in'
      ) then 'com_entrada'
      when coalesce(o.paid_at, o.created_at) < now() - interval '180 days' then 'prazo_180_dias'
    end,
    o.created_at
  from public.orders o
  where o.session_id = p_session_id
    and o.payment_provider = 'mercadopago'
    and o.total_cents > 0
    and (
      o.status in ('pago', 'aguardando_decisao')
      or (
        o.status = 'estornado'
        and exists (
          select 1 from public.order_refunds r
          where r.order_id = o.id and r.status = 'solicitado'
        )
      )
    );
$$;

-- Progresso de um comunicado.
create function public.session_notice_progress(p_notice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'notice_id', p_notice_id,
    'total', count(d.id),
    'sent', count(d.id) filter (where d.status = 'enviado'),
    'pending', count(d.id) filter (where d.status in ('pendente', 'enviando')),
    'failed', count(d.id) filter (where d.status = 'falhou'),
    'skipped', count(d.id) filter (where d.status = 'pulado'),
    'paused_until', (
      select q.paused_until from public.email_quota_pause q where q.paused_until > now()
    )
  )
  from public.session_notice_deliveries d
  where d.notice_id = p_notice_id;
$$;

-- 3) Resumo da sessão para o painel da equipe -------------------------------------

create function public.session_ops_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.event_sessions%rowtype;
  v_last_notice timestamptz;
  v_first_change public.session_schedule_changes%rowtype;
  v_latest_change_id uuid;
  v_schedule jsonb;
  v_notices jsonb;
  v_impact jsonb;
  v_refund jsonb;
  v_batch public.session_refund_batches%rowtype;
  v_batch_json jsonb;
begin
  select * into v_session from public.event_sessions s where s.id = p_session_id;
  if not found then
    return null;
  end if;

  -- Alteração de horário ainda sem aviso.
  select max(n.created_at) into v_last_notice
  from public.session_notices n
  where n.session_id = p_session_id and n.kind = 'alteracao_horario';

  select sc.id into v_latest_change_id
  from public.session_schedule_changes sc
  where sc.session_id = p_session_id
    and sc.created_at > coalesce(v_last_notice, '-infinity'::timestamptz)
  order by sc.created_at desc, sc.id desc
  limit 1;

  if v_latest_change_id is not null and v_session.status = 'ativa' then
    select * into v_first_change
    from public.session_schedule_changes sc
    where sc.session_id = p_session_id
      and sc.created_at > coalesce(v_last_notice, '-infinity'::timestamptz)
    order by sc.created_at, sc.id
    limit 1;
    v_schedule := jsonb_build_object(
      'change_id', v_latest_change_id,
      'previous_starts_at', v_first_change.previous_starts_at,
      'previous_ends_at', v_first_change.previous_ends_at,
      'new_starts_at', v_session.starts_at,
      'new_ends_at', v_session.ends_at,
      'recipients', (select count(*) from public.session_schedule_recipients(p_session_id))
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_notices
  from (
    select
      n.id,
      n.kind,
      n.created_at,
      n.requested_by_name,
      n.new_starts_at,
      count(d.id) as total,
      count(d.id) filter (where d.status = 'enviado') as sent,
      count(d.id) filter (where d.status in ('pendente', 'enviando')) as pending,
      count(d.id) filter (where d.status = 'falhou') as failed,
      count(d.id) filter (where d.status = 'pulado') as skipped
    from public.session_notices n
    left join public.session_notice_deliveries d on d.notice_id = n.id
    where n.session_id = p_session_id
    group by n.id
    order by n.created_at desc
    limit 10
  ) x;

  select jsonb_build_object(
    'paid_orders', count(*) filter (where o.status = 'pago' and o.total_cents > 0),
    'paid_cents', coalesce(sum(o.total_cents) filter (where o.status = 'pago' and o.total_cents > 0), 0),
    'decision_orders', count(*) filter (where o.status = 'aguardando_decisao'),
    'decision_cents', coalesce(sum(o.total_cents) filter (where o.status = 'aguardando_decisao'), 0),
    'pending_orders', count(*) filter (where o.status = 'pendente'),
    'courtesy_orders', count(*) filter (
      where o.status = 'pago' and o.total_cents = 0
        and exists (
          select 1 from public.tickets t
          where t.order_id = o.id and t.status in ('pago', 'check_in')
        )
    ),
    'checked_in_orders', count(*) filter (
      where o.status in ('pago', 'aguardando_decisao')
        and exists (select 1 from public.tickets t where t.order_id = o.id and t.status = 'check_in')
    ),
    'refunded_orders', count(*) filter (
      where o.status = 'estornado'
        and exists (
          select 1 from public.order_refunds r where r.order_id = o.id and r.status = 'concluido'
        )
    ),
    'refunded_cents', coalesce(sum(o.total_cents) filter (
      where o.status = 'estornado'
        and exists (
          select 1 from public.order_refunds r where r.order_id = o.id and r.status = 'concluido'
        )
    ), 0)
  )
  into v_impact
  from public.orders o
  where o.session_id = p_session_id;

  select jsonb_build_object(
    'orders', count(*) filter (where c.skip_code is null),
    'cents', coalesce(sum(c.amount_cents) filter (where c.skip_code is null), 0),
    'skipped_check_in', count(*) filter (where c.skip_code = 'com_entrada'),
    'skipped_deadline', count(*) filter (where c.skip_code = 'prazo_180_dias')
  )
  into v_refund
  from public.session_refund_candidates(p_session_id) c;

  select * into v_batch
  from public.session_refund_batches b
  where b.session_id = p_session_id
  order by b.created_at desc
  limit 1;
  if found then
    v_batch_json := jsonb_build_object(
      'id', v_batch.id,
      'status', v_batch.status,
      'reason', v_batch.reason,
      'requested_by_name', v_batch.requested_by_name,
      'expected_count', v_batch.expected_count,
      'expected_total_cents', v_batch.expected_total_cents,
      'consecutive_errors', v_batch.consecutive_errors,
      'created_at', v_batch.created_at,
      'finished_at', v_batch.finished_at,
      'items', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'order_id', i.order_id,
            'buyer_name', o.buyer_name,
            'amount_cents', i.amount_cents,
            'status', i.status,
            'code', i.code
          )
          order by o.created_at, i.id
        ), '[]'::jsonb)
        from public.session_refund_batch_items i
        join public.orders o on o.id = i.order_id
        where i.batch_id = v_batch.id
      )
    );
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'starts_at', v_session.starts_at,
    'cancelled_at', v_session.cancelled_at,
    'cancelled_by_name', v_session.cancelled_by_name,
    'cancel_reason', v_session.cancel_reason,
    'schedule_change', v_schedule,
    'notices', v_notices,
    'impact', v_impact,
    'refund', v_refund,
    'batch', v_batch_json,
    'email_paused_until', (
      select q.paused_until from public.email_quota_pause q where q.paused_until > now()
    )
  );
end;
$$;

-- 4) Aviso de mudança de horário ---------------------------------------------------

-- Botão "Avisar compradores": cria o comunicado da última alteração ainda não
-- avisada e uma entrega por pedido. Segundo clique (ou outra aba) devolve o mesmo
-- comunicado sem criar nada.
create function public.queue_schedule_change_notice(
  p_session_id uuid,
  p_staff_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.staff_display_name(p_staff_user_id);
  v_session public.event_sessions%rowtype;
  v_last timestamptz;
  v_change_id uuid;
  v_notice_id uuid;
  v_count integer;
begin
  if v_name is null then
    raise exception 'AVISO_EQUIPE: Acesso negado.';
  end if;

  select * into v_session from public.event_sessions s where s.id = p_session_id for update;
  if not found or v_session.archived_at is not null then
    raise exception 'AVISO_SESSAO: Sessão não encontrada.';
  end if;
  if v_session.status <> 'ativa' then
    raise exception 'AVISO_SESSAO_CANCELADA: Sessão cancelada.';
  end if;

  select max(n.created_at) into v_last
  from public.session_notices n
  where n.session_id = p_session_id and n.kind = 'alteracao_horario';

  select sc.id into v_change_id
  from public.session_schedule_changes sc
  where sc.session_id = p_session_id
    and sc.created_at > coalesce(v_last, '-infinity'::timestamptz)
  order by sc.created_at desc, sc.id desc
  limit 1;

  if v_change_id is null then
    select n.id into v_notice_id
    from public.session_notices n
    where n.session_id = p_session_id and n.kind = 'alteracao_horario'
    order by n.created_at desc
    limit 1;
    if v_notice_id is null then
      raise exception 'AVISO_SEM_ALTERACAO: Nenhuma mudança de horário para avisar.';
    end if;
    return jsonb_build_object('notice_id', v_notice_id, 'queued', 0, 'already', true);
  end if;

  -- Horário voltou ao que todos conheciam: nada a avisar (o painel esconde o botão).
  if not exists (select 1 from public.session_schedule_recipients(p_session_id)) then
    raise exception 'AVISO_SEM_DESTINATARIOS: Nenhum comprador para avisar.';
  end if;

  insert into public.session_notices (
    session_id, kind, schedule_change_id, new_starts_at, new_ends_at, requested_by, requested_by_name
  ) values (
    p_session_id, 'alteracao_horario', v_change_id, v_session.starts_at, v_session.ends_at,
    p_staff_user_id, v_name
  )
  returning id into v_notice_id;

  insert into public.session_notice_deliveries (notice_id, order_id, previous_starts_at, previous_ends_at)
  select v_notice_id, r.order_id, r.previous_starts_at, r.previous_ends_at
  from public.session_schedule_recipients(p_session_id) r
  on conflict (notice_id, order_id) do nothing;
  get diagnostics v_count = row_count;

  insert into public.session_audit_log (session_id, action, staff_user_id, staff_name, details)
  values (
    p_session_id, 'aviso_horario_pedido', p_staff_user_id, v_name,
    jsonb_build_object('pedidos', v_count, 'novo_inicio', v_session.starts_at)
  );

  return jsonb_build_object('notice_id', v_notice_id, 'queued', v_count, 'already', false);
end;
$$;

-- 5) Cancelar sessão -------------------------------------------------------------

-- Numa transação só: sessão cancelada e sem venda, pendentes cancelados (a vaga
-- volta), pagos/aguardando decisão/cortesias intactos (a portaria os recusa pela
-- sessão), auditoria e, se pedido, o comunicado de cancelamento. Devolve os
-- pedidos pendentes cancelados para o servidor encerrar as cobranças no provedor.
-- Cancelar de novo não faz nada.
create function public.cancel_event_session(
  p_session_id uuid,
  p_staff_user_id uuid,
  p_reason text,
  p_confirmation text,
  p_notify boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.staff_display_name(p_staff_user_id);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event_id uuid;
  v_session public.event_sessions%rowtype;
  v_stats jsonb;
  v_pending jsonb;
  v_notice_id uuid;
  v_queued integer := 0;
begin
  if v_name is null then
    raise exception 'CANCELAR_EQUIPE: Acesso negado.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'CANCELAR_MOTIVO: Motivo inválido.';
  end if;
  if upper(btrim(coalesce(p_confirmation, ''))) <> 'CANCELAR' then
    raise exception 'CANCELAR_CONFIRMACAO: Confirmação inválida.';
  end if;
  if p_notify is null then
    raise exception 'CANCELAR_DADOS: Dados inválidos.';
  end if;

  select s.event_id into v_event_id from public.event_sessions s where s.id = p_session_id;
  if v_event_id is null then
    raise exception 'CANCELAR_SESSAO: Sessão não encontrada.';
  end if;
  -- Ordem das travas igual à do checkout e do editor: evento → sessão.
  perform 1 from public.events e where e.id = v_event_id for share;
  select * into v_session from public.event_sessions s where s.id = p_session_id for update;
  if v_session.archived_at is not null then
    raise exception 'CANCELAR_SESSAO: Sessão não encontrada.';
  end if;
  if v_session.status = 'cancelada' then
    return jsonb_build_object(
      'already', true,
      'notice_id', (
        select n.id from public.session_notices n
        where n.session_id = p_session_id and n.kind = 'cancelamento'
      ),
      'queued', 0,
      'pending_orders', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'pagos', count(*) filter (where o.status = 'pago' and o.total_cents > 0),
    'valor_pago_centavos', coalesce(sum(o.total_cents) filter (where o.status = 'pago'), 0),
    'aguardando_decisao', count(*) filter (where o.status = 'aguardando_decisao'),
    'pendentes_cancelados', count(*) filter (where o.status = 'pendente'),
    'cortesias', count(*) filter (where o.status = 'pago' and o.total_cents = 0)
  )
  into v_stats
  from public.orders o
  where o.session_id = p_session_id;

  update public.event_sessions s
  set status = 'cancelada',
      sales_open = false,
      cancelled_at = now(),
      cancelled_by = p_staff_user_id,
      cancelled_by_name = v_name,
      cancel_reason = v_reason,
      cancel_notice_sent_at = case when p_notify then now() end,
      updated_at = now()
  where s.id = p_session_id;

  with cancelled as (
    update public.orders o
    set status = 'cancelado',
        cancel_reason = 'sessao_cancelada',
        expires_at = null
    where o.session_id = p_session_id and o.status = 'pendente'
    returning o.id, o.created_at
  ),
  void_tickets as (
    update public.tickets t
    set status = 'cancelado',
        cancelled_at = now()
    from cancelled c
    where t.order_id = c.id and t.status = 'nao_pago'
    returning t.id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', c.id, 'created_at', c.created_at) order by c.created_at),
    '[]'::jsonb
  )
  into v_pending
  from cancelled c;

  if p_notify then
    insert into public.session_notices (session_id, kind, reason, requested_by, requested_by_name)
    values (p_session_id, 'cancelamento', v_reason, p_staff_user_id, v_name)
    returning id into v_notice_id;

    insert into public.session_notice_deliveries (notice_id, order_id)
    select v_notice_id, o.id
    from public.orders o
    where o.session_id = p_session_id
      and (
        o.status = 'aguardando_decisao'
        or (
          o.status = 'pago'
          and exists (
            select 1 from public.tickets t
            where t.order_id = o.id and t.status in ('pago', 'check_in')
          )
        )
      )
    on conflict (notice_id, order_id) do nothing;
    get diagnostics v_queued = row_count;
  end if;

  insert into public.session_audit_log (session_id, action, staff_user_id, staff_name, reason, details)
  values (
    p_session_id, 'cancelada', p_staff_user_id, v_name, v_reason,
    v_stats || jsonb_build_object('avisar_compradores', p_notify)
  );
  if p_notify then
    insert into public.session_audit_log (session_id, action, staff_user_id, staff_name, details)
    values (
      p_session_id, 'aviso_cancelamento_pedido', p_staff_user_id, v_name,
      jsonb_build_object('pedidos', v_queued)
    );
  end if;

  return jsonb_build_object(
    'already', false,
    'notice_id', v_notice_id,
    'queued', v_queued,
    'pending_orders', v_pending
  );
end;
$$;

-- E-mail "Sessão cancelada — valor devolvido": um por pedido estornado de sessão
-- cancelada (um por um, em lote ou pelo aviso do provedor). Devolve null se o
-- pedido não é de sessão cancelada ou ainda não foi estornado de fato.
create function public.queue_cancellation_refund_notice(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_session public.event_sessions%rowtype;
  v_notice_id uuid;
  v_delivery_id uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    return null;
  end if;
  select * into v_session from public.event_sessions s where s.id = v_order.session_id;
  if v_session.status is distinct from 'cancelada'
    or v_order.status <> 'estornado'
    or not exists (
      select 1 from public.order_refunds r
      where r.order_id = v_order.id and r.status = 'concluido'
    ) then
    return null;
  end if;

  insert into public.session_notices (session_id, kind, reason)
  values (v_session.id, 'estorno_cancelamento', v_session.cancel_reason)
  on conflict (session_id, kind) where kind in ('cancelamento', 'estorno_cancelamento') do nothing;

  select n.id into v_notice_id
  from public.session_notices n
  where n.session_id = v_session.id and n.kind = 'estorno_cancelamento';

  insert into public.session_notice_deliveries (notice_id, order_id)
  values (v_notice_id, v_order.id)
  on conflict (notice_id, order_id) do nothing
  returning id into v_delivery_id;

  return jsonb_build_object('notice_id', v_notice_id, 'queued', v_delivery_id is not null);
end;
$$;

-- 6) Fila de e-mails da sessão ----------------------------------------------------

-- Reivindica até p_limit entregas (opcionalmente de um comunicado ou pedido), no
-- padrão do lembrete: skip locked, tentativas contadas, entrega presa há 10 min
-- volta para a fila. Com a fila pausada pela cota, não devolve nada. Antes, marca
-- como "pulado" o que deixou de fazer sentido (pedido estornado, sessão cancelada,
-- aviso de horário já substituído por um mais novo para o mesmo pedido).
create function public.claim_session_notice_deliveries(
  p_limit integer,
  p_notice_id uuid default null,
  p_order_id uuid default null
)
returns table (
  delivery_id uuid,
  notice_id uuid,
  kind text,
  order_id uuid,
  public_token text,
  buyer_name text,
  buyer_email text,
  total_cents integer,
  event_name text,
  event_venue text,
  session_name text,
  session_starts_at timestamptz,
  session_ends_at timestamptz,
  previous_starts_at timestamptz,
  previous_ends_at timestamptz,
  reason text,
  refund_amount_cents integer,
  tickets jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'AVISO_LIMITE_INVALIDO';
  end if;
  if exists (select 1 from public.email_quota_pause q where q.paused_until > now()) then
    return;
  end if;

  update public.session_notice_deliveries d
  set status = 'falhou',
      error_code = coalesce(d.error_code, 'sem_confirmacao'),
      updated_at = now()
  where d.status = 'enviando'
    and d.claimed_at < now() - interval '10 minutes'
    and d.attempts >= 3;

  update public.session_notice_deliveries d
  set status = 'pulado', updated_at = now()
  from public.session_notices n, public.orders o, public.event_sessions s
  where n.id = d.notice_id
    and o.id = d.order_id
    and s.id = n.session_id
    and d.status = 'pendente'
    and (p_notice_id is null or d.notice_id = p_notice_id)
    and (p_order_id is null or d.order_id = p_order_id)
    and (
      (n.kind = 'alteracao_horario' and (o.status <> 'pago' or s.status <> 'ativa'))
      or (
        n.kind = 'alteracao_horario'
        and exists (
          select 1
          from public.session_notice_deliveries d2
          join public.session_notices n2 on n2.id = d2.notice_id
          where d2.order_id = d.order_id
            and n2.kind = 'alteracao_horario'
            and n2.created_at > n.created_at
        )
      )
      or (n.kind = 'cancelamento' and o.status not in ('pago', 'aguardando_decisao'))
    );

  return query
  with picked as (
    select d.id
    from public.session_notice_deliveries d
    where (
        d.status = 'pendente'
        or (d.status = 'enviando' and d.claimed_at < now() - interval '10 minutes')
      )
      and d.attempts < 3
      and (p_notice_id is null or d.notice_id = p_notice_id)
      and (p_order_id is null or d.order_id = p_order_id)
    order by d.created_at, d.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.session_notice_deliveries d
    set status = 'enviando',
        attempts = d.attempts + 1,
        claimed_at = now(),
        updated_at = now()
    from picked p
    where d.id = p.id
    returning d.id, d.notice_id, d.order_id, d.previous_starts_at, d.previous_ends_at, d.created_at
  )
  select
    c.id,
    n.id,
    n.kind,
    o.id,
    o.public_token,
    o.buyer_name,
    o.buyer_email,
    o.total_cents,
    e.name,
    e.venue,
    s.name,
    s.starts_at,
    s.ends_at,
    c.previous_starts_at,
    c.previous_ends_at,
    coalesce(n.reason, s.cancel_reason),
    (
      select r.amount_cents from public.order_refunds r
      where r.order_id = o.id and r.status = 'concluido'
      limit 1
    ),
    case when n.kind = 'estorno_cancelamento' then coalesce((
      select jsonb_agg(
        jsonb_build_object('holder_name', t.buyer_name, 'kind', t.kind, 'item_name', oi.name)
        order by t.created_at, t.id
      )
      from public.tickets t
      left join public.order_items oi on oi.id = t.order_item_id
      where t.order_id = o.id and t.status = 'estornado'
    ), '[]'::jsonb) end
  from claimed c
  join public.session_notices n on n.id = c.notice_id
  join public.orders o on o.id = c.order_id
  join public.event_sessions s on s.id = n.session_id
  join public.events e on e.id = s.event_id
  order by c.created_at, c.id;
end;
$$;

create function public.mark_session_notice_sent(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.session_notice_deliveries d
  set status = 'enviado', sent_at = now(), error_code = null, updated_at = now()
  where d.id = p_delivery_id and d.status = 'enviando';
  return found;
end;
$$;

-- Envio que falhou volta para a fila (até 3 tentativas). p_quota = parou pela cota
-- diária: não conta como tentativa.
create function public.release_session_notice_delivery(
  p_delivery_id uuid,
  p_error_code text,
  p_quota boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.session_notice_deliveries d
  set status = case
        when coalesce(p_quota, false) then 'pendente'
        when d.attempts >= 3 then 'falhou'
        else 'pendente'
      end,
      attempts = case when coalesce(p_quota, false) then greatest(d.attempts - 1, 0) else d.attempts end,
      error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'desconhecido'), 100),
      claimed_at = null,
      updated_at = now()
  where d.id = p_delivery_id and d.status = 'enviando'
  returning d.status into v_status;
  return coalesce(v_status, 'noop');
end;
$$;

-- Pausa a fila até a cota renovar (no máximo 26 h à frente).
create function public.pause_session_notice_emails(p_until timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_until is null or p_until <= now() or p_until > now() + interval '26 hours' then
    raise exception 'AVISO_PAUSA_INVALIDA';
  end if;
  insert into public.email_quota_pause as q (id, paused_until, updated_at)
  values (true, p_until, now())
  on conflict (id) do update
    set paused_until = greatest(q.paused_until, excluded.paused_until),
        updated_at = now();
  return p_until;
end;
$$;

-- "Tentar de novo": entregas que falharam voltam para a fila.
create function public.retry_failed_session_notices(
  p_notice_id uuid,
  p_staff_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if public.staff_display_name(p_staff_user_id) is null then
    raise exception 'AVISO_EQUIPE: Acesso negado.';
  end if;
  update public.session_notice_deliveries d
  set status = 'pendente', attempts = 0, error_code = null, claimed_at = null, updated_at = now()
  where d.notice_id = p_notice_id and d.status = 'falhou';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 7) "Estornar todos" ---------------------------------------------------------------

-- Cria o lote. O total e a lista de pedidos são calculados aqui e o valor
-- digitado pela equipe precisa bater com o total calculado (LOTE_TOTAL_MUDOU:<total>).
-- Lote já aberto na sessão: devolve o mesmo, sem criar outro.
create function public.start_session_refund_batch(
  p_session_id uuid,
  p_staff_user_id uuid,
  p_reason text,
  p_confirm_total_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.staff_display_name(p_staff_user_id);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_session public.event_sessions%rowtype;
  v_open public.session_refund_batches%rowtype;
  v_count integer;
  v_total bigint;
  v_skipped integer;
  v_batch_id uuid;
begin
  if v_name is null then
    raise exception 'LOTE_EQUIPE: Acesso negado.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'LOTE_MOTIVO: Motivo inválido.';
  end if;

  select * into v_session from public.event_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'LOTE_SESSAO: Sessão não encontrada.';
  end if;
  if v_session.status <> 'cancelada' then
    raise exception 'LOTE_SESSAO_ATIVA: Só sessão cancelada.';
  end if;

  select * into v_open
  from public.session_refund_batches b
  where b.session_id = p_session_id and b.status = 'em_andamento';
  if found then
    return jsonb_build_object(
      'batch_id', v_open.id,
      'already', true,
      'expected_count', v_open.expected_count,
      'expected_total_cents', v_open.expected_total_cents
    );
  end if;

  select count(*) filter (where c.skip_code is null),
         coalesce(sum(c.amount_cents) filter (where c.skip_code is null), 0),
         count(*) filter (where c.skip_code is not null)
  into v_count, v_total, v_skipped
  from public.session_refund_candidates(p_session_id) c;

  if v_count = 0 then
    raise exception 'LOTE_VAZIO: Nenhum pedido para estornar.';
  end if;
  if p_confirm_total_cents is distinct from v_total then
    raise exception 'LOTE_TOTAL_MUDOU:%', v_total;
  end if;

  insert into public.session_refund_batches (
    session_id, reason, requested_by, requested_by_name, expected_count, expected_total_cents
  ) values (
    p_session_id, v_reason, p_staff_user_id, v_name, v_count, v_total
  )
  returning id into v_batch_id;

  insert into public.session_refund_batch_items (batch_id, order_id, amount_cents, status, code)
  select v_batch_id, c.order_id, c.amount_cents,
    case when c.skip_code is null then 'pendente' else 'pulado' end,
    c.skip_code
  from public.session_refund_candidates(p_session_id) c;

  insert into public.session_audit_log (session_id, action, staff_user_id, staff_name, reason, details)
  values (
    p_session_id, 'lote_estorno_iniciado', p_staff_user_id, v_name, v_reason,
    jsonb_build_object('pedidos', v_count, 'valor_centavos', v_total, 'pulados', v_skipped)
  );

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'already', false,
    'expected_count', v_count,
    'expected_total_cents', v_total
  );
end;
$$;

-- Próximo pedido do lote, um por vez: com outro pedido sendo estornado há menos
-- de 2 min (outra aba), devolve "busy". Confere de novo o pedido antes de entregar
-- (já estornado, mudou de estado ou teve entrada → pulado). Sem nada pendente,
-- fecha o lote. Item preso em "processando" há 2 min volta (mesma chave no provedor).
create function public.claim_session_refund_item(
  p_batch_id uuid,
  p_staff_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.staff_display_name(p_staff_user_id);
  v_batch public.session_refund_batches%rowtype;
  v_item public.session_refund_batch_items%rowtype;
  v_order public.orders%rowtype;
  v_status text;
begin
  if v_name is null then
    raise exception 'LOTE_EQUIPE: Acesso negado.';
  end if;

  select * into v_batch from public.session_refund_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'LOTE_NAO_ENCONTRADO: Lote não encontrado.';
  end if;
  if v_batch.status <> 'em_andamento' then
    return jsonb_build_object('state', 'done', 'status', v_batch.status);
  end if;
  if exists (
    select 1 from public.session_refund_batch_items i
    where i.batch_id = p_batch_id
      and i.status = 'processando'
      and i.claimed_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('state', 'busy');
  end if;

  loop
    select i.* into v_item
    from public.session_refund_batch_items i
    join public.orders o on o.id = i.order_id
    where i.batch_id = p_batch_id
      and (
        i.status = 'pendente'
        or (i.status = 'processando' and i.claimed_at <= now() - interval '2 minutes')
      )
    order by o.created_at, i.id
    limit 1
    for update of i;

    if not found then
      v_status := case
        when exists (
          select 1 from public.session_refund_batch_items i
          where i.batch_id = p_batch_id and i.status = 'falhou'
        ) then 'concluido_com_falhas'
        else 'concluido'
      end;
      update public.session_refund_batches b
      set status = v_status, finished_at = now(), updated_at = now()
      where b.id = p_batch_id;
      insert into public.session_audit_log (session_id, action, staff_user_id, staff_name, details)
      select v_batch.session_id, 'lote_estorno_concluido', p_staff_user_id, v_name,
        jsonb_build_object(
          'estornados', count(*) filter (where i.status = 'estornado'),
          'em_processamento', count(*) filter (where i.status = 'em_processamento'),
          'falharam', count(*) filter (where i.status = 'falhou'),
          'pulados', count(*) filter (where i.status = 'pulado')
        )
      from public.session_refund_batch_items i
      where i.batch_id = p_batch_id;
      return jsonb_build_object('state', 'done', 'status', v_status);
    end if;

    select * into v_order from public.orders o where o.id = v_item.order_id;

    if v_order.session_id is distinct from v_batch.session_id then
      update public.session_refund_batch_items i
      set status = 'pulado', code = 'sessao_diferente', updated_at = now()
      where i.id = v_item.id;
      continue;
    end if;
    if v_order.status = 'estornado' and not exists (
      select 1 from public.order_refunds r where r.order_id = v_order.id and r.status = 'solicitado'
    ) then
      update public.session_refund_batch_items i
      set status = 'pulado',
          code = 'ja_estornado',
          refund_id = (
            select r.id from public.order_refunds r
            where r.order_id = v_order.id and r.status = 'concluido'
            limit 1
          ),
          updated_at = now()
      where i.id = v_item.id;
      continue;
    end if;
    if v_order.status not in ('pago', 'aguardando_decisao', 'estornado') then
      update public.session_refund_batch_items i
      set status = 'pulado', code = 'status_mudou', updated_at = now()
      where i.id = v_item.id;
      continue;
    end if;
    if exists (
      select 1 from public.tickets t where t.order_id = v_order.id and t.status = 'check_in'
    ) then
      update public.session_refund_batch_items i
      set status = 'pulado', code = 'com_entrada', updated_at = now()
      where i.id = v_item.id;
      continue;
    end if;

    update public.session_refund_batch_items i
    set status = 'processando',
        attempts = least(i.attempts + 1, 20),
        claimed_at = now(),
        updated_at = now()
    where i.id = v_item.id;

    return jsonb_build_object(
      'state', 'item',
      'item_id', v_item.id,
      'order_id', v_item.order_id,
      'reason', v_batch.reason
    );
  end loop;
end;
$$;

-- Resultado do estorno do item. "pendente" = erro temporário (tenta de novo com a
-- mesma chave); depois de 3 tentativas vira "falhou". Erros temporários seguidos
-- ficam contados no lote para a tela pausar.
create function public.finish_session_refund_item(
  p_item_id uuid,
  p_status text,
  p_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.session_refund_batch_items%rowtype;
  v_status text := p_status;
  v_code text := left(nullif(btrim(coalesce(p_code, '')), ''), 100);
  v_errors integer;
begin
  if p_status is null
    or p_status not in ('estornado', 'em_processamento', 'falhou', 'pulado', 'pendente') then
    raise exception 'LOTE_DADOS: Resultado inválido.';
  end if;

  select * into v_item from public.session_refund_batch_items i where i.id = p_item_id for update;
  if not found then
    raise exception 'LOTE_NAO_ENCONTRADO: Item não encontrado.';
  end if;
  if v_item.status <> 'processando' then
    select b.consecutive_errors into v_errors
    from public.session_refund_batches b where b.id = v_item.batch_id;
    return jsonb_build_object('status', v_item.status, 'noop', true, 'consecutive_errors', v_errors);
  end if;

  if v_status = 'pendente' and v_item.attempts >= 3 then
    v_status := 'falhou';
    v_code := coalesce(v_code, 'tentativas_esgotadas');
  end if;

  update public.session_refund_batch_items i
  set status = v_status,
      code = case when v_status in ('estornado', 'em_processamento') then null else v_code end,
      refund_id = case
        when v_status in ('estornado', 'em_processamento') then (
          select r.id from public.order_refunds r
          where r.order_id = v_item.order_id and r.status in ('solicitado', 'concluido')
          limit 1
        )
        else i.refund_id
      end,
      claimed_at = case when v_status = 'pendente' then null else i.claimed_at end,
      updated_at = now()
  where i.id = v_item.id;

  update public.session_refund_batches b
  set consecutive_errors = case
        when p_status = 'pendente' then b.consecutive_errors + 1
        when v_status in ('estornado', 'em_processamento') then 0
        else b.consecutive_errors
      end,
      updated_at = now()
  where b.id = v_item.batch_id
  returning b.consecutive_errors into v_errors;

  return jsonb_build_object('status', v_status, 'noop', false, 'consecutive_errors', v_errors);
end;
$$;

-- "Tentar de novo os que falharam": volta só os itens que falharam e reabre o lote.
create function public.retry_session_refund_failures(
  p_batch_id uuid,
  p_staff_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.staff_display_name(p_staff_user_id);
  v_batch public.session_refund_batches%rowtype;
  v_count integer;
begin
  if v_name is null then
    raise exception 'LOTE_EQUIPE: Acesso negado.';
  end if;
  select * into v_batch from public.session_refund_batches b where b.id = p_batch_id for update;
  if not found then
    raise exception 'LOTE_NAO_ENCONTRADO: Lote não encontrado.';
  end if;
  -- Mesma ordem de travas do início do lote: sessão antes de abrir lote nela.
  perform 1 from public.event_sessions s where s.id = v_batch.session_id for update;

  if v_batch.status <> 'em_andamento' and exists (
    select 1 from public.session_refund_batches b
    where b.session_id = v_batch.session_id and b.status = 'em_andamento' and b.id <> v_batch.id
  ) then
    raise exception 'LOTE_OUTRO_ABERTO: Já há estornos em andamento nesta sessão.';
  end if;

  update public.session_refund_batch_items i
  set status = 'pendente', attempts = 0, code = null, claimed_at = null, updated_at = now()
  where i.batch_id = p_batch_id and i.status = 'falhou';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return 0;
  end if;

  update public.session_refund_batches b
  set status = 'em_andamento', finished_at = null, consecutive_errors = 0, updated_at = now()
  where b.id = p_batch_id;

  insert into public.session_audit_log (session_id, action, staff_user_id, staff_name, details)
  values (
    v_batch.session_id, 'lote_estorno_retomado', p_staff_user_id, v_name,
    jsonb_build_object('pedidos', v_count)
  );
  return v_count;
end;
$$;

-- 8) Permissões ---------------------------------------------------------------------

revoke all on function public.staff_display_name(uuid) from public, anon, authenticated;
revoke all on function public.session_schedule_recipients(uuid) from public, anon, authenticated;
revoke all on function public.session_refund_candidates(uuid) from public, anon, authenticated;
revoke all on function public.session_notice_progress(uuid) from public, anon, authenticated;
revoke all on function public.session_ops_summary(uuid) from public, anon, authenticated;
revoke all on function public.queue_schedule_change_notice(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_event_session(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.queue_cancellation_refund_notice(uuid) from public, anon, authenticated;
revoke all on function public.claim_session_notice_deliveries(integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_session_notice_sent(uuid) from public, anon, authenticated;
revoke all on function public.release_session_notice_delivery(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.pause_session_notice_emails(timestamptz) from public, anon, authenticated;
revoke all on function public.retry_failed_session_notices(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_session_refund_batch(uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.claim_session_refund_item(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_session_refund_item(uuid, text, text) from public, anon, authenticated;
revoke all on function public.retry_session_refund_failures(uuid, uuid) from public, anon, authenticated;

grant execute on function public.staff_display_name(uuid) to service_role;
grant execute on function public.session_schedule_recipients(uuid) to service_role;
grant execute on function public.session_refund_candidates(uuid) to service_role;
grant execute on function public.session_notice_progress(uuid) to service_role;
grant execute on function public.session_ops_summary(uuid) to service_role;
grant execute on function public.queue_schedule_change_notice(uuid, uuid) to service_role;
grant execute on function public.cancel_event_session(uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.queue_cancellation_refund_notice(uuid) to service_role;
grant execute on function public.claim_session_notice_deliveries(integer, uuid, uuid) to service_role;
grant execute on function public.mark_session_notice_sent(uuid) to service_role;
grant execute on function public.release_session_notice_delivery(uuid, text, boolean) to service_role;
grant execute on function public.pause_session_notice_emails(timestamptz) to service_role;
grant execute on function public.retry_failed_session_notices(uuid, uuid) to service_role;
grant execute on function public.start_session_refund_batch(uuid, uuid, text, bigint) to service_role;
grant execute on function public.claim_session_refund_item(uuid, uuid) to service_role;
grant execute on function public.finish_session_refund_item(uuid, text, text) to service_role;
grant execute on function public.retry_session_refund_failures(uuid, uuid) to service_role;
