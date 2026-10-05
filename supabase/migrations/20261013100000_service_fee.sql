-- Taxa de serviço (spec 2026-10-04-taxa-servico-design, aprovada em 2026-10-04).
--
-- ADITIVA e compatível com o código no ar (c54b7e8): a taxa entra DESLIGADA, colunas
-- novas têm padrão, nada é renomeado ou apagado, e create_checkout_order mantém os
-- parâmetros nomeados atuais (só ganha dois opcionais). Pedidos antigos ficam com
-- taxa 0 e subtotal = total. Todas as contas da equipe começam como 'secretaria':
-- nada do que existe depende de papel; só o financeiro novo exige 'admin'.
--
-- Tabelas novas: RLS ligada e sem políticas (só service_role, por funções). Repasses e
-- contestações são imutáveis (correção = novo lançamento de ajuste/reversão).

-- 1) Papéis da equipe ------------------------------------------------------------

alter table public.staff_profiles
  add column role text not null default 'secretaria',
  add column is_developer boolean not null default false;

alter table public.staff_profiles
  add constraint staff_profiles_role_check check (role in ('admin', 'secretaria'));

-- Papel e marca do desenvolvedor só mudam pelo dono no painel do banco.
revoke insert, update, delete on table public.staff_profiles from anon, authenticated;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.role = 'admin'
  );
$$;

-- 'admin', 'admin_dev' (Admin que é a conta do desenvolvedor: vê, não grava),
-- 'secretaria' ou null (fora da equipe).
create function public.staff_finance_role(p_staff_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when sp.role = 'admin' and sp.is_developer then 'admin_dev'
    when sp.role = 'admin' then 'admin'
    else 'secretaria'
  end
  from public.staff_profiles sp
  where p_staff_user_id is not null and sp.user_id = p_staff_user_id;
$$;

-- 2) Configuração vigente (linha única, DESLIGADA) --------------------------------

create table public.service_fee_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  rate_bps integer not null default 500 check (rate_bps between 0 and 2000),
  min_cents integer not null default 100 check (min_cents between 0 and 1000),
  updated_at timestamptz not null default now()
);

insert into public.service_fee_settings (id) values (1);

alter table public.service_fee_settings enable row level security;
revoke all on table public.service_fee_settings from public, anon, authenticated, service_role;
grant select on table public.service_fee_settings to service_role;

create function public.service_fee_settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger service_fee_settings_touch
  before update on public.service_fee_settings
  for each row execute function public.service_fee_settings_touch();

-- Fórmula (fonte da verdade; src/lib/domain/service-fee.ts repete só para exibir):
-- max(mínimo, preço × percentual, meio-para-cima ao centavo). Preço ≤ 0 = 0.
create function public.service_fee_for_price(
  p_price_cents integer,
  p_rate_bps integer,
  p_min_cents integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price_cents is null or p_price_cents <= 0 then 0
    else greatest(
      coalesce(p_min_cents, 0),
      ((p_price_cents::bigint * coalesce(p_rate_bps, 0) + 5000) / 10000)::integer
    )
  end;
$$;

create function public.service_fee_policy()
returns table (enabled boolean, rate_bps integer, min_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.enabled, s.rate_bps, s.min_cents
  from public.service_fee_settings s
  where s.id = 1;
$$;

-- 3) Pedido e itens -----------------------------------------------------------------

alter table public.orders
  add column tickets_subtotal_cents integer,
  add column service_fee_cents integer not null default 0,
  add column service_fee_rate_bps integer not null default 0,
  add column service_fee_min_cents integer not null default 0;

update public.orders set tickets_subtotal_cents = total_cents where tickets_subtotal_cents is null;

-- Funções antigas (ex.: issue_courtesy_ticket) não conhecem o subtotal.
create function public.orders_fill_fee_subtotal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tickets_subtotal_cents is null then
    new.tickets_subtotal_cents := new.total_cents - coalesce(new.service_fee_cents, 0);
  end if;
  return new;
end;
$$;

create trigger orders_fill_fee_subtotal
  before insert on public.orders
  for each row execute function public.orders_fill_fee_subtotal();

alter table public.orders alter column tickets_subtotal_cents set not null;

alter table public.orders
  add constraint orders_fee_total_check
    check (total_cents = tickets_subtotal_cents + service_fee_cents),
  add constraint orders_fee_values_check
    check (
      service_fee_cents >= 0
      and service_fee_rate_bps between 0 and 2000
      and service_fee_min_cents between 0 and 1000
    );

-- Valores gravados na compra não mudam depois.
create function public.orders_fee_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.total_cents is distinct from old.total_cents
    or new.tickets_subtotal_cents is distinct from old.tickets_subtotal_cents
    or new.service_fee_cents is distinct from old.service_fee_cents
    or new.service_fee_rate_bps is distinct from old.service_fee_rate_bps
    or new.service_fee_min_cents is distinct from old.service_fee_min_cents then
    raise exception 'TAXA_IMUTAVEL: Valores do pedido não podem ser alterados.';
  end if;
  return new;
end;
$$;

create trigger orders_fee_immutable
  before update on public.orders
  for each row execute function public.orders_fee_immutable();

alter table public.order_items
  add column service_fee_unit_cents integer not null default 0,
  add column service_fee_total_cents integer not null default 0;

alter table public.order_items
  add constraint order_items_fee_check
    check (service_fee_unit_cents >= 0 and service_fee_total_cents = service_fee_unit_cents * quantity);

-- 4) Contestações e repasses (imutáveis) -------------------------------------------

create table public.order_chargebacks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  kind text not null check (kind in ('contestacao', 'reversao')),
  amount_cents integer not null check (amount_cents >= 0),
  fee_cents integer not null check (fee_cents >= 0),
  source text not null check (source in ('manual', 'automatico')),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index order_chargebacks_order_idx on public.order_chargebacks (order_id, created_at desc);

create table public.service_fee_payouts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('repasse', 'ajuste')),
  amount_cents integer not null,
  pix_date date,
  note text check (note is null or (char_length(note) <= 140 and note !~ '[\r\n]')),
  reason text check (reason is null or char_length(btrim(reason)) between 5 and 500),
  created_by uuid not null references auth.users (id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint service_fee_payouts_shape_check check (
    (kind = 'repasse' and amount_cents > 0 and pix_date is not null)
    or (kind = 'ajuste' and amount_cents <> 0 and reason is not null)
  )
);

create table public.service_fee_payout_items (
  payout_id uuid not null references public.service_fee_payouts (id),
  event_id uuid not null references public.events (id),
  amount_cents integer not null check (amount_cents <> 0),
  primary key (payout_id, event_id)
);

create index service_fee_payout_items_event_idx on public.service_fee_payout_items (event_id);

create function public.reject_finance_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TAXA_IMUTAVEL: Registro financeiro não pode ser alterado nem apagado.';
end;
$$;

create trigger order_chargebacks_immutable
  before update or delete on public.order_chargebacks
  for each row execute function public.reject_finance_record_change();
create trigger order_chargebacks_no_truncate
  before truncate on public.order_chargebacks
  for each statement execute function public.reject_finance_record_change();
create trigger service_fee_payouts_immutable
  before update or delete on public.service_fee_payouts
  for each row execute function public.reject_finance_record_change();
create trigger service_fee_payouts_no_truncate
  before truncate on public.service_fee_payouts
  for each statement execute function public.reject_finance_record_change();
create trigger service_fee_payout_items_immutable
  before update or delete on public.service_fee_payout_items
  for each row execute function public.reject_finance_record_change();
create trigger service_fee_payout_items_no_truncate
  before truncate on public.service_fee_payout_items
  for each statement execute function public.reject_finance_record_change();

alter table public.order_chargebacks enable row level security;
alter table public.service_fee_payouts enable row level security;
alter table public.service_fee_payout_items enable row level security;

revoke all on table public.order_chargebacks from public, anon, authenticated, service_role;
revoke all on table public.service_fee_payouts from public, anon, authenticated, service_role;
revoke all on table public.service_fee_payout_items from public, anon, authenticated, service_role;
grant select, insert on table public.order_chargebacks to service_role;
grant select, insert on table public.service_fee_payouts to service_role;
grant select, insert on table public.service_fee_payout_items to service_role;

-- 5) Contas por evento ------------------------------------------------------------

-- Dia seguinte (São Paulo) ao fim da última sessão ativa; se todas foram canceladas,
-- a última delas. Sem sessões = null (nunca fica "a pagar").
create function public.event_fee_due_date(p_event_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(
    (select max(coalesce(s.ends_at, s.starts_at)) from public.event_sessions s
     where s.event_id = p_event_id and s.archived_at is null and s.status = 'ativa'),
    (select max(coalesce(s.ends_at, s.starts_at)) from public.event_sessions s
     where s.event_id = p_event_id and s.archived_at is null)
  ) at time zone 'America/Sao_Paulo')::date + 1;
$$;

create function public.order_is_contested(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.kind = 'contestacao'
    from public.order_chargebacks c
    where c.order_id = p_order_id
    order by c.created_at desc, c.id desc
    limit 1
  ), false);
$$;

-- Pedido que conta para a taxa: pago e não contestado. Estornado sai sozinho;
-- "aguardando decisão" fica fora até ser aceito.
create function public.event_fee_balance(p_event_id uuid)
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
      (o.status = 'pago' and public.order_is_contested(o.id)) as contested
    from public.orders o
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
      (count(*) filter (where o.status = 'aguardando_decisao'))::integer as decision_orders,
      coalesce(sum(o.total_cents) filter (where o.status = 'aguardando_decisao'), 0)::bigint as decision,
      coalesce(sum(o.service_fee_cents) filter (where o.status = 'aguardando_decisao'), 0)::bigint as decision_fee
    from o
  )
  select s.tickets, s.fee, s.paid_total, s.refunded, s.refunded_fee, s.refunded_orders,
    s.contested, s.contested_fee, s.contested_orders, s.fee_due, p.v, s.fee_due - p.v,
    s.decision_orders, s.decision, s.decision_fee
  from sums s cross join paid p;
$$;

-- Eventos com taxa cobrada ou com lançamento de repasse/ajuste.
create function public.service_fee_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct o.event_id from public.orders o
  where o.service_fee_cents > 0 and o.status in ('pago', 'estornado', 'aguardando_decisao')
  union
  select distinct i.event_id from public.service_fee_payout_items i;
$$;

-- Descontos pendentes (saldo negativo) de outros eventos, abatidos no próximo repasse.
create function public.service_fee_pending_discounts(p_except_event_id uuid)
returns table (event_id uuid, event_name text, balance_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, b.balance_cents
  from public.service_fee_event_ids() as ids(id)
  join public.events e on e.id = ids.id
  cross join lateral public.event_fee_balance(e.id) b
  where e.id is distinct from p_except_event_id and b.balance_cents < 0
  order by e.name, e.id;
$$;

create function public.assert_finance_admin(p_staff_user_id uuid, p_write boolean)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.staff_finance_role(p_staff_user_id);
begin
  if v_role is null or v_role not in ('admin', 'admin_dev') then
    raise exception 'TAXA_ADMIN: Acesso restrito ao Admin do Espaço.';
  end if;
  if p_write and v_role = 'admin_dev' then
    raise exception 'TAXA_DEV: A conta do desenvolvedor não registra repasses.';
  end if;
  return v_role;
end;
$$;

create function public.event_finance_summary(p_event_id uuid, p_staff_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_balance record;
  v_discounts jsonb;
  v_discount_total bigint;
begin
  perform public.assert_finance_admin(p_staff_user_id, false);
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'TAXA_EVENTO: Evento não encontrado.';
  end if;

  select * into v_balance from public.event_fee_balance(p_event_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', d.event_id, 'event_name', d.event_name, 'balance_cents', d.balance_cents)), '[]'::jsonb),
    coalesce(sum(d.balance_cents), 0)
  into v_discounts, v_discount_total
  from public.service_fee_pending_discounts(p_event_id) d;

  return jsonb_build_object(
    'event_id', p_event_id,
    'due_date', public.event_fee_due_date(p_event_id),
    'last_session_ends_at', public.event_fee_due_date(p_event_id) - 1,
    'tickets_cents', v_balance.tickets_cents,
    'fee_cents', v_balance.fee_cents,
    'paid_total_cents', v_balance.paid_total_cents,
    'refunded_cents', v_balance.refunded_cents,
    'refunded_fee_cents', v_balance.refunded_fee_cents,
    'refunded_orders', v_balance.refunded_orders,
    'contested_cents', v_balance.contested_cents,
    'contested_fee_cents', v_balance.contested_fee_cents,
    'contested_orders', v_balance.contested_orders,
    'fee_due_cents', v_balance.fee_due_cents,
    'paid_out_cents', v_balance.paid_out_cents,
    'balance_cents', v_balance.balance_cents,
    'decision_orders', v_balance.decision_orders,
    'decision_cents', v_balance.decision_cents,
    'decision_fee_cents', v_balance.decision_fee_cents,
    'espaco_cents', v_balance.paid_total_cents - v_balance.refunded_cents
      - v_balance.contested_cents - v_balance.fee_due_cents,
    'rate_bps', coalesce((
      select max(o.service_fee_rate_bps) from public.orders o
      where o.event_id = p_event_id and o.service_fee_cents > 0
    ), 0),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'kind', p.kind, 'amount_cents', i.amount_cents,
          'payout_total_cents', p.amount_cents, 'pix_date', p.pix_date, 'note', p.note,
          'reason', p.reason, 'created_by_name', p.created_by_name, 'created_at', p.created_at)
        order by p.created_at desc, p.id)
      from public.service_fee_payout_items i
      join public.service_fee_payouts p on p.id = i.payout_id
      where i.event_id = p_event_id
    ), '[]'::jsonb),
    'chargebacks', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'order_id', c.order_id, 'kind', c.kind, 'amount_cents', c.amount_cents,
          'fee_cents', c.fee_cents, 'reason', c.reason, 'source', c.source,
          'created_by_name', c.created_by_name, 'created_at', c.created_at)
        order by c.created_at desc, c.id)
      from public.order_chargebacks c
      join public.orders o on o.id = c.order_id
      where o.event_id = p_event_id
    ), '[]'::jsonb),
    'contested_order_ids', coalesce((
      select jsonb_agg(o.id order by o.id)
      from public.orders o
      where o.event_id = p_event_id and o.status = 'pago' and public.order_is_contested(o.id)
    ), '[]'::jsonb),
    'last_payout', (
      select jsonb_build_object('created_at', p.created_at, 'created_by_name', p.created_by_name,
        'pix_date', p.pix_date, 'note', p.note)
      from public.service_fee_payout_items i
      join public.service_fee_payouts p on p.id = i.payout_id
      where i.event_id = p_event_id and p.kind = 'repasse'
      order by p.created_at desc, p.id
      limit 1
    ),
    'pending_discounts', v_discounts,
    'suggested_payout_cents', greatest(v_balance.balance_cents, 0) + v_discount_total
  );
end;
$$;

create function public.service_fee_overview(p_staff_user_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_events jsonb;
  v_to_pay bigint;
  v_discounts bigint;
  v_paid bigint;
begin
  perform public.assert_finance_admin(p_staff_user_id, false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 800 then
    raise exception 'TAXA_VALOR: Período inválido.';
  end if;

  with ev as (
    select e.id, e.name, public.event_fee_due_date(e.id) as due, b.*
    from public.service_fee_event_ids() as ids(id)
    join public.events e on e.id = ids.id
    cross join lateral public.event_fee_balance(e.id) b
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
        'event_id', ev.id, 'name', ev.name,
        'last_session_at', ev.due - 1, 'due_date', ev.due,
        'tickets_cents', ev.tickets_cents, 'fee_cents', ev.fee_cents,
        'refunded_cents', ev.refunded_cents, 'contested_cents', ev.contested_cents,
        'fee_due_cents', ev.fee_due_cents, 'paid_out_cents', ev.paid_out_cents,
        'balance_cents', ev.balance_cents,
        'last_payout', (
          select jsonb_build_object('created_at', p.created_at, 'created_by_name', p.created_by_name,
            'pix_date', p.pix_date, 'note', p.note)
          from public.service_fee_payout_items i
          join public.service_fee_payouts p on p.id = i.payout_id
          where i.event_id = ev.id and p.kind = 'repasse'
          order by p.created_at desc, p.id
          limit 1
        ))
      order by ev.due desc nulls last, ev.name)
      filter (where ev.due - 1 between p_from and p_to), '[]'::jsonb),
    coalesce(sum(ev.balance_cents) filter (where ev.balance_cents > 0 and ev.due <= v_today), 0),
    coalesce(sum(ev.balance_cents) filter (where ev.balance_cents < 0), 0)
  into v_events, v_to_pay, v_discounts
  from ev;

  select coalesce(sum(p.amount_cents), 0) into v_paid
  from public.service_fee_payouts p
  where p.kind = 'repasse' and p.pix_date between p_from and p_to;

  return jsonb_build_object(
    'events', v_events,
    'to_pay_cents', v_to_pay,
    'paid_in_period_cents', v_paid,
    'pending_discount_cents', v_discounts
  );
end;
$$;

-- 6) Escrita do Admin ----------------------------------------------------------------

-- Um repasse por vez (ele também abate descontos de outros eventos).
create function public.record_service_fee_payout(
  p_event_id uuid,
  p_staff_user_id uuid,
  p_expected_amount_cents integer,
  p_pix_date date,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_due date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_balance bigint;
  v_discount bigint;
  v_amount bigint;
  v_payout_id uuid := gen_random_uuid();
  v_name text;
begin
  perform public.assert_finance_admin(p_staff_user_id, true);
  perform pg_advisory_xact_lock(hashtext('service_fee_payout'));

  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'TAXA_EVENTO: Evento não encontrado.';
  end if;
  v_due := public.event_fee_due_date(p_event_id);
  if v_due is null or v_today < v_due then
    raise exception 'TAXA_PRAZO: O repasse fica liberado no dia seguinte à última sessão.';
  end if;
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'TAXA_NOTA: Nota inválida.';
  end if;
  if p_pix_date is null or p_pix_date > v_today or p_pix_date < v_due - 1 then
    raise exception 'TAXA_DATA: Data do PIX inválida.';
  end if;

  select b.balance_cents into v_balance from public.event_fee_balance(p_event_id) b;
  if v_balance <= 0 then
    raise exception 'TAXA_NADA: Nada a pagar neste evento.';
  end if;
  select coalesce(sum(d.balance_cents), 0) into v_discount
  from public.service_fee_pending_discounts(p_event_id) d;
  v_amount := v_balance + v_discount;
  if v_amount <= 0 then
    raise exception 'TAXA_NADA: Os descontos pendentes cobrem o valor deste evento.';
  end if;
  if p_expected_amount_cents is distinct from v_amount then
    raise exception 'TAXA_MUDOU:%', v_amount;
  end if;

  v_name := coalesce(public.staff_display_name(p_staff_user_id), 'Equipe');
  insert into public.service_fee_payouts (id, kind, amount_cents, pix_date, note, created_by, created_by_name)
  values (v_payout_id, 'repasse', v_amount, p_pix_date, v_note, p_staff_user_id, v_name);

  insert into public.service_fee_payout_items (payout_id, event_id, amount_cents)
  values (v_payout_id, p_event_id, v_balance);
  insert into public.service_fee_payout_items (payout_id, event_id, amount_cents)
  select v_payout_id, d.event_id, d.balance_cents
  from public.service_fee_pending_discounts(p_event_id) d;

  return jsonb_build_object(
    'payout_id', v_payout_id,
    'amount_cents', v_amount,
    'event_cents', v_balance,
    'discount_cents', v_discount,
    'created_by_name', v_name
  );
end;
$$;

-- Correção: soma ao "já repassado" do evento (positivo = PIX extra feito; negativo =
-- repasse registrado a mais). Nunca edita um lançamento.
create function public.record_service_fee_adjustment(
  p_event_id uuid,
  p_staff_user_id uuid,
  p_amount_cents integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_payout_id uuid := gen_random_uuid();
begin
  perform public.assert_finance_admin(p_staff_user_id, true);
  perform pg_advisory_xact_lock(hashtext('service_fee_payout'));

  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'TAXA_EVENTO: Evento não encontrado.';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 10000000 then
    raise exception 'TAXA_VALOR: Valor inválido.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'TAXA_MOTIVO: Motivo inválido.';
  end if;

  insert into public.service_fee_payouts (id, kind, amount_cents, reason, created_by, created_by_name)
  values (v_payout_id, 'ajuste', p_amount_cents, v_reason, p_staff_user_id,
    coalesce(public.staff_display_name(p_staff_user_id), 'Equipe'));
  insert into public.service_fee_payout_items (payout_id, event_id, amount_cents)
  values (v_payout_id, p_event_id, p_amount_cents);

  return jsonb_build_object('payout_id', v_payout_id);
end;
$$;

-- Contestação manual pelo Admin (ou, no futuro, automática pelo servidor sem conta).
-- Não muda o pedido nem os ingressos; só tira a taxa da conta enquanto contestado.
create function public.register_order_chargeback(
  p_order_id uuid,
  p_staff_user_id uuid,
  p_kind text,
  p_reason text,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_contested boolean;
  v_id uuid := gen_random_uuid();
begin
  if p_source = 'manual' then
    perform public.assert_finance_admin(p_staff_user_id, true);
  elsif p_source is distinct from 'automatico' or p_staff_user_id is not null then
    raise exception 'TAXA_VALOR: Origem inválida.';
  end if;
  if p_kind is null or p_kind not in ('contestacao', 'reversao') then
    raise exception 'TAXA_VALOR: Tipo inválido.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'TAXA_MOTIVO: Motivo inválido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('service_fee_payout'));
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found or v_order.status <> 'pago' or v_order.total_cents <= 0
    or v_order.payment_provider is not distinct from 'cortesia_interna' then
    raise exception 'TAXA_PEDIDO: Pedido não encontrado ou sem pagamento confirmado.';
  end if;

  v_contested := public.order_is_contested(v_order.id);
  if p_kind = 'contestacao' and v_contested then
    raise exception 'TAXA_CONTESTACAO_JA: Pedido já contestado.';
  end if;
  if p_kind = 'reversao' and not v_contested then
    raise exception 'TAXA_CONTESTACAO_SEM: Pedido não está contestado.';
  end if;

  insert into public.order_chargebacks (
    id, order_id, kind, amount_cents, fee_cents, source, reason, created_by, created_by_name
  ) values (
    v_id, v_order.id, p_kind, v_order.total_cents, v_order.service_fee_cents, p_source, v_reason,
    p_staff_user_id, public.staff_display_name(p_staff_user_id)
  );

  return jsonb_build_object('id', v_id, 'kind', p_kind, 'event_id', v_order.event_id);
end;
$$;

-- 7) Checkout v5: grava a taxa ------------------------------------------------------

-- Igual à v4 (20261011100000_event_sessions.sql), mais:
--   * lê service_fee_settings uma vez; desligada = taxa 0 (comportamento de antes);
--   * taxa por unidade de cada tipo, gravada em order_items e somada em orders;
--   * total = ingressos + taxa; tickets.price_cents continua só com o preço;
--   * p_expected_fee_rate_bps / p_expected_fee_min_cents (opcionais): termos efetivos
--     que a tela mostrou; diferentes dos vigentes → TAXA_MUDOU. O código anterior não
--     manda e não é conferido.
drop function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid);

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
  p_expected_fee_min_cents integer default null
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
    privacy_accepted_at
  ) values (
    v_order_id, p_event_id, v_session.id, btrim(p_buyer_name), lower(btrim(p_buyer_email)),
    nullif(btrim(p_buyer_phone), ''), v_total_cents + v_fee_cents,
    v_total_cents, v_fee_cents, v_fee_rate, v_fee_min, 'pendente', p_public_token,
    p_payment_provider, v_order_id::text, v_expires_at, v_privacy_version,
    case when v_privacy_version is not null then now() end
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

-- 8) Permissões ----------------------------------------------------------------------

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.staff_finance_role(uuid) from public, anon, authenticated;
revoke all on function public.service_fee_settings_touch() from public, anon, authenticated;
revoke all on function public.service_fee_for_price(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.service_fee_policy() from public, anon, authenticated;
revoke all on function public.orders_fill_fee_subtotal() from public, anon, authenticated;
revoke all on function public.orders_fee_immutable() from public, anon, authenticated;
revoke all on function public.reject_finance_record_change() from public, anon, authenticated;
revoke all on function public.event_fee_due_date(uuid) from public, anon, authenticated;
revoke all on function public.order_is_contested(uuid) from public, anon, authenticated;
revoke all on function public.event_fee_balance(uuid) from public, anon, authenticated;
revoke all on function public.service_fee_event_ids() from public, anon, authenticated;
revoke all on function public.service_fee_pending_discounts(uuid) from public, anon, authenticated;
revoke all on function public.assert_finance_admin(uuid, boolean) from public, anon, authenticated;
revoke all on function public.event_finance_summary(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_fee_overview(uuid, date, date) from public, anon, authenticated;
revoke all on function public.record_service_fee_payout(uuid, uuid, integer, date, text) from public, anon, authenticated;
revoke all on function public.record_service_fee_adjustment(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.register_order_chargeback(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.staff_finance_role(uuid) to service_role;
grant execute on function public.service_fee_for_price(integer, integer, integer) to service_role;
grant execute on function public.service_fee_policy() to service_role;
grant execute on function public.event_fee_due_date(uuid) to service_role;
grant execute on function public.order_is_contested(uuid) to service_role;
grant execute on function public.event_fee_balance(uuid) to service_role;
grant execute on function public.service_fee_event_ids() to service_role;
grant execute on function public.service_fee_pending_discounts(uuid) to service_role;
grant execute on function public.assert_finance_admin(uuid, boolean) to service_role;
grant execute on function public.event_finance_summary(uuid, uuid) to service_role;
grant execute on function public.service_fee_overview(uuid, date, date) to service_role;
grant execute on function public.record_service_fee_payout(uuid, uuid, integer, date, text) to service_role;
grant execute on function public.record_service_fee_adjustment(uuid, uuid, integer, text) to service_role;
grant execute on function public.register_order_chargeback(uuid, uuid, text, text, text) to service_role;
grant execute on function public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid, integer, integer) to service_role;
