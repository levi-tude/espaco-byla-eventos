-- Fase 3 (estorno) da spec 2026-10-01-estorno-tipos-carrinho: registro de estornos
-- do pedido inteiro, com quem, quando e motivo. O pedido e os ingressos ficam
-- "estornado" assim que o estorno é pedido (fecha a corrida com o check-in) e
-- voltam ao estado anterior se o provedor recusar. Usa os enums da fase 2.

create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  amount_cents integer not null check (amount_cents > 0),
  status public.refund_status not null default 'solicitado',
  idempotency_key text not null unique,
  previous_order_status public.order_status not null,
  -- { ticket_id: status } antes do estorno, para restaurar exatamente se falhar.
  previous_ticket_statuses jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users (id) on delete set null,
  -- Nome guardado no momento: o histórico continua legível se a conta sair da equipe.
  requested_by_name text,
  reason text not null,
  provider_refund_id text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint order_refunds_idempotency_key_is_id check (idempotency_key = id::text),
  constraint order_refunds_reason_length check (char_length(btrim(reason)) between 5 and 500),
  constraint order_refunds_requester check (
    requested_by_name is not null or reason = 'Estornado fora do site'
  ),
  constraint order_refunds_text_lengths check (
    (requested_by_name is null or char_length(requested_by_name) <= 200)
    and (provider_refund_id is null or char_length(provider_refund_id) between 1 and 100)
    and (error_code is null or char_length(error_code) between 1 and 100)
  ),
  constraint order_refunds_completed_consistent check (
    (status = 'concluido') = (completed_at is not null)
  ),
  constraint order_refunds_previous_tickets_object check (
    jsonb_typeof(previous_ticket_statuses) = 'object'
  )
);

-- Um estorno ativo por pedido; "falhou" permite nova tentativa (com chave nova).
create unique index order_refunds_one_active_uidx
  on public.order_refunds (order_id)
  where status in ('solicitado', 'concluido');

create index order_refunds_order_created_idx
  on public.order_refunds (order_id, created_at);

alter table public.order_refunds enable row level security;
revoke all on table public.order_refunds from public, anon, authenticated;
grant select on table public.order_refunds to authenticated;
grant select, insert, update on table public.order_refunds to service_role;

-- Leitura só para a equipe; escrita só pelas funções abaixo (service_role).
create policy order_refunds_staff_read on public.order_refunds
  for select to authenticated
  using (public.is_staff());

-- v2: um lugar estornado continua ocupado enquanto o dinheiro não voltou
-- (estorno "solicitado"), mas só se o ingresso ocupava lugar antes do estorno.
create or replace function public.event_occupied_count(
  p_event_id uuid,
  p_exclude_order_id uuid default null
)
returns bigint
language sql
stable
set search_path = ''
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
      or (
        t.status = 'estornado'
        and exists (
          select 1
          from public.order_refunds r
          where r.order_id = t.order_id
            and r.status = 'solicitado'
            and r.previous_ticket_statuses ->> t.id::text = 'pago'
        )
      )
    );
$$;

-- Erros com prefixo estável (ESTORNO_*) para a ação traduzir em mensagem clara.
create function public.begin_order_refund(
  p_order_id uuid,
  p_staff_user_id uuid,
  p_reason text
)
returns table (
  refund_id uuid,
  idempotency_key text,
  amount_cents integer,
  provider_order_id text,
  already_requested boolean
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order public.orders%rowtype;
  v_refund public.order_refunds%rowtype;
  v_staff_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_refund_id uuid := gen_random_uuid();
  v_previous jsonb;
begin
  select sp.display_name into v_staff_name
  from public.staff_profiles sp
  where sp.user_id = p_staff_user_id;
  if p_staff_user_id is null or v_staff_name is null then
    raise exception 'ESTORNO_EQUIPE: Acesso restrito à equipe.';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ESTORNO_PEDIDO: Pedido não encontrado.';
  end if;

  -- Trava os ingressos: o check-in só muda ingresso "pago", então quem travar primeiro vence.
  perform 1 from public.tickets t where t.order_id = v_order.id order by t.id for update;

  -- Segundo clique ou outra aba: devolve o mesmo estorno, com a mesma chave.
  select * into v_refund
  from public.order_refunds r
  where r.order_id = v_order.id and r.status = 'solicitado';
  if found then
    return query select v_refund.id, v_refund.idempotency_key, v_refund.amount_cents,
      v_order.provider_order_id, true;
    return;
  end if;

  if v_order.status = 'estornado' then
    raise exception 'ESTORNO_JA_FEITO: Este pedido já foi estornado.';
  end if;
  if v_order.payment_provider is distinct from 'mercadopago' or v_order.total_cents <= 0 then
    raise exception 'ESTORNO_PROVEDOR: Estorno pelo site indisponível para este pedido.';
  end if;
  if v_order.status not in ('pago', 'aguardando_decisao') then
    raise exception 'ESTORNO_STATUS: Só pedidos pagos podem ser estornados.';
  end if;
  if exists (
    select 1 from public.tickets t
    where t.order_id = v_order.id and t.status = 'check_in'
  ) then
    raise exception 'ESTORNO_CHECK_IN: Há ingresso com entrada registrada.';
  end if;
  if coalesce(v_order.paid_at, v_order.created_at) < now() - interval '180 days' then
    raise exception 'ESTORNO_PRAZO: Prazo de estorno encerrado.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'ESTORNO_MOTIVO: Motivo inválido.';
  end if;

  select coalesce(jsonb_object_agg(t.id::text, t.status::text), '{}'::jsonb)
  into v_previous
  from public.tickets t
  where t.order_id = v_order.id and t.status in ('pago', 'nao_pago', 'cancelado');

  insert into public.order_refunds (
    id, order_id, amount_cents, status, idempotency_key, previous_order_status,
    previous_ticket_statuses, requested_by, requested_by_name, reason
  ) values (
    v_refund_id, v_order.id, v_order.total_cents, 'solicitado', v_refund_id::text, v_order.status,
    v_previous, p_staff_user_id, v_staff_name, v_reason
  );

  update public.orders o
  set status = 'estornado',
      expires_at = null
  where o.id = v_order.id;

  update public.tickets t
  set status = 'estornado'
  where t.order_id = v_order.id and t.status in ('pago', 'nao_pago', 'cancelado');

  return query select v_refund_id, v_refund_id::text, v_order.total_cents,
    v_order.provider_order_id, false;
end;
$$;

-- Provedor confirmou a devolução. Idempotente: só o primeiro devolve 'completed'
-- (é ele que dispara o e-mail ao comprador).
create function public.complete_order_refund(
  p_refund_id uuid,
  p_provider_refund_id text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_refund public.order_refunds%rowtype;
  v_provider_refund_id text := nullif(btrim(p_provider_refund_id), '');
begin
  select r.order_id into v_order_id from public.order_refunds r where r.id = p_refund_id;
  if v_order_id is null then
    raise exception 'Estorno não encontrado.';
  end if;

  perform 1 from public.orders o where o.id = v_order_id for update;
  select * into v_refund from public.order_refunds r where r.id = p_refund_id for update;

  if v_refund.status <> 'solicitado' then
    return 'noop';
  end if;

  update public.order_refunds r
  set status = 'concluido',
      completed_at = now(),
      provider_refund_id = case
        when char_length(v_provider_refund_id) <= 100 then v_provider_refund_id
      end
  where r.id = v_refund.id;

  return 'completed';
end;
$$;

-- Provedor recusou de forma definitiva: pedido e ingressos voltam exatamente
-- ao que eram antes do estorno.
create function public.fail_order_refund(
  p_refund_id uuid,
  p_error_code text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_refund public.order_refunds%rowtype;
begin
  select r.order_id into v_order_id from public.order_refunds r where r.id = p_refund_id;
  if v_order_id is null then
    raise exception 'Estorno não encontrado.';
  end if;

  perform 1 from public.orders o where o.id = v_order_id for update;
  select * into v_refund from public.order_refunds r where r.id = p_refund_id for update;

  if v_refund.status <> 'solicitado' then
    return 'noop';
  end if;

  update public.order_refunds r
  set status = 'falhou',
      error_code = coalesce(left(nullif(btrim(p_error_code), ''), 100), 'desconhecido')
  where r.id = v_refund.id;

  update public.orders o
  set status = v_refund.previous_order_status
  where o.id = v_refund.order_id and o.status = 'estornado';

  update public.tickets t
  set status = (v_refund.previous_ticket_statuses ->> t.id::text)::public.ticket_status
  where t.order_id = v_refund.order_id
    and t.status = 'estornado'
    and v_refund.previous_ticket_statuses ? t.id::text;

  return 'failed';
end;
$$;

-- Aviso ou consulta do provedor dizendo que a order foi estornada:
-- 'completed' (concluiu o estorno pedido pelo site), 'external' (estorno feito fora
-- do site; registra e marca o pedido), 'other_order' (outra cobrança do mesmo
-- pedido; não mexe em nada) ou 'noop'.
create function public.sync_order_refunded(
  p_provider text,
  p_external_id text,
  p_provider_order_id text default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.order_refunds%rowtype;
  v_provider_order_id text := nullif(btrim(p_provider_order_id), '');
  v_refund_id uuid := gen_random_uuid();
  v_previous jsonb;
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
  if v_provider_order_id is not null
    and v_order.provider_order_id is not null
    and v_order.provider_order_id <> v_provider_order_id then
    return 'other_order';
  end if;

  perform 1 from public.tickets t where t.order_id = v_order.id order by t.id for update;

  select * into v_refund
  from public.order_refunds r
  where r.order_id = v_order.id and r.status = 'solicitado'
  for update;
  if found then
    update public.order_refunds r
    set status = 'concluido', completed_at = now()
    where r.id = v_refund.id;
    if v_provider_order_id is not null and v_order.provider_order_id is null
      and char_length(v_provider_order_id) <= 100 then
      update public.orders o set provider_order_id = v_provider_order_id where o.id = v_order.id;
    end if;
    return 'completed';
  end if;

  if exists (
    select 1 from public.order_refunds r
    where r.order_id = v_order.id and r.status = 'concluido'
  ) then
    return 'noop';
  end if;
  if v_order.status not in ('pago', 'aguardando_decisao') or v_order.total_cents <= 0 then
    return 'noop';
  end if;

  select coalesce(jsonb_object_agg(t.id::text, t.status::text), '{}'::jsonb)
  into v_previous
  from public.tickets t
  where t.order_id = v_order.id and t.status in ('pago', 'nao_pago', 'cancelado');

  insert into public.order_refunds (
    id, order_id, amount_cents, status, idempotency_key, previous_order_status,
    previous_ticket_statuses, requested_by, requested_by_name, reason, completed_at
  ) values (
    v_refund_id, v_order.id, v_order.total_cents, 'concluido', v_refund_id::text, v_order.status,
    v_previous, null, null, 'Estornado fora do site', now()
  );

  update public.orders o
  set status = 'estornado',
      expires_at = null,
      provider_order_id = coalesce(
        o.provider_order_id,
        case when char_length(v_provider_order_id) <= 100 then v_provider_order_id end
      )
  where o.id = v_order.id;

  -- Ingresso que já entrou continua "check_in" (histórico da portaria).
  update public.tickets t
  set status = 'estornado'
  where t.order_id = v_order.id and t.status in ('pago', 'nao_pago', 'cancelado');

  return 'external';
end;
$$;

revoke all on function public.event_occupied_count(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.begin_order_refund(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_order_refund(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_order_refund(uuid, text)
  from public, anon, authenticated;
revoke all on function public.sync_order_refunded(text, text, text)
  from public, anon, authenticated;

grant execute on function public.event_occupied_count(uuid, uuid)
  to service_role;
grant execute on function public.begin_order_refund(uuid, uuid, text)
  to service_role;
grant execute on function public.complete_order_refund(uuid, text)
  to service_role;
grant execute on function public.fail_order_refund(uuid, text)
  to service_role;
grant execute on function public.sync_order_refunded(text, text, text)
  to service_role;
