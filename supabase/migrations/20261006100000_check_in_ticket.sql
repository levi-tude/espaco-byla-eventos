-- Check-in pela função do banco (aprovado em 2026-10-03). Só acrescenta coisas:
-- o código atual continua funcionando enquanto o deploy novo não sai. Quem tira
-- a escrita direta da equipe em ingressos e pedidos é a migration seguinte.

alter table public.tickets
  add column checked_in_by uuid references auth.users (id) on delete set null;

-- Resultado em vez de erro para os casos esperados da portaria. Em "evento_errado"
-- volta só o nome do outro evento (nada do comprador).
create function public.check_in_ticket(
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

  -- Trava o ingresso: com dois leitores ao mesmo tempo, só o primeiro registra a entrada.
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

-- "Cancelar" da equipe vale só para cortesia ainda sem entrada.
create function public.cancel_courtesy_ticket(
  p_event_id uuid,
  p_ticket_id uuid,
  p_staff_user_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_staff_user_id is null or not exists (
    select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id
  ) then
    raise exception 'Acesso restrito à equipe.';
  end if;

  update public.tickets t
  set status = 'cancelado',
      cancelled_at = now()
  where t.id = p_ticket_id
    and t.event_id = p_event_id
    and t.kind = 'cortesia'
    and t.status = 'pago';

  if found then
    return 'cancelled';
  end if;
  return 'not_allowed';
end;
$$;

revoke all on function public.check_in_ticket(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_courtesy_ticket(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.check_in_ticket(uuid, text, uuid)
  to service_role;
grant execute on function public.cancel_courtesy_ticket(uuid, uuid, uuid)
  to service_role;
