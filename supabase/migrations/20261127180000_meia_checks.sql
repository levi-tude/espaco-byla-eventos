-- Conferência da meia-entrada na portaria (pedido do Levi, 27/11/2026).
--
-- Migration ADITIVA e idempotente (pode rodar de novo sem efeito). Pode ser aplicada antes
-- ou depois do deploy do código: sem ela, a portaria esconde os botões da conferência e o
-- check-in segue igual. Não mexe em check_in_ticket nem nas regras de entrada.
--
-- O que guarda: por ingresso de meia, cada marcação feita na portaria — "comprovante_ok",
-- "pagou_diferenca" (com o valor inteira − meia da sessão) ou "recusado" — com quem marcou
-- e quando. A situação atual é a marcação mais recente; as anteriores ficam como histórico
-- (correção de toque errado). "recusado" desfaz o check-in do ingresso na mesma transação.
--
-- Acesso: só pelas funções abaixo, SECURITY DEFINER, executáveis só por authenticated (com
-- a sessão do próprio usuário: auth.uid() + código do e-mail confirmado nesta sessão),
-- com a mesma regra de quem pode registrar entrada (equipe em todos os eventos, dono só nos
-- próprios: actor_event_access). service_role e anon não têm acesso (ver 20261022160000).
-- A equipe verificada lê a tabela pela RLS (lista de participantes).
--
-- Voltar atrás (sem dados a preservar):
--   drop function if exists public.record_meia_check(uuid, uuid, text);
--   drop function if exists public.meia_check_summary(uuid, uuid);
--   drop table if exists public.meia_checks;

-- 1) Tabela (só histórico: ninguém escreve direto) --------------------------------------

create table if not exists public.meia_checks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  session_id uuid not null references public.event_sessions (id) on delete cascade,
  result text not null,
  diff_cents integer,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_kind text not null,
  created_at timestamptz not null default now(),
  constraint meia_checks_result_check
    check (result in ('comprovante_ok', 'pagou_diferenca', 'recusado')),
  constraint meia_checks_diff_check
    check (
      (result = 'pagou_diferenca' and (diff_cents is null or diff_cents between 0 and 10000000))
      or (result <> 'pagou_diferenca' and diff_cents is null)
    ),
  constraint meia_checks_actor_kind_check check (actor_kind in ('equipe', 'dono'))
);

create index if not exists meia_checks_ticket_idx
  on public.meia_checks (ticket_id, created_at desc, id desc);
create index if not exists meia_checks_session_idx on public.meia_checks (session_id);
create index if not exists meia_checks_event_idx on public.meia_checks (event_id);

alter table public.meia_checks enable row level security;
revoke all on table public.meia_checks from public, anon, authenticated, service_role;
grant select on table public.meia_checks to authenticated;

drop policy if exists meia_checks_staff_read on public.meia_checks;
create policy meia_checks_staff_read on public.meia_checks
  for select to authenticated
  using (public.is_staff());

comment on table public.meia_checks is
  'Conferência da meia-entrada na portaria (histórico; a mais recente vale). Escrita só por record_meia_check; leitura da equipe verificada (RLS) e resumo por meia_check_summary. Sem acesso de anon nem service_role.';

-- 2) Marcar a conferência -----------------------------------------------------------------

-- Resultado em vez de erro para os casos esperados da portaria:
--   ok            → marcado (ou já estava marcado igual: não duplica);
--   nao_encontrado→ ingresso inexistente, de outro evento ou sem acesso a ele;
--   nao_meia      → o ingresso não é meia-entrada;
--   sem_entrada   → o ingresso não está com check-in (ex.: já recusado; ler o QR de novo).
-- Erros: MEIA_ACESSO (sem login verificado / não é equipe nem organizador ativo),
-- MEIA_DADOS (parâmetros inválidos).
create or replace function public.record_meia_check(
  p_event_id uuid,
  p_ticket_id uuid,
  p_result text
)
returns table (
  outcome text,
  result text,
  diff_cents integer,
  checked_at timestamptz,
  checked_in boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_access text;
  v_ticket public.tickets%rowtype;
  v_last public.meia_checks%rowtype;
  v_full integer;
  v_diff integer;
  v_now timestamptz := now();
begin
  if v_uid is null or not public.session_is_verified() then
    raise exception 'MEIA_ACESSO: Acesso não autorizado.';
  end if;
  if not exists (select 1 from public.staff_profiles sp where sp.user_id = v_uid)
     and not public.organizer_is_active(v_uid) then
    raise exception 'MEIA_ACESSO: Acesso não autorizado.';
  end if;
  if p_event_id is null or p_ticket_id is null
     or p_result is null or p_result not in ('comprovante_ok', 'pagou_diferenca', 'recusado') then
    raise exception 'MEIA_DADOS: Dados inválidos.';
  end if;

  -- Mesma trava de linha do check-in: marcar e ler o QR ao mesmo tempo ficam em fila.
  select * into v_ticket from public.tickets t where t.id = p_ticket_id for update;
  if not found or v_ticket.event_id <> p_event_id then
    return query select 'nao_encontrado'::text, null::text, null::integer, null::timestamptz, null::boolean;
    return;
  end if;

  v_access := public.actor_event_access(v_uid, v_ticket.event_id);
  if v_access is null then
    return query select 'nao_encontrado'::text, null::text, null::integer, null::timestamptz, null::boolean;
    return;
  end if;

  if v_ticket.kind <> 'meia' then
    return query select 'nao_meia'::text, null::text, null::integer, null::timestamptz, null::boolean;
    return;
  end if;

  select * into v_last
  from public.meia_checks c
  where c.ticket_id = v_ticket.id
  order by c.created_at desc, c.id desc
  limit 1;

  if v_ticket.status <> 'check_in' then
    return query select 'sem_entrada'::text, v_last.result, v_last.diff_cents, v_last.created_at, false;
    return;
  end if;

  -- Idempotente: tocar de novo no mesmo botão não cria outra linha.
  if v_last.id is not null and v_last.result = p_result then
    return query select 'ok'::text, v_last.result, v_last.diff_cents, v_last.created_at, true;
    return;
  end if;

  if p_result = 'pagou_diferenca' then
    -- Preço da inteira nesta sessão (ou o do tipo), menos o que foi pago na meia.
    select coalesce(stt.price_cents, tt.price_cents) into v_full
    from public.ticket_types tt
    left join public.session_ticket_types stt
      on stt.ticket_type_id = tt.id and stt.session_id = v_ticket.session_id
    where tt.event_id = v_ticket.event_id
      and tt.kind = 'inteira'
      and coalesce(tt.people_per_unit, 1) = 1
    order by (tt.preset = 'inteira') desc nulls last,
      (tt.archived_at is null) desc,
      tt.sort_order nulls last,
      tt.id
    limit 1;
    v_diff := case when v_full is null then null else greatest(v_full - v_ticket.price_cents, 0) end;
  end if;

  insert into public.meia_checks (ticket_id, event_id, session_id, result, diff_cents, actor_user_id, actor_kind, created_at)
  values (v_ticket.id, v_ticket.event_id, v_ticket.session_id, p_result, v_diff, v_uid, v_access, v_now);

  if p_result = 'recusado' then
    -- Desfaz a entrada: o ingresso volta a valer e pode entrar depois com o comprovante.
    update public.tickets t
    set status = 'pago',
        checked_in_at = null,
        checked_in_by = null
    where t.id = v_ticket.id and t.status = 'check_in';
  end if;

  return query select 'ok'::text, p_result, v_diff, v_now, (p_result <> 'recusado');
end;
$$;

-- 3) Resumo por sessão (ou do evento inteiro, com p_session_id nulo) ----------------------

-- meias_lidas: meias com entrada agora + recusadas; nao_registradas: com entrada e sem
-- marcação válida (nunca marcada, ou recusada antes e lida de novo sem nova marcação).
create or replace function public.meia_check_summary(p_event_id uuid, p_session_id uuid)
returns table (
  meias_lidas integer,
  comprovante_ok integer,
  pagou_diferenca integer,
  diferenca_total_cents bigint,
  recusadas integer,
  nao_registradas integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.session_is_verified()
     or public.actor_event_access(v_uid, p_event_id) is null then
    raise exception 'MEIA_ACESSO: Acesso não autorizado.';
  end if;
  if p_session_id is not null and not exists (
    select 1 from public.event_sessions s where s.id = p_session_id and s.event_id = p_event_id
  ) then
    raise exception 'MEIA_DADOS: Dados inválidos.';
  end if;

  return query
  with meia as (
    select t.id, t.status
    from public.tickets t
    where t.event_id = p_event_id
      and (p_session_id is null or t.session_id = p_session_id)
      and t.kind = 'meia'
      and t.status in ('pago', 'check_in')
  ), latest as (
    select distinct on (c.ticket_id) c.ticket_id, c.result, c.diff_cents
    from public.meia_checks c
    join meia m on m.id = c.ticket_id
    order by c.ticket_id, c.created_at desc, c.id desc
  )
  select
    (count(*) filter (where m.status = 'check_in' or l.result = 'recusado'))::integer,
    (count(*) filter (where m.status = 'check_in' and l.result = 'comprovante_ok'))::integer,
    (count(*) filter (where m.status = 'check_in' and l.result = 'pagou_diferenca'))::integer,
    coalesce(sum(l.diff_cents) filter (where m.status = 'check_in' and l.result = 'pagou_diferenca'), 0)::bigint,
    (count(*) filter (where m.status = 'pago' and l.result = 'recusado'))::integer,
    (count(*) filter (where m.status = 'check_in' and (l.result is null or l.result = 'recusado')))::integer
  from meia m
  left join latest l on l.ticket_id = m.id;
end;
$$;

-- 4) Permissões: só authenticated (com a própria sessão); nada para anon/service_role ------

revoke all on function public.record_meia_check(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.meia_check_summary(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_meia_check(uuid, uuid, text) to authenticated;
grant execute on function public.meia_check_summary(uuid, uuid) to authenticated;
