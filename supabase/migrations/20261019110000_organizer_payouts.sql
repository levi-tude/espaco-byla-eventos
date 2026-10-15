-- Fase 3 (B): repasses ao organizador, descontos e devoluções (spec 2026-10-13-contas-organizador-design,
-- seções 10.2 a 10.5; plano 2026-10-15-contas-organizador-fase3, tarefa 6).
--
-- ADITIVA: aplicar depois de 20261019100000_payment_fees_calendar. Tabelas novas com RLS ligada e
-- sem políticas (só funções security definer da service_role). Repasses e itens são imutáveis:
-- correção = novo lançamento (ajuste, compensação ou devolução). Dinheiro só em centavos inteiros,
-- calculado aqui. Quem grava dinheiro trava o organizador (organizer_payout:<id>) antes de calcular.
-- Nada de chave PIX, documento, e-mail ou nome de comprador em audit_log.details, CSV ou visão geral;
-- a chave completa só sai em organizer_payout_details (Admin que grava).

-- 1) Tabelas ---------------------------------------------------------------------------

create table public.organizer_payouts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  kind text not null check (kind in ('repasse', 'compensacao', 'ajuste', 'devolucao')),
  amount_cents integer not null,
  pix_date date,
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key_snapshot text check (pix_key_snapshot is null or char_length(pix_key_snapshot) between 1 and 77),
  pix_holder_name_snapshot text check (pix_holder_name_snapshot is null or char_length(pix_holder_name_snapshot) between 2 and 120),
  pix_holder_document_snapshot text check (pix_holder_document_snapshot is null or pix_holder_document_snapshot ~ '^([0-9]{11}|[0-9]{14})$'),
  pix_key_changed_at_snapshot timestamptz,
  note text check (note is null or (char_length(note) between 1 and 140 and note !~ '[\r\n]')),
  reason text check (reason is null or char_length(btrim(reason)) between 5 and 500),
  created_by uuid not null,        -- sem FK (pendência M-2 da fase 2)
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint organizer_payouts_shape_check check (
    (kind = 'repasse' and amount_cents > 0 and pix_date is not null and pix_key_type is not null
       and pix_key_snapshot is not null and pix_holder_name_snapshot is not null
       and pix_holder_document_snapshot is not null)
    or (kind = 'compensacao' and amount_cents = 0 and pix_date is null)
    or (kind = 'ajuste' and amount_cents <> 0 and reason is not null and pix_date is null)
    or (kind = 'devolucao' and amount_cents < 0 and pix_date is not null)
  )
);
create index organizer_payouts_organizer_idx on public.organizer_payouts (organizer_id, created_at desc);
create index organizer_payouts_pix_date_idx on public.organizer_payouts (pix_date) where pix_date is not null;

-- Uma linha por evento afetado. Positivo = sai da parte do evento (repasse, ajuste a favor do
-- Espaço); negativo = volta para a parte (desconto abatido, ajuste a favor do organizador,
-- devolução recebida).
create table public.organizer_payout_items (
  payout_id uuid not null references public.organizer_payouts (id),
  event_id uuid not null references public.events (id),
  amount_cents integer not null check (amount_cents <> 0),
  primary key (payout_id, event_id)
);
create index organizer_payout_items_event_idx on public.organizer_payout_items (event_id);

-- Saldo negativo de um evento: abre no dia em que fica negativo, ganha prazo de devolução
-- (10 dias) depois de 30 dias e fecha quando o saldo volta a >= 0.
create table public.organizer_balance_flags (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  negative_since date not null,
  return_due_date date,
  return_notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (return_due_date is null or return_due_date > negative_since)
);
create unique index organizer_balance_flags_open on public.organizer_balance_flags (event_id) where resolved_at is null;

alter table public.organizer_payouts enable row level security;
alter table public.organizer_payout_items enable row level security;
alter table public.organizer_balance_flags enable row level security;
revoke all on table public.organizer_payouts from public, anon, authenticated, service_role;
revoke all on table public.organizer_payout_items from public, anon, authenticated, service_role;
revoke all on table public.organizer_balance_flags from public, anon, authenticated, service_role;

create trigger organizer_payouts_immutable before update or delete on public.organizer_payouts
  for each row execute function public.reject_finance_record_change();
create trigger organizer_payouts_no_truncate before truncate on public.organizer_payouts
  for each statement execute function public.reject_finance_record_change();
create trigger organizer_payout_items_immutable before update or delete on public.organizer_payout_items
  for each row execute function public.reject_finance_record_change();
create trigger organizer_payout_items_no_truncate before truncate on public.organizer_payout_items
  for each statement execute function public.reject_finance_record_change();

-- 2) Máscaras (mesmas expressões de list_organizers) ----------------------------------------

-- Chave CPF/CNPJ é o próprio documento do titular: mostrar outros dígitos que os da
-- máscara do documento revelaria o documento quase inteiro.
create function public.mask_pix_key(p_type text, p_key text)
returns text language sql immutable security definer set search_path = '' as $$
  select case
    when p_type = 'email' then '•••@' || split_part(p_key, '@', 2)
    when p_type = 'cpf' then
      '•••.' || substr(p_key, 4, 3) || '.' || substr(p_key, 7, 3) || '-••'
    when p_type = 'cnpj' then
      '••.•••.' || substr(p_key, 6, 3) || '/' || substr(p_key, 9, 4) || '-••'
    else '•••• ' || right(p_key, 4)
  end;
$$;

create function public.mask_tax_document(p_doc text)
returns text language sql immutable security definer set search_path = '' as $$
  select case
    when char_length(p_doc) = 11 then
      '•••.' || substr(p_doc, 4, 3) || '.' || substr(p_doc, 7, 3) || '-••'
    else
      '••.•••.' || substr(p_doc, 6, 3) || '/' || substr(p_doc, 9, 4) || '-••'
  end;
$$;

-- A Migration C (troca de chave PIX) recria esta função lendo organizer_pix_change_requests.
create function public.organizer_pix_change_pending(p_organizer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select false;
$$;

-- 3) Contas do evento ------------------------------------------------------------------------

-- Contas do evento (spec 10.2). Só pedidos com tarifa conhecida entram na parte do
-- organizador; os outros ficam "em conferência" até a tarifa chegar.
create function public.organizer_event_balance(p_event_id uuid)
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
      coalesce(sum(c.sub) filter (where not c.known and c.keeps), 0)::bigint as pending,
      coalesce(sum((case when c.keeps then c.sub else 0 end) - c.fee) filter (where c.known), 0)::bigint as share,
      coalesce(sum(c.svc) filter (where c.status = 'pago'), 0)::bigint as svc
    from counted c
  ),
  paid as (
    select coalesce(sum(i.amount_cents), 0)::bigint as v
    from public.organizer_payout_items i where i.event_id = p_event_id
  )
  select t.sold, t.sold_orders, t.refunded, t.refunded_orders, t.contested, t.contested_orders,
         t.fee, t.pending_orders, t.pending, t.share, p.v, t.share - p.v,
         (select count(*)::integer from base b where b.status = 'aguardando_decisao'), t.svc
  from totals t cross join paid p;
$$;

-- Eventos de organizador que entram nas contas: já foram à venda, têm pedido que conta ou
-- têm lançamento (ex.: ajuste em evento sem vendas).
create function public.organizer_finance_event_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.events e
  where e.organizer_id is not null
    and (e.published_at is not null
      or exists (select 1 from public.orders o
                 where o.event_id = e.id and o.total_cents > 0
                   and o.status in ('pago', 'estornado', 'aguardando_decisao'))
      or exists (select 1 from public.organizer_payout_items i where i.event_id = e.id));
$$;

-- Descontos pendentes (saldo < 0) de outros eventos do organizador, do mais antigo ao mais novo.
create function public.organizer_pending_discounts(p_organizer_id uuid, p_except_event_id uuid)
returns table (event_id uuid, event_name text, balance_cents bigint)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, b.balance_cents
  from public.events e
  cross join lateral public.organizer_event_balance(e.id) b
  where e.organizer_id = p_organizer_id
    and e.id is distinct from p_except_event_id
    and b.balance_cents < 0
  order by coalesce((select f.negative_since from public.organizer_balance_flags f
                     where f.event_id = e.id and f.resolved_at is null), public.event_fee_due_date(e.id)),
           e.id;
$$;

-- Valor do próximo repasse do evento: saldo menos os descontos pendentes de outros eventos do
-- mesmo organizador (do mais antigo ao mais novo, inclusive parcialmente). Usada pela tela
-- (organizer_payout_details) e pelo registro (record_organizer_payout), sempre a mesma conta.
create function public.organizer_payout_preview(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_organizer uuid;
  v_balance bigint;
  v_pending integer;
  v_left bigint;
  v_take bigint;
  v_items jsonb := '[]'::jsonb;
  v_discounts jsonb := '[]'::jsonb;
  r record;
begin
  select e.organizer_id into v_organizer from public.events e where e.id = p_event_id;
  if v_organizer is null then
    return null;
  end if;
  select b.balance_cents, b.pending_fee_orders into v_balance, v_pending
  from public.organizer_event_balance(p_event_id) b;
  v_left := greatest(v_balance, 0);
  if v_left > 0 then
    v_items := jsonb_build_array(jsonb_build_object('event_id', p_event_id, 'amount_cents', v_balance));
    for r in select d.event_id, d.event_name, d.balance_cents
             from public.organizer_pending_discounts(v_organizer, p_event_id) d loop
      exit when v_left = 0;
      v_take := least(v_left, -r.balance_cents);
      v_items := v_items || jsonb_build_object('event_id', r.event_id, 'amount_cents', -v_take);
      v_discounts := v_discounts || jsonb_build_object('event_id', r.event_id, 'event_name', r.event_name, 'cents', v_take);
      v_left := v_left - v_take;
    end loop;
  end if;
  return jsonb_build_object(
    'organizer_id', v_organizer,
    'balance_cents', v_balance,
    'pending_fee_orders', v_pending,
    'amount_cents', v_left,
    'discount_cents', greatest(v_balance, 0) - v_left,
    'kind', case when v_balance <= 0 then null when v_left > 0 then 'repasse' else 'compensacao' end,
    'items', v_items,
    'discounts', v_discounts
  );
end;
$$;

create function public.resolve_balance_flags(p_organizer_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.organizer_balance_flags f set resolved_at = now()
  where f.organizer_id = p_organizer_id and f.resolved_at is null
    and (select b.balance_cents from public.organizer_event_balance(f.event_id) b) >= 0;
$$;

-- 4) Escrita do Admin (não desenvolvedor) ------------------------------------------------------

create function public.record_organizer_payout(
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
  -- (a Migration C recria esta função com o bloco ORG_PIX_PENDENTE aqui)
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'ORG_NOTA: Nota inválida.';
  end if;

  v_preview := public.organizer_payout_preview(p_event_id);
  v_balance := (v_preview ->> 'balance_cents')::bigint;
  if v_balance <= 0 then
    if (v_preview ->> 'pending_fee_orders')::integer > 0 then
      raise exception 'ORG_TARIFA_PENDENTE:%', (v_preview ->> 'pending_fee_orders')::integer;
    end if;
    raise exception 'ORG_NADA: Nada a repassar neste evento.';
  end if;

  v_left := (v_preview ->> 'amount_cents')::bigint;
  if v_left is distinct from p_expected_amount_cents::bigint then
    raise exception 'ORG_MUDOU:%', v_left;
  end if;
  v_kind := v_preview ->> 'kind';
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

-- Positivo = a favor do Espaço (diminui o saldo); negativo = a favor do organizador.
create function public.record_organizer_payout_adjustment(
  p_admin uuid, p_event_id uuid, p_amount_cents integer, p_reason text
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_organizer uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  perform public.assert_finance_admin(p_admin, true);
  select e.organizer_id into v_organizer from public.events e where e.id = p_event_id;
  if v_organizer is null then
    raise exception 'ORG_ACESSO: Evento sem organizador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0));
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 10000000 then
    raise exception 'ORG_VALOR: Valor inválido.';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'ORG_MOTIVO: Informe o motivo (5 a 500 caracteres).';
  end if;
  insert into public.organizer_payouts (organizer_id, kind, amount_cents, reason, created_by, created_by_name)
  values (v_organizer, 'ajuste', p_amount_cents, v_reason, p_admin, public.staff_display_name(p_admin))
  returning id into v_id;
  insert into public.organizer_payout_items (payout_id, event_id, amount_cents) values (v_id, p_event_id, p_amount_cents);
  perform public.resolve_balance_flags(v_organizer);
  perform public.log_audit(p_admin, 'repasse_ajuste', p_event_id, null, v_organizer,
    jsonb_build_object('amount_cents', p_amount_cents));
  return v_id;
end;
$$;

-- "Devolução recebida": pode ser parcial; abate do saldo negativo mais antigo para o mais novo.
create function public.record_organizer_refund_received(
  p_admin uuid, p_organizer_id uuid, p_amount_cents integer, p_pix_date date, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_owed bigint;
  v_left bigint := p_amount_cents;
  v_take bigint;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r record;
begin
  perform public.assert_finance_admin(p_admin, true);
  if p_organizer_id is null then
    raise exception 'ORG_NADA: Nada a receber deste organizador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || p_organizer_id::text, 0));
  if p_pix_date is null or p_pix_date > v_today or p_pix_date < v_today - 90 then
    raise exception 'ORG_DATA: Data do PIX inválida.';
  end if;
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'ORG_NOTA: Nota inválida.';
  end if;
  select coalesce(-sum(d.balance_cents), 0) into v_owed from public.organizer_pending_discounts(p_organizer_id, null) d;
  if v_owed <= 0 then
    raise exception 'ORG_NADA: Nada a receber deste organizador.';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v_owed then
    raise exception 'ORG_VALOR:%', v_owed;
  end if;
  insert into public.organizer_payouts (organizer_id, kind, amount_cents, pix_date, note, created_by, created_by_name)
  values (p_organizer_id, 'devolucao', -p_amount_cents, p_pix_date, v_note, p_admin, public.staff_display_name(p_admin))
  returning id into v_id;
  for r in select d.event_id, d.balance_cents from public.organizer_pending_discounts(p_organizer_id, null) d loop
    exit when v_left = 0;
    v_take := least(v_left, -r.balance_cents);
    insert into public.organizer_payout_items (payout_id, event_id, amount_cents) values (v_id, r.event_id, -v_take);
    v_left := v_left - v_take;
  end loop;
  perform public.resolve_balance_flags(p_organizer_id);
  perform public.log_audit(p_admin, 'devolucao_recebida', null, null, p_organizer_id,
    jsonb_build_object('amount_cents', p_amount_cents, 'owed_cents', v_owed));
  return jsonb_build_object('payout_id', v_id, 'amount_cents', p_amount_cents, 'remaining_cents', v_owed - p_amount_cents);
end;
$$;

-- 5) Marcações de saldo negativo (cron diário) ---------------------------------------------

-- Abre/fecha marcações e devolve as que precisam de e-mail ("Devolução pendente").
create function public.refresh_organizer_balance_flags()
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
  order by f.organizer_id, f.return_due_date;
end;
$$;

create function public.mark_balance_flag_notified(p_flag_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.organizer_balance_flags f set return_notified_at = now()
  where f.id = p_flag_id and f.return_notified_at is null;
$$;

create function public.organizer_overdue_refunds(p_organizer_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.organizer_balance_flags f
  where f.organizer_id = p_organizer_id and f.resolved_at is null
    and f.return_due_date < (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Resumo do cron para o e-mail diário da equipe: só contagens e somas (sem nomes nem dados
-- pessoais). Sem ator: o cron não tem usuário.
create function public.organizer_finance_daily_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_late integer;
  v_late_cents bigint;
  v_refunds integer;
  v_fees integer;
begin
  select count(*)::integer, coalesce(sum(b.balance_cents), 0)::bigint into v_late, v_late_cents
  from public.organizer_finance_event_ids() as ids(id)
  cross join lateral public.organizer_event_balance(ids.id) b
  cross join lateral (select public.event_payout_due_date(ids.id) as due) d
  where b.balance_cents > 0 and d.due is not null and v_today > d.due;

  select count(*)::integer into v_refunds
  from public.organizer_balance_flags f
  where f.resolved_at is null and f.return_due_date < v_today;

  select count(*)::integer into v_fees
  from public.orders o
  join public.events e on e.id = o.event_id
  left join public.order_payment_fees f on f.order_id = o.id
  where e.organizer_id is not null
    and public.order_has_bank_fee(o.id)
    and f.fee_cents is null
    and o.created_at < now() - interval '2 days';

  return jsonb_build_object(
    'today', v_today,
    'late_payouts', v_late,
    'late_payouts_cents', v_late_cents,
    'late_refunds', v_refunds,
    'fees_pending_2d', v_fees,
    'calendar_until', public.business_calendar_last_year()
  );
end;
$$;

-- 6) Leituras de tela ----------------------------------------------------------------------

-- Aba "Financeiro" do evento: organizador dono (conta ativa) ou Admin/desenvolvedor.
create function public.organizer_event_finance(p_actor uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_viewer text;
  v_team boolean;
  v_event public.events%rowtype;
  v_profile public.organizer_profiles%rowtype;
  v_balance record;
  v_first_payout timestamptz;
  v_flag jsonb;
  v_history jsonb;
  v_late jsonb;
begin
  if public.actor_event_access(p_actor, p_event_id) = 'dono' then
    v_viewer := 'dono';
  elsif public.staff_finance_role(p_actor) in ('admin', 'admin_dev')
        and exists (select 1 from public.events e where e.id = p_event_id and e.organizer_id is not null) then
    v_viewer := public.staff_finance_role(p_actor);
  else
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  v_team := v_viewer <> 'dono';

  select * into v_event from public.events e where e.id = p_event_id;
  select * into v_profile from public.organizer_profiles op where op.user_id = v_event.organizer_id;
  select * into v_balance from public.organizer_event_balance(p_event_id);

  select jsonb_build_object('negative_since', f.negative_since, 'return_due_date', f.return_due_date)
    into v_flag
  from public.organizer_balance_flags f
  where f.event_id = p_event_id and f.resolved_at is null;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'payout_id', p.id, 'kind', p.kind, 'item_cents', i.amount_cents, 'payout_cents', p.amount_cents,
        'pix_date', p.pix_date, 'created_at', p.created_at, 'note', p.note)
      || case when v_team then jsonb_build_object('created_by_name', p.created_by_name, 'reason', p.reason)
              else '{}'::jsonb end
      order by p.created_at desc, p.id), '[]'::jsonb)
    into v_history
  from public.organizer_payout_items i
  join public.organizer_payouts p on p.id = i.payout_id
  where i.event_id = p_event_id;

  -- Estornos e contestações depois do primeiro repasse do evento (motivo do desconto).
  select min(p.created_at) into v_first_payout
  from public.organizer_payout_items i
  join public.organizer_payouts p on p.id = i.payout_id
  where i.event_id = p_event_id and i.amount_cents > 0 and p.kind in ('repasse', 'compensacao');

  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', c.order_id,
      'order_number', upper(left(replace(c.order_id::text, '-', ''), 8)),
      'kind', c.kind, 'cents', c.cents, 'at', c.at)
      order by c.at desc, c.order_id), '[]'::jsonb)
    into v_late
  from (
    select x.order_id, x.kind, x.cents, x.at
    from (
      select o.id as order_id, 'estorno' as kind, o.tickets_subtotal_cents as cents,
             (select coalesce(max(r.completed_at), max(r.created_at))
              from public.order_refunds r where r.order_id = o.id) as at
      from public.orders o
      where o.event_id = p_event_id and o.status = 'estornado' and o.total_cents > 0
      union all
      select o.id, 'contestacao', o.tickets_subtotal_cents,
             (select max(cb.created_at) from public.order_chargebacks cb
              where cb.order_id = o.id and cb.kind = 'contestacao')
      from public.orders o
      where o.event_id = p_event_id and o.status = 'pago' and o.total_cents > 0
        and public.order_is_contested(o.id)
    ) x
    where v_first_payout is not null and x.at > v_first_payout
    order by x.at desc, x.order_id
    limit 20
  ) c;

  return jsonb_build_object(
    'viewer', v_viewer,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'organizer_public_name', v_profile.public_name,
    'today', v_today,
    'start_date', public.event_fee_due_date(p_event_id),
    'due_date', public.event_payout_due_date(p_event_id),
    'calendar_until', public.business_calendar_last_year(),
    'sold_cents', v_balance.sold_cents,
    'sold_orders', v_balance.sold_orders,
    'refunded_cents', v_balance.refunded_cents,
    'refunded_orders', v_balance.refunded_orders,
    'contested_cents', v_balance.contested_cents,
    'contested_orders', v_balance.contested_orders,
    'bank_fee_cents', v_balance.bank_fee_cents,
    'pending_fee_orders', v_balance.pending_fee_orders,
    'pending_cents', v_balance.pending_cents,
    'share_cents', v_balance.share_cents,
    'paid_out_cents', v_balance.paid_out_cents,
    'balance_cents', v_balance.balance_cents,
    'decision_orders', v_balance.decision_orders,
    'service_fee_cents', v_balance.service_fee_cents,
    'flag', v_flag,
    'history', v_history,
    'late_changes', v_late,
    'pix', jsonb_build_object(
      'type', v_profile.pix_key_type,
      'masked', public.mask_pix_key(v_profile.pix_key_type, v_profile.pix_key),
      'holder_name', v_profile.pix_holder_name,
      'document_masked', public.mask_tax_document(v_profile.pix_holder_document),
      'changed_at', v_profile.pix_key_changed_at,
      'change_pending', public.organizer_pix_change_pending(v_event.organizer_id)),
    'team', case when v_team then jsonb_build_object(
      'organizer_id', v_event.organizer_id,
      'release_until', (select max(f.money_release_date)
                        from public.order_payment_fees f
                        join public.orders o on o.id = f.order_id
                        where o.event_id = p_event_id),
      'pix_changed_recently', coalesce(v_profile.pix_key_changed_at > now() - interval '30 days', false)) end
  );
end;
$$;

-- Página "Repasses" da equipe (Admin e desenvolvedor). Situação calculada (spec 10.4):
-- atrasado, a pagar, em andamento, depois o resto.
create function public.organizer_payouts_overview(p_admin uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_events jsonb;
  v_owing jsonb;
  v_payouts jsonb;
begin
  perform public.assert_finance_admin(p_admin, false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'ORG_PERIODO: Período inválido.';
  end if;

  with ev as (
    select e.id, e.name, e.organizer_id, op.public_name, op.status as organizer_status,
           public.event_fee_due_date(e.id) as start_date, public.event_payout_due_date(e.id) as due_date,
           b.sold_cents, b.sold_orders, b.refunded_cents, b.refunded_orders, b.contested_cents,
           b.contested_orders, b.bank_fee_cents, b.pending_fee_orders, b.pending_cents, b.share_cents,
           b.paid_out_cents, b.balance_cents, b.decision_orders, b.service_fee_cents
    from public.organizer_finance_event_ids() as ids(id)
    join public.events e on e.id = ids.id
    join public.organizer_profiles op on op.user_id = e.organizer_id
    cross join lateral public.organizer_event_balance(e.id) b
  ),
  st as (
    select ev.*,
      case
        when ev.start_date is null or v_today < ev.start_date then 'em_andamento'
        when ev.balance_cents > 0 and ev.due_date is not null and v_today > ev.due_date then 'atrasado'
        when ev.balance_cents > 0 then 'a_pagar'
        when ev.balance_cents < 0 then 'desconto'
        else 'em_dia'
      end as status
    from ev
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', st.id, 'event_name', st.name,
      'organizer_id', st.organizer_id, 'organizer_public_name', st.public_name,
      'organizer_status', st.organizer_status,
      'start_date', st.start_date, 'due_date', st.due_date, 'status', st.status,
      'sold_cents', st.sold_cents, 'sold_orders', st.sold_orders,
      'refunded_cents', st.refunded_cents, 'refunded_orders', st.refunded_orders,
      'contested_cents', st.contested_cents, 'contested_orders', st.contested_orders,
      'bank_fee_cents', st.bank_fee_cents, 'pending_fee_orders', st.pending_fee_orders,
      'pending_cents', st.pending_cents, 'share_cents', st.share_cents,
      'paid_out_cents', st.paid_out_cents, 'balance_cents', st.balance_cents,
      'decision_orders', st.decision_orders, 'service_fee_cents', st.service_fee_cents,
      'last_payout_at', (
        select max(coalesce(p.pix_date, (p.created_at at time zone 'America/Sao_Paulo')::date))
        from public.organizer_payout_items i
        join public.organizer_payouts p on p.id = i.payout_id
        where i.event_id = st.id and i.amount_cents > 0 and p.kind in ('repasse', 'compensacao')),
      'flag', (
        select jsonb_build_object('negative_since', f.negative_since, 'return_due_date', f.return_due_date)
        from public.organizer_balance_flags f
        where f.event_id = st.id and f.resolved_at is null),
      'pix_change_pending', public.organizer_pix_change_pending(st.organizer_id))
      order by
        case st.status when 'atrasado' then 0 when 'a_pagar' then 1 when 'em_andamento' then 2 else 3 end,
        st.due_date nulls last, st.start_date nulls last, st.name, st.id), '[]'::jsonb)
    into v_events
  from st;

  select coalesce(jsonb_agg(jsonb_build_object(
      'organizer_id', x.organizer_id, 'public_name', x.public_name,
      'owed_cents', x.owed_cents, 'return_due_date', x.return_due_date)
      order by x.return_due_date nulls last, x.public_name, x.organizer_id), '[]'::jsonb)
    into v_owing
  from (
    select op.user_id as organizer_id, op.public_name, d.owed_cents,
           (select min(f.return_due_date) from public.organizer_balance_flags f
            where f.organizer_id = op.user_id and f.resolved_at is null) as return_due_date
    from public.organizer_profiles op
    cross join lateral (
      select coalesce(-sum(pd.balance_cents), 0)::bigint as owed_cents
      from public.organizer_pending_discounts(op.user_id, null) pd
    ) d
    where d.owed_cents > 0
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'payout_id', p.id, 'kind', p.kind, 'amount_cents', p.amount_cents,
      'pix_date', p.pix_date, 'created_at', p.created_at, 'created_by_name', p.created_by_name,
      'note', p.note, 'reason', p.reason,
      'organizer_id', p.organizer_id, 'organizer_public_name', op.public_name,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'event_id', i.event_id, 'event_name', e.name, 'amount_cents', i.amount_cents)
            order by i.amount_cents desc, e.name, i.event_id), '[]'::jsonb)
        from public.organizer_payout_items i
        join public.events e on e.id = i.event_id
        where i.payout_id = p.id))
      order by p.created_at desc, p.id), '[]'::jsonb)
    into v_payouts
  from public.organizer_payouts p
  join public.organizer_profiles op on op.user_id = p.organizer_id
  where (p.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
     or p.pix_date between p_from and p_to;

  return jsonb_build_object(
    'today', v_today,
    'calendar_until', public.business_calendar_last_year(),
    'events', v_events,
    'organizers_owing', v_owing,
    'payouts', v_payouts
  );
end;
$$;

-- Diálogo "Registrar repasse": chave PIX completa, carregada sob demanda, só para o Admin que grava.
create function public.organizer_payout_details(p_admin uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_organizer uuid;
  v_profile public.organizer_profiles%rowtype;
  v_preview jsonb;
begin
  perform public.assert_finance_admin(p_admin, true);
  select e.organizer_id into v_organizer from public.events e where e.id = p_event_id;
  if v_organizer is null then
    raise exception 'ORG_ACESSO: Evento sem organizador.';
  end if;
  select * into v_profile from public.organizer_profiles op where op.user_id = v_organizer;
  v_preview := public.organizer_payout_preview(p_event_id);
  return jsonb_build_object(
    'pix_key_type', v_profile.pix_key_type,
    'pix_key', v_profile.pix_key,
    'pix_holder_name', v_profile.pix_holder_name,
    'pix_holder_document', v_profile.pix_holder_document,
    'pix_key_changed_at', v_profile.pix_key_changed_at,
    'expected_amount_cents', (v_preview ->> 'amount_cents')::bigint,
    'kind', v_preview ->> 'kind',
    'balance_cents', (v_preview ->> 'balance_cents')::bigint,
    'pending_fee_orders', (v_preview ->> 'pending_fee_orders')::integer,
    'discounts', v_preview -> 'discounts',
    'release_until', (select max(f.money_release_date)
                      from public.order_payment_fees f
                      join public.orders o on o.id = f.order_id
                      where o.event_id = p_event_id)
  );
end;
$$;

-- Uma linha por item de lançamento do período (sem chave, titular ou documento).
create function public.organizer_payouts_csv(p_admin uuid, p_from date, p_to date)
returns table (
  data_pix date, registrado_em timestamptz, tipo text, organizador text, evento text,
  valor_cents integer, registrado_por text, nota_ou_motivo text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.assert_finance_admin(p_admin, false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'ORG_PERIODO: Período inválido.';
  end if;
  return query
  select p.pix_date, p.created_at, p.kind, op.public_name, e.name, i.amount_cents,
         p.created_by_name, coalesce(p.note, p.reason)
  from public.organizer_payouts p
  join public.organizer_payout_items i on i.payout_id = p.id
  join public.organizer_profiles op on op.user_id = p.organizer_id
  join public.events e on e.id = i.event_id
  where (p.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
     or p.pix_date between p_from and p_to
  order by p.created_at, p.id, i.amount_cents desc, e.name, i.event_id;
end;
$$;

-- 7) Envio para aprovação: recusa com devolução atrasada ----------------------------------

drop function public.submit_event_for_approval(uuid, uuid);

create function public.submit_event_for_approval(p_actor uuid, p_event_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_problem text;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento de outro organizador.';
  end if;
  if public.organizer_overdue_refunds(p_actor) > 0 then
    raise exception 'ORG_DEVOLUCAO: Há devolução ao Espaço Byla em atraso.';
  end if;
  select * into v_event from public.events e where e.id = p_event_id for update;
  if v_event.approval_status not in ('rascunho', 'recusado') then
    raise exception 'ORG_ESTADO:estado';
  end if;
  v_problem := public.organizer_submission_problem(p_event_id);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  perform set_config('byla.organizer_flow', 'on', true);
  update public.events e
  set approval_status = 'em_analise', submitted_at = now(), approval_note = null, updated_at = now()
  where e.id = p_event_id;
  perform set_config('byla.organizer_flow', '', true);

  perform public.log_audit(p_actor, 'evento_enviado', p_event_id, null, p_actor, '{}'::jsonb);
end;
$$;

-- 8) Permissões ----------------------------------------------------------------------------

revoke execute on function public.mask_pix_key(text, text) from public, anon, authenticated;
revoke execute on function public.mask_tax_document(text) from public, anon, authenticated;
revoke execute on function public.organizer_pix_change_pending(uuid) from public, anon, authenticated;
revoke execute on function public.organizer_event_balance(uuid) from public, anon, authenticated;
revoke execute on function public.organizer_finance_event_ids() from public, anon, authenticated;
revoke execute on function public.organizer_pending_discounts(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.organizer_payout_preview(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_balance_flags(uuid) from public, anon, authenticated;
revoke execute on function public.record_organizer_payout(uuid, uuid, integer, date, text) from public, anon, authenticated;
revoke execute on function public.record_organizer_payout_adjustment(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.record_organizer_refund_received(uuid, uuid, integer, date, text) from public, anon, authenticated;
revoke execute on function public.refresh_organizer_balance_flags() from public, anon, authenticated;
revoke execute on function public.mark_balance_flag_notified(uuid) from public, anon, authenticated;
revoke execute on function public.organizer_overdue_refunds(uuid) from public, anon, authenticated;
revoke execute on function public.organizer_finance_daily_summary() from public, anon, authenticated;
revoke execute on function public.organizer_event_finance(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.organizer_payouts_overview(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.organizer_payout_details(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.organizer_payouts_csv(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.submit_event_for_approval(uuid, uuid) from public, anon, authenticated;

grant execute on function public.mask_pix_key(text, text) to service_role;
grant execute on function public.mask_tax_document(text) to service_role;
grant execute on function public.organizer_pix_change_pending(uuid) to service_role;
grant execute on function public.organizer_event_balance(uuid) to service_role;
grant execute on function public.organizer_finance_event_ids() to service_role;
grant execute on function public.organizer_pending_discounts(uuid, uuid) to service_role;
grant execute on function public.organizer_payout_preview(uuid) to service_role;
grant execute on function public.resolve_balance_flags(uuid) to service_role;
grant execute on function public.record_organizer_payout(uuid, uuid, integer, date, text) to service_role;
grant execute on function public.record_organizer_payout_adjustment(uuid, uuid, integer, text) to service_role;
grant execute on function public.record_organizer_refund_received(uuid, uuid, integer, date, text) to service_role;
grant execute on function public.refresh_organizer_balance_flags() to service_role;
grant execute on function public.mark_balance_flag_notified(uuid) to service_role;
grant execute on function public.organizer_overdue_refunds(uuid) to service_role;
grant execute on function public.organizer_finance_daily_summary() to service_role;
grant execute on function public.organizer_event_finance(uuid, uuid) to service_role;
grant execute on function public.organizer_payouts_overview(uuid, date, date) to service_role;
grant execute on function public.organizer_payout_details(uuid, uuid) to service_role;
grant execute on function public.organizer_payouts_csv(uuid, date, date) to service_role;
grant execute on function public.submit_event_for_approval(uuid, uuid) to service_role;
