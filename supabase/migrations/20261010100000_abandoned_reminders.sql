-- Fase 6: um único lembrete por e-mail para compra não finalizada.
-- Só o servidor (service_role) usa estas funções. O agendamento fica em
-- 20261010110000_abandoned_reminders_schedule.sql e começa desligado.

alter table public.orders
  add column reminder_claimed_at timestamptz,
  add column reminder_sent_at timestamptz,
  add column reminder_attempts smallint not null default 0,
  add column reminder_optout_token text;

alter table public.orders
  add constraint orders_reminder_attempts_check check (reminder_attempts between 0 and 10),
  add constraint orders_reminder_optout_token_format check (
    reminder_optout_token is null or reminder_optout_token ~ '^[0-9a-f]{64}$'
  ),
  add constraint orders_reminder_sent_requires_claim check (
    reminder_sent_at is null or reminder_claimed_at is not null
  );

create unique index orders_reminder_optout_token_uidx
  on public.orders (reminder_optout_token)
  where reminder_optout_token is not null;

create index orders_reminder_candidates_idx
  on public.orders (created_at)
  where reminder_sent_at is null and status in ('pendente', 'expirado');

create index orders_reminder_claimed_at_idx
  on public.orders (reminder_claimed_at)
  where reminder_claimed_at is not null;

create index orders_event_buyer_email_idx
  on public.orders (event_id, lower(btrim(buyer_email)));

-- Descadastro guardado só como hash do e-mail normalizado; vale para todos os eventos.
create table public.email_reminder_optouts (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.email_reminder_optouts enable row level security;
revoke all on table public.email_reminder_optouts from public, anon, authenticated;
grant select, insert on table public.email_reminder_optouts to service_role;

create or replace function public.reminder_email_hash(p_email text)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;

-- Reivindica até p_limit pedidos abandonados para lembrete e devolve os dados
-- do e-mail. Erros com prefixo estável (LEMBRETE_*).
create or replace function public.claim_abandoned_order_reminders(
  p_limit integer,
  p_daily_cap integer,
  p_min_policy_version text
)
returns table (
  order_id uuid,
  public_token text,
  buyer_name text,
  buyer_email text,
  optout_token text,
  event_name text,
  event_slug text,
  event_venue text,
  event_starts_at timestamptz,
  items jsonb
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_used integer;
  v_take integer;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'LEMBRETE_LIMITE_INVALIDO';
  end if;
  if p_daily_cap is null or p_daily_cap not between 1 and 100 then
    raise exception 'LEMBRETE_TETO_INVALIDO';
  end if;
  if p_min_policy_version is null or p_min_policy_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'LEMBRETE_POLITICA_INVALIDA';
  end if;

  -- Uma execução por vez: o teto diário e a regra de 1 lembrete por e-mail e
  -- evento não podem ser furados por execuções sobrepostas.
  perform pg_advisory_xact_lock(hashtextextended('byla:abandoned-reminders', 0));

  -- Janela móvel de 24 h: nunca passa do teto em nenhum dia do calendário.
  select count(*) into v_used
  from public.orders o
  where o.reminder_claimed_at > now() - interval '24 hours';

  v_take := least(p_limit, p_daily_cap - v_used);
  if v_take <= 0 then
    return;
  end if;

  return query
  with candidates as (
    select o.id
    from public.orders o
    join public.events e on e.id = o.event_id
    where (
        o.status = 'expirado'
        or (o.status = 'pendente' and o.expires_at <= now())
      )
      and o.total_cents > 0
      and o.created_at <= now() - interval '60 minutes'
      and o.created_at > now() - interval '24 hours'
      and o.reminder_sent_at is null
      and (
        o.reminder_claimed_at is null
        or o.reminder_claimed_at < now() - interval '30 minutes'
      )
      and o.reminder_attempts < 3
      and o.privacy_policy_version ~ '^\d{4}-\d{2}-\d{2}$'
      and o.privacy_policy_version >= p_min_policy_version
      and e.sales_open
      and e.starts_at > now()
      and e.capacity > public.event_occupied_count(e.id)
      -- Só o pedido mais novo do e-mail no evento, e no máximo 1 lembrete por e-mail e evento.
      and not exists (
        select 1
        from public.orders other
        where other.event_id = o.event_id
          and other.id <> o.id
          and lower(btrim(other.buyer_email)) = lower(btrim(o.buyer_email))
          and (
            other.created_at > o.created_at
            or other.reminder_claimed_at is not null
            or other.reminder_sent_at is not null
          )
      )
      and not exists (
        select 1
        from public.email_reminder_optouts x
        where x.email_hash = public.reminder_email_hash(o.buyer_email)
      )
    order by o.created_at
    limit v_take
    for update of o skip locked
  ),
  claimed as (
    update public.orders o
    set reminder_claimed_at = now(),
        reminder_attempts = o.reminder_attempts + 1,
        reminder_optout_token = coalesce(
          o.reminder_optout_token,
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
        )
    from candidates c
    where o.id = c.id
    returning o.id, o.public_token, o.buyer_name, o.buyer_email,
      o.reminder_optout_token, o.event_id, o.created_at
  )
  select
    c.id,
    c.public_token,
    c.buyer_name,
    c.buyer_email,
    c.reminder_optout_token,
    e.name,
    e.slug,
    e.venue,
    e.starts_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('name', i.name, 'quantity', i.quantity)
          order by i.created_at, i.id
        )
        from public.order_items i
        where i.order_id = c.id
      ),
      '[]'::jsonb
    )
  from claimed c
  join public.events e on e.id = c.event_id
  order by c.created_at;
end;
$$;

create or replace function public.mark_abandoned_reminder_sent(p_order_id uuid)
returns boolean
language sql
set search_path = ''
as $$
  with updated as (
    update public.orders
    set reminder_sent_at = now()
    where id = p_order_id
      and reminder_claimed_at is not null
      and reminder_sent_at is null
    returning 1
  )
  select exists (select 1 from updated);
$$;

-- Envio falhou: libera para outra tentativa (até 3, contadas na reivindicação).
create or replace function public.release_abandoned_reminder(p_order_id uuid)
returns boolean
language sql
set search_path = ''
as $$
  with updated as (
    update public.orders
    set reminder_claimed_at = null
    where id = p_order_id
      and reminder_claimed_at is not null
      and reminder_sent_at is null
    returning 1
  )
  select exists (select 1 from updated);
$$;

create or replace function public.register_reminder_optout(p_token text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select o.buyer_email into v_email
  from public.orders o
  where o.reminder_optout_token = p_token;

  if v_email is null then
    return false;
  end if;

  insert into public.email_reminder_optouts (email_hash)
  values (public.reminder_email_hash(v_email))
  on conflict (email_hash) do nothing;
  return true;
end;
$$;

revoke all on function public.reminder_email_hash(text) from public, anon, authenticated;
revoke all on function public.claim_abandoned_order_reminders(integer, integer, text) from public, anon, authenticated;
revoke all on function public.mark_abandoned_reminder_sent(uuid) from public, anon, authenticated;
revoke all on function public.release_abandoned_reminder(uuid) from public, anon, authenticated;
revoke all on function public.register_reminder_optout(text) from public, anon, authenticated;

grant execute on function public.reminder_email_hash(text) to service_role;
grant execute on function public.claim_abandoned_order_reminders(integer, integer, text) to service_role;
grant execute on function public.mark_abandoned_reminder_sent(uuid) to service_role;
grant execute on function public.release_abandoned_reminder(uuid) to service_role;
grant execute on function public.register_reminder_optout(text) to service_role;
