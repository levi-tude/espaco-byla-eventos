-- Sessões, fase 2: check-in pela sessão escolhida na portaria (spec
-- 2026-10-03-sessoes-design, seções 6.5 e 11). Migration ADITIVA: aplicar ANTES do
-- deploy. A assinatura antiga continua na janela de deploy, mas recusa (falha
-- fechada) ingresso de sessão cancelada e de evento com mais de uma sessão; sai na
-- limpeza (fase 7).

-- v2: a portaria informa a sessão. Resultados novos, conferidos nesta ordem depois
-- de "evento_errado":
--   sessao_cancelada → ingresso de sessão cancelada, qualquer que seja a sessão
--                      escolhida (vale para pago, aguardando decisão e cortesia);
--   sessao_errada    → volta só o nome e o início da sessão do ingresso.
-- Em "ok" volta também sessão, início e evento para o "Pode entrar". Nunca volta
-- e-mail, telefone ou token do comprador.
create function public.check_in_ticket(
  p_event_id uuid,
  p_session_id uuid,
  p_code text,
  p_staff_user_id uuid
)
returns table (
  outcome text,
  buyer_name text,
  ticket_kind public.ticket_kind,
  type_name text,
  other_event_name text,
  other_session_name text,
  other_session_starts_at timestamptz,
  session_name text,
  session_starts_at timestamptz,
  event_name text
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_ticket public.tickets%rowtype;
  v_ticket_session public.event_sessions%rowtype;
  v_type_name text;
  v_event_name text;
begin
  if p_staff_user_id is null or not exists (
    select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id
  ) then
    raise exception 'CHECKIN_EQUIPE: Acesso restrito à equipe.';
  end if;
  if p_event_id is null or p_session_id is null or not exists (
    select 1 from public.event_sessions s
    where s.id = p_session_id and s.event_id = p_event_id
  ) then
    raise exception 'CHECKIN_DADOS: Dados inválidos.';
  end if;

  if char_length(v_code) not between 1 and 100 then
    return query select 'nao_encontrado'::text, null::text, null::public.ticket_kind,
      null::text, null::text, null::text, null::timestamptz, null::text, null::timestamptz,
      null::text;
    return;
  end if;

  -- Trava o ingresso: com dois leitores ao mesmo tempo, só o primeiro registra a entrada.
  select * into v_ticket from public.tickets t where t.code = v_code for update;
  if not found then
    return query select 'nao_encontrado'::text, null::text, null::public.ticket_kind,
      null::text, null::text, null::text, null::timestamptz, null::text, null::timestamptz,
      null::text;
    return;
  end if;

  if v_ticket.event_id <> p_event_id then
    select e.name into v_event_name from public.events e where e.id = v_ticket.event_id;
    return query select 'evento_errado'::text, null::text, null::public.ticket_kind,
      null::text, v_event_name, null::text, null::timestamptz, null::text, null::timestamptz,
      null::text;
    return;
  end if;

  select * into v_ticket_session from public.event_sessions s where s.id = v_ticket.session_id;

  if v_ticket_session.status = 'cancelada' then
    return query select 'sessao_cancelada'::text, null::text, null::public.ticket_kind,
      null::text, null::text, null::text, null::timestamptz, null::text, null::timestamptz,
      null::text;
    return;
  end if;

  if v_ticket.session_id <> p_session_id then
    return query select 'sessao_errada'::text, null::text, null::public.ticket_kind,
      null::text, null::text, v_ticket_session.name, v_ticket_session.starts_at,
      null::text, null::timestamptz, null::text;
    return;
  end if;

  if v_ticket.status <> 'pago' then
    return query select
      case v_ticket.status::text
        when 'check_in' then 'ja_usado'
        when 'nao_pago' then 'nao_pago'
        when 'cancelado' then 'cancelado'
        when 'estornado' then 'estornado'
        else 'invalido'
      end,
      null::text, null::public.ticket_kind, null::text, null::text, null::text,
      null::timestamptz, null::text, null::timestamptz, null::text;
    return;
  end if;

  update public.tickets t
  set status = 'check_in',
      checked_in_at = now(),
      checked_in_by = p_staff_user_id
  where t.id = v_ticket.id;

  select oi.name into v_type_name from public.order_items oi where oi.id = v_ticket.order_item_id;
  select e.name into v_event_name from public.events e where e.id = v_ticket.event_id;

  return query select 'ok'::text, v_ticket.buyer_name, v_ticket.kind, v_type_name,
    null::text, null::text, null::timestamptz, v_ticket_session.name,
    v_ticket_session.starts_at, v_event_name;
end;
$$;

-- Assinatura antiga (código anterior, na janela de deploy): mesmo comportamento
-- de antes para evento de sessão única ativa; com sessão cancelada ou evento de
-- várias sessões, recusa sem marcar entrada.
create or replace function public.check_in_ticket(
  p_event_id uuid,
  p_code text,
  p_staff_user_id uuid
)
returns table (
  outcome text,
  buyer_name text,
  ticket_kind public.ticket_kind,
  type_name text,
  other_event_name text
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_ticket public.tickets%rowtype;
  v_session_status text;
  v_type_name text;
  v_other_event_name text;
begin
  if p_staff_user_id is null or not exists (
    select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id
  ) then
    raise exception 'CHECKIN_EQUIPE: Acesso restrito à equipe.';
  end if;
  if p_event_id is null then
    raise exception 'CHECKIN_DADOS: Dados inválidos.';
  end if;

  if char_length(v_code) not between 1 and 100 then
    return query select 'nao_encontrado'::text, null::text, null::public.ticket_kind,
      null::text, null::text;
    return;
  end if;

  select * into v_ticket from public.tickets t where t.code = v_code for update;
  if not found then
    return query select 'nao_encontrado'::text, null::text, null::public.ticket_kind,
      null::text, null::text;
    return;
  end if;

  if v_ticket.event_id <> p_event_id then
    select e.name into v_other_event_name from public.events e where e.id = v_ticket.event_id;
    return query select 'evento_errado'::text, null::text, null::public.ticket_kind,
      null::text, v_other_event_name;
    return;
  end if;

  select s.status into v_session_status from public.event_sessions s where s.id = v_ticket.session_id;
  if v_session_status is distinct from 'ativa'
    or (select count(*) from public.event_sessions s where s.event_id = p_event_id) <> 1 then
    return query select 'invalido'::text, null::text, null::public.ticket_kind,
      null::text, null::text;
    return;
  end if;

  if v_ticket.status <> 'pago' then
    return query select
      case v_ticket.status::text
        when 'check_in' then 'ja_usado'
        when 'nao_pago' then 'nao_pago'
        when 'cancelado' then 'cancelado'
        when 'estornado' then 'estornado'
        else 'invalido'
      end,
      null::text, null::public.ticket_kind, null::text, null::text;
    return;
  end if;

  update public.tickets t
  set status = 'check_in',
      checked_in_at = now(),
      checked_in_by = p_staff_user_id
  where t.id = v_ticket.id;

  select oi.name into v_type_name from public.order_items oi where oi.id = v_ticket.order_item_id;

  return query select 'ok'::text, v_ticket.buyer_name, v_ticket.kind, v_type_name, null::text;
end;
$$;

revoke all on function public.check_in_ticket(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.check_in_ticket(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.check_in_ticket(uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.check_in_ticket(uuid, text, uuid)
  to service_role;
