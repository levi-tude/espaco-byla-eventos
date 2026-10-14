-- Contas de organizador, fase 2 (spec 2026-10-13-contas-organizador-design, seções
-- 6.4 a 6.7 e 8.3/8.5; plano 2026-10-14-contas-organizador-fase2, tarefa 2): pedidos
-- à equipe (estorno, mudança, exclusão), lista de compradores do dono, exclusão do
-- próprio evento, pausa de vendas pelo dono, portaria só dos próprios eventos e os
-- números do menu da equipe.
--
-- ADITIVA: aplicar depois de 20261018100000_organizer_accounts e ANTES do deploy do
-- código da fase 2. Nenhuma tabela ou política nova. Com a área desligada
-- (organizer_settings.enabled = false) nenhum organizador passa por
-- actor_event_access, então nada muda para a equipe.
--
-- Todas as funções novas são só da service_role e security definer (leem
-- organizer_ops_requests e audit_log, fechadas até para a service_role). A portaria
-- continua security invoker. Ordem das travas: evento → pedido à equipe.

-- 1) Lista de compradores -------------------------------------------------------------

-- Só o que a seção 6.6 do spec mostra: nunca telefone, link do pedido, código do
-- ingresso nem IDs do pagamento.
create function public.organizer_event_orders(
  p_actor uuid,
  p_event_id uuid,
  p_session_id uuid default null
)
returns table (
  order_id uuid,
  created_at timestamptz,
  session_id uuid,
  session_name text,
  session_starts_at timestamptz,
  buyer_name text,
  buyer_email text,
  status text,
  is_courtesy boolean,
  items jsonb,
  tickets_subtotal_cents integer,
  tickets_total integer,
  tickets_checked_in integer,
  refund_request_status text,
  refund_request_reason text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if public.actor_event_access(p_actor, p_event_id) is null then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  return query
  select
    o.id,
    o.created_at,
    o.session_id,
    s.name,
    s.starts_at,
    o.buyer_name,
    o.buyer_email,
    o.status::text,
    exists (select 1 from public.tickets t where t.order_id = o.id and t.kind = 'cortesia'),
    coalesce((
      select jsonb_agg(jsonb_build_object('name', oi.name, 'quantity', oi.quantity) order by oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb),
    o.tickets_subtotal_cents,
    (select count(*)::integer from public.tickets t where t.order_id = o.id),
    (select count(*)::integer from public.tickets t where t.order_id = o.id and t.status = 'check_in'),
    rr.status,
    rr.reason
  from public.orders o
  left join public.event_sessions s on s.id = o.session_id
  left join lateral (
    select r.status, r.reason
    from public.organizer_ops_requests r
    where r.order_id = o.id and r.kind = 'estorno'
    order by r.created_at desc, r.id
    limit 1
  ) rr on true
  where o.event_id = p_event_id
    and o.status in ('pago', 'aguardando_decisao', 'estornado')
    and (p_session_id is null or o.session_id = p_session_id)
  order by o.created_at desc, o.id;
end;
$$;

-- 2) Pedidos à equipe (dono) ------------------------------------------------------------

-- O evento vem do próprio pedido: o dono nunca escolhe a qual evento o pedido pertence.
create function public.request_order_refund(p_actor uuid, p_order_id uuid, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORG_DONO: Pedido não encontrado.';
  end if;
  if public.actor_event_access(p_actor, v_order.event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Pedido não encontrado.';
  end if;
  if v_order.status <> 'pago' then
    raise exception 'ORG_ESTADO:nao_pago';
  end if;
  if exists (select 1 from public.tickets t where t.order_id = v_order.id and t.kind = 'cortesia')
     or exists (select 1 from public.order_items oi where oi.order_id = v_order.id and oi.kind = 'cortesia') then
    raise exception 'ORG_ESTADO:cortesia';
  end if;
  if exists (select 1 from public.tickets t where t.order_id = v_order.id and t.status = 'check_in') then
    raise exception 'ORG_ESTADO:check_in';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'ORG_DADOS: Motivo obrigatório (5 a 500 caracteres).';
  end if;
  if not public.consume_rate_limit(
    'org-ops:user',
    encode(sha256(convert_to('byla-rate-limit:' || p_actor::text, 'UTF8')), 'hex'),
    30,
    3600
  ) then
    raise exception 'ORG_LIMITE: Muitos pedidos em pouco tempo. Tente mais tarde.';
  end if;

  begin
    insert into public.organizer_ops_requests (kind, event_id, order_id, reason, requested_by)
    values ('estorno', v_order.event_id, v_order.id, v_reason, p_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ORG_ESTADO:ja_pedido';
  end;

  perform public.log_audit(
    p_actor, 'pedido_estorno_criado', v_order.event_id, v_order.id, p_actor,
    jsonb_build_object('request_id', v_id)
  );
  return v_id;
end;
$$;

-- Pedido estornado (por qualquer caminho: estorno da equipe, "Estornar todos" da
-- sessão): o pedido de estorno pendente vira atendido. Security definer porque quem
-- atualiza orders é a service_role, sem acesso a organizer_ops_requests.
create function public.orders_close_refund_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_request_id uuid;
  v_event_id uuid;
begin
  if new.status = 'estornado' and old.status <> 'estornado' then
    update public.organizer_ops_requests r
    set status = 'atendido', decided_at = now()
    where r.order_id = new.id and r.kind = 'estorno' and r.status = 'pendente'
    returning r.id, r.event_id into v_request_id, v_event_id;
    if v_request_id is not null then
      perform public.log_audit(
        null, 'pedido_atendido', v_event_id, new.id,
        (select e.organizer_id from public.events e where e.id = v_event_id),
        jsonb_build_object('request_id', v_request_id, 'kind', 'estorno')
      );
    end if;
  end if;
  return null;
end;
$$;

create trigger orders_close_refund_request
  after update of status on public.orders
  for each row
  when (new.status = 'estornado' and old.status is distinct from new.status)
  execute function public.orders_close_refund_request();

create function public.request_event_change(p_actor uuid, p_event_id uuid, p_what text, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_approval text;
  v_what text := btrim(coalesce(p_what, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  select e.approval_status into v_approval from public.events e where e.id = p_event_id for update;
  if v_approval is distinct from 'aprovado' then
    raise exception 'ORG_ESTADO:nao_aprovado';
  end if;
  if char_length(v_what) not between 5 and 500 or char_length(v_reason) not between 5 and 500 then
    raise exception 'ORG_DADOS: Descreva a mudança e o motivo (5 a 500 caracteres cada).';
  end if;
  if not public.consume_rate_limit(
    'org-ops:user',
    encode(sha256(convert_to('byla-rate-limit:' || p_actor::text, 'UTF8')), 'hex'),
    30,
    3600
  ) then
    raise exception 'ORG_LIMITE: Muitos pedidos em pouco tempo. Tente mais tarde.';
  end if;

  insert into public.organizer_ops_requests (kind, event_id, details, reason, requested_by)
  values ('mudanca', p_event_id, jsonb_build_object('o_que', v_what), v_reason, p_actor)
  returning id into v_id;

  perform public.log_audit(
    p_actor, 'pedido_mudanca_criado', p_event_id, null, p_actor,
    jsonb_build_object('request_id', v_id)
  );
  return v_id;
end;
$$;

-- Evento com vendas (ou reserva em andamento) só sai pelo Admin. Sem vendas, a tela
-- usa delete_own_event ("Excluir evento").
create function public.request_event_deletion(p_actor uuid, p_event_id uuid, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  select * into v_event from public.events e where e.id = p_event_id for update;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'ORG_DADOS: Motivo obrigatório (5 a 500 caracteres).';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.event_id = p_event_id
      and (
        o.status in ('pago', 'estornado', 'aguardando_decisao')
        or (o.status = 'pendente' and o.expires_at > now())
      )
  ) then
    raise exception 'ORG_ESTADO:sem_vendas';
  end if;
  if not public.consume_rate_limit(
    'org-ops:user',
    encode(sha256(convert_to('byla-rate-limit:' || p_actor::text, 'UTF8')), 'hex'),
    30,
    3600
  ) then
    raise exception 'ORG_LIMITE: Muitos pedidos em pouco tempo. Tente mais tarde.';
  end if;

  begin
    insert into public.organizer_ops_requests (kind, event_id, reason, requested_by)
    values ('exclusao', p_event_id, v_reason, p_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ORG_ESTADO:ja_pedido';
  end;

  perform set_config('byla.organizer_flow', 'on', true);
  update public.events e
  set sales_open = false, updated_at = now()
  where e.id = p_event_id;
  perform set_config('byla.organizer_flow', '', true);

  perform public.log_audit(
    p_actor, 'pedido_exclusao_criado', p_event_id, null, p_actor,
    jsonb_build_object('request_id', v_id)
  );
  if v_event.sales_open then
    perform public.log_audit(
      p_actor, 'vendas_pausadas', p_event_id, null, p_actor,
      jsonb_build_object('motivo', 'pedido_exclusao')
    );
  end if;
  return v_id;
end;
$$;

-- Dono desiste do próprio pedido pendente. Falso = não estava mais pendente.
create function public.cancel_ops_request(p_actor uuid, p_request_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_request public.organizer_ops_requests%rowtype;
begin
  select * into v_request from public.organizer_ops_requests r where r.id = p_request_id for update;
  if not found or public.actor_event_access(p_actor, v_request.event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Pedido não encontrado.';
  end if;
  if v_request.status <> 'pendente' then
    return false;
  end if;
  update public.organizer_ops_requests r
  set status = 'cancelado', decided_by = p_actor, decided_at = now()
  where r.id = v_request.id;
  perform public.log_audit(
    p_actor, 'pedido_cancelado', v_request.event_id, v_request.order_id, p_actor,
    jsonb_build_object('request_id', v_request.id, 'kind', v_request.kind)
  );
  return true;
end;
$$;

-- 3) Decisões da equipe ------------------------------------------------------------------

-- Estorno: qualquer conta da equipe (o estorno em si segue pelo "Estornar pedido").
-- Mudança e exclusão: só Admin.
create function public.decline_ops_request(p_staff uuid, p_request_id uuid, p_note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_request public.organizer_ops_requests%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if p_staff is null or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  select * into v_request from public.organizer_ops_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'ORG_DADOS: Pedido não encontrado.';
  end if;
  if v_request.kind in ('mudanca', 'exclusao') and not public.staff_is_admin(p_staff) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if v_request.status <> 'pendente' then
    raise exception 'ORG_ESTADO:estado';
  end if;
  if char_length(v_note) not between 5 and 500 then
    raise exception 'ORG_DADOS: Motivo da recusa obrigatório (5 a 500 caracteres).';
  end if;
  update public.organizer_ops_requests r
  set status = 'recusado', decided_by = p_staff, decision_note = v_note, decided_at = now()
  where r.id = v_request.id;
  perform public.log_audit(
    p_staff, 'pedido_recusado', v_request.event_id, v_request.order_id,
    (select e.organizer_id from public.events e where e.id = v_request.event_id),
    jsonb_build_object('request_id', v_request.id, 'kind', v_request.kind)
  );
end;
$$;

-- O Admin aplica a mudança pelos fluxos que já existem e marca como feita aqui.
create function public.finish_event_change(p_admin uuid, p_request_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_request public.organizer_ops_requests%rowtype;
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  select * into v_request from public.organizer_ops_requests r where r.id = p_request_id for update;
  if not found or v_request.kind <> 'mudanca' or v_request.status <> 'pendente' then
    raise exception 'ORG_ESTADO:estado';
  end if;
  update public.organizer_ops_requests r
  set status = 'atendido', decided_by = p_admin, decided_at = now()
  where r.id = v_request.id;
  perform public.log_audit(
    p_admin, 'pedido_atendido', v_request.event_id, null,
    (select e.organizer_id from public.events e where e.id = v_request.event_id),
    jsonb_build_object('request_id', v_request.id, 'kind', 'mudanca')
  );
end;
$$;

-- Só depois de todas as sessões canceladas (com os estornos) ou arquivadas.
create function public.finish_event_deletion(p_admin uuid, p_request_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_request public.organizer_ops_requests%rowtype;
  v_organizer uuid;
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  select r.event_id into v_event_id from public.organizer_ops_requests r where r.id = p_request_id;
  if v_event_id is null then
    raise exception 'ORG_ESTADO:estado';
  end if;
  select e.organizer_id into v_organizer from public.events e where e.id = v_event_id for update;
  select * into v_request from public.organizer_ops_requests r where r.id = p_request_id for update;
  if not found or v_request.kind <> 'exclusao' or v_request.status <> 'pendente' then
    raise exception 'ORG_ESTADO:estado';
  end if;
  if exists (
    select 1 from public.event_sessions s
    where s.event_id = v_event_id and s.status = 'ativa' and s.archived_at is null
  ) then
    raise exception 'ORG_ESTADO:sessoes_ativas';
  end if;

  perform set_config('byla.organizer_flow', 'on', true);
  update public.events e
  set deleted_at = coalesce(e.deleted_at, now()),
      deleted_by = coalesce(e.deleted_by, p_admin),
      sales_open = false,
      updated_at = now()
  where e.id = v_event_id;
  perform set_config('byla.organizer_flow', '', true);

  update public.organizer_ops_requests r
  set status = 'atendido', decided_by = p_admin, decided_at = now()
  where r.id = v_request.id;

  perform public.log_audit(
    p_admin, 'evento_excluido', v_event_id, null, v_organizer,
    jsonb_build_object('modo', 'pedido', 'request_id', v_request.id)
  );
  perform public.log_audit(
    p_admin, 'pedido_atendido', v_event_id, null, v_organizer,
    jsonb_build_object('request_id', v_request.id, 'kind', 'exclusao')
  );
end;
$$;

-- 4) Ações diretas do dono ---------------------------------------------------------------

-- Sem venda nem reserva em andamento. Sem nenhum pedido: apaga de vez ('apagado');
-- com pedidos cancelados/expirados (ou outra referência): exclusão lógica ('excluido').
create function public.delete_own_event(p_actor uuid, p_event_id uuid, p_confirm_name text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_request public.organizer_ops_requests%rowtype;
  v_mode text;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  select * into v_event from public.events e where e.id = p_event_id for update;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_event.name)) then
    raise exception 'ORG_DADOS: O nome digitado não confere.';
  end if;
  if exists (
    select 1 from public.orders o
    where o.event_id = p_event_id
      and (
        o.status in ('pago', 'estornado', 'aguardando_decisao')
        or (o.status = 'pendente' and o.expires_at > now())
      )
  ) then
    raise exception 'ORG_ESTADO:com_vendas';
  end if;

  if not exists (select 1 from public.orders o where o.event_id = p_event_id) then
    begin
      delete from public.events e where e.id = p_event_id;
      v_mode := 'apagado';
    exception when foreign_key_violation then
      v_mode := null;
    end;
  end if;

  if v_mode is null then
    perform set_config('byla.organizer_flow', 'on', true);
    update public.events e
    set deleted_at = now(), deleted_by = p_actor, sales_open = false, updated_at = now()
    where e.id = p_event_id;
    perform set_config('byla.organizer_flow', '', true);
    v_mode := 'excluido';

    -- Ex.: pedido de exclusão feito com uma reserva que depois expirou.
    for v_request in
      select * from public.organizer_ops_requests r
      where r.event_id = p_event_id and r.status = 'pendente'
      order by r.id
      for update
    loop
      update public.organizer_ops_requests r
      set status = 'cancelado', decided_by = p_actor, decided_at = now()
      where r.id = v_request.id;
      perform public.log_audit(
        p_actor, 'pedido_cancelado', p_event_id, v_request.order_id, p_actor,
        jsonb_build_object('request_id', v_request.id, 'kind', v_request.kind)
      );
    end loop;
  end if;

  perform public.log_audit(
    p_actor, 'evento_excluido', p_event_id, null, p_actor,
    jsonb_build_object('modo', v_mode)
  );
  return v_mode;
end;
$$;

-- Liga/pausa as vendas do evento inteiro. Abrir com exclusão pendente é recusado.
create function public.set_event_sales_open(p_actor uuid, p_event_id uuid, p_open boolean)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_approval text;
  v_changed integer;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  if p_open is null then
    raise exception 'ORG_DADOS: Valor inválido.';
  end if;
  select e.approval_status into v_approval from public.events e where e.id = p_event_id for update;
  if v_approval is distinct from 'aprovado' then
    raise exception 'ORG_ESTADO:nao_aprovado';
  end if;
  if p_open and public.event_deletion_pending(p_event_id) then
    raise exception 'ORG_ESTADO:exclusao_pendente';
  end if;

  perform set_config('byla.organizer_flow', 'on', true);
  update public.events e
  set sales_open = p_open, updated_at = now()
  where e.id = p_event_id and e.sales_open is distinct from p_open;
  get diagnostics v_changed = row_count;
  perform set_config('byla.organizer_flow', '', true);

  if v_changed > 0 then
    perform public.log_audit(
      p_actor, case when p_open then 'vendas_abertas' else 'vendas_pausadas' end,
      p_event_id, null, p_actor, '{}'::jsonb
    );
  end if;
  return p_open;
end;
$$;

-- 5) Listas -------------------------------------------------------------------------------

-- Fila da equipe. Secretaria vê só os pedidos de estorno.
create function public.list_ops_requests(p_staff uuid, p_status text, p_event_id uuid default null)
returns table (
  id uuid,
  kind text,
  event_id uuid,
  event_name text,
  organizer_public_name text,
  order_id uuid,
  details jsonb,
  reason text,
  status text,
  decision_note text,
  created_at timestamptz,
  decided_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_admin boolean;
begin
  if p_staff is null or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_status is null or p_status not in ('pendente', 'atendido', 'recusado', 'cancelado') then
    raise exception 'ORG_DADOS: Situação inválida.';
  end if;
  v_admin := public.staff_is_admin(p_staff);
  return query
  select
    r.id, r.kind, r.event_id, e.name, op.public_name, r.order_id, r.details, r.reason,
    r.status, r.decision_note, r.created_at, r.decided_at
  from public.organizer_ops_requests r
  join public.events e on e.id = r.event_id
  left join public.organizer_profiles op on op.user_id = e.organizer_id
  where r.status = p_status
    and (p_event_id is null or r.event_id = p_event_id)
    and (v_admin or r.kind = 'estorno')
  order by r.created_at desc, r.id
  limit 200;
end;
$$;

create function public.organizer_event_requests(p_actor uuid, p_event_id uuid)
returns table (
  id uuid,
  kind text,
  order_id uuid,
  details jsonb,
  reason text,
  status text,
  decision_note text,
  created_at timestamptz,
  decided_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  return query
  select r.id, r.kind, r.order_id, r.details, r.reason, r.status, r.decision_note, r.created_at, r.decided_at
  from public.organizer_ops_requests r
  where r.event_id = p_event_id
  order by r.created_at desc, r.id
  limit 200;
end;
$$;

-- Histórico do evento sem quem fez (só o tipo de conta) nem detalhes.
create function public.organizer_event_history(p_actor uuid, p_event_id uuid)
returns table (
  action text,
  created_at timestamptz,
  actor_kind text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if public.actor_event_access(p_actor, p_event_id) is null then
    raise exception 'ORG_DONO: Evento não encontrado.';
  end if;
  return query
  select a.action, a.created_at, a.actor_kind
  from public.audit_log a
  where a.event_id = p_event_id
    and a.action in (
      'evento_criado', 'evento_enviado', 'evento_envio_desfeito', 'evento_aprovado', 'evento_recusado',
      'evento_alterado_pos_aprovacao', 'evento_excluido', 'vendas_abertas', 'vendas_pausadas',
      'pedido_estorno_criado', 'pedido_exclusao_criado', 'pedido_mudanca_criado',
      'pedido_atendido', 'pedido_recusado', 'pedido_cancelado'
    )
  order by a.created_at desc, a.id
  limit 200;
end;
$$;

-- Números do menu. Secretaria: só estornos (o resto volta 0).
create function public.team_pending_counts(p_staff uuid)
returns table (
  approvals integer,
  changes integer,
  deletions integer,
  refunds integer,
  signup_requests integer
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_admin boolean;
begin
  if p_staff is null or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  v_admin := public.staff_is_admin(p_staff);
  return query
  select
    case when v_admin then (
      select count(*)::integer from public.events e
      where e.organizer_id is not null and e.approval_status = 'em_analise' and e.deleted_at is null
    ) else 0 end,
    case when v_admin then (
      select count(*)::integer from public.organizer_ops_requests r
      where r.kind = 'mudanca' and r.status = 'pendente'
    ) else 0 end,
    case when v_admin then (
      select count(*)::integer from public.organizer_ops_requests r
      where r.kind = 'exclusao' and r.status = 'pendente'
    ) else 0 end,
    (
      select count(*)::integer from public.organizer_ops_requests r
      where r.kind = 'estorno' and r.status = 'pendente'
    ),
    case when v_admin then (
      select count(*)::integer from public.organizer_signup_requests sr where sr.status = 'nova'
    ) else 0 end;
end;
$$;

-- 6) Portaria v3 ---------------------------------------------------------------------------

-- p_staff_user_id passa a significar "quem faz" (equipe ou dono do evento). Para o
-- dono, ingresso de outro evento volta sem o nome do outro evento. Para a equipe, tudo
-- igual à v2 (inclusive CHECKIN_DADOS para evento inexistente).
create or replace function public.check_in_ticket(
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
  v_access text;
  v_ticket public.tickets%rowtype;
  v_ticket_session public.event_sessions%rowtype;
  v_type_name text;
  v_event_name text;
begin
  v_access := public.actor_event_access(p_staff_user_id, p_event_id);
  if v_access is null and (
    p_staff_user_id is null
    or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id)
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
    if v_access = 'equipe' then
      select e.name into v_event_name from public.events e where e.id = v_ticket.event_id;
    end if;
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

-- Assinatura antiga (3 parâmetros, sem sessão): o código no ar já usa a v2.
drop function if exists public.check_in_ticket(uuid, text, uuid);

-- 7) Permissões ------------------------------------------------------------------------------

revoke all on function public.organizer_event_orders(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_order_refund(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.orders_close_refund_request() from public, anon, authenticated, service_role;
revoke all on function public.request_event_change(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.request_event_deletion(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_ops_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decline_ops_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_event_change(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_event_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_own_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_event_sales_open(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.list_ops_requests(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.organizer_event_requests(uuid, uuid) from public, anon, authenticated;
revoke all on function public.organizer_event_history(uuid, uuid) from public, anon, authenticated;
revoke all on function public.team_pending_counts(uuid) from public, anon, authenticated;
revoke all on function public.check_in_ticket(uuid, uuid, text, uuid) from public, anon, authenticated;

grant execute on function public.organizer_event_orders(uuid, uuid, uuid) to service_role;
grant execute on function public.request_order_refund(uuid, uuid, text) to service_role;
grant execute on function public.request_event_change(uuid, uuid, text, text) to service_role;
grant execute on function public.request_event_deletion(uuid, uuid, text) to service_role;
grant execute on function public.cancel_ops_request(uuid, uuid) to service_role;
grant execute on function public.decline_ops_request(uuid, uuid, text) to service_role;
grant execute on function public.finish_event_change(uuid, uuid) to service_role;
grant execute on function public.finish_event_deletion(uuid, uuid) to service_role;
grant execute on function public.delete_own_event(uuid, uuid, text) to service_role;
grant execute on function public.set_event_sales_open(uuid, uuid, boolean) to service_role;
grant execute on function public.list_ops_requests(uuid, text, uuid) to service_role;
grant execute on function public.organizer_event_requests(uuid, uuid) to service_role;
grant execute on function public.organizer_event_history(uuid, uuid) to service_role;
grant execute on function public.team_pending_counts(uuid) to service_role;
grant execute on function public.check_in_ticket(uuid, uuid, text, uuid) to service_role;
