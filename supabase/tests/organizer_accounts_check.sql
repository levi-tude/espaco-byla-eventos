-- Ensaio das contas de organizador (fase 2). Desfaz tudo: o bloco termina com raise
-- exception e a mensagem do erro traz só nome_do_caso=ok|falhou. Não imprime e-mails nem
-- outros dados pessoais.
-- Uso (MCP user-supabase-eventos, projeto Espaço Byla Eventos, numa única chamada
-- execute_sql): colar o conteúdo de 20261018100000_organizer_accounts.sql e de
-- 20261018110000_organizer_operations.sql, nesta ordem, no lugar marcado e executar o
-- arquivo inteiro. As 2 contas reais da equipe (Admin do Espaço e Admin desenvolvedor)
-- entram só como quem age: as sessões e verificações delas são criadas aqui e somem no
-- fim. O organizador é fictício (organizador-ensaio@exemplo.com) e a área de
-- organizadores só é ligada dentro desta transação.
-- Depois, conferir só com leitura que nada ficou:
--   select to_regclass('public.organizer_profiles'),
--          to_regprocedure('public.check_in_ticket(uuid,text,uuid)') is not null;
--   → null, true
-- Local: scripts/db-tests/organizer-accounts.mjs roda este arquivo num banco temporário.

-- >>> conteúdo das duas migrations aqui <<<

do $test$
declare
  r text := '';
  v_admin uuid;
  v_dev uuid;
  v_out uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_sid_admin uuid := gen_random_uuid();
  v_sid_dev uuid := gen_random_uuid();
  v_sid_org uuid := gen_random_uuid();
  v_sid_org_nv uuid := gen_random_uuid();
  v_hash text := encode(sha256(convert_to('ensaio-convite:' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_suffix text := substr(md5(gen_random_uuid()::text), 1, 12);
  v_cover text := 'https://exemplo.com/capa-ensaio.jpg';
  v_types jsonb := '[{"preset":"inteira","price_cents":5000,"max_units":null},{"preset":"meia","price_cents":2500,"max_units":null}]';
  v_prices jsonb := '[{"type_index":0,"price_cents":5000,"max_units":null,"on_sale":true},{"type_index":1,"price_cents":2500,"max_units":null,"on_sale":true}]';
  v_starts timestamptz := date_trunc('hour', now()) + interval '7 days';
  v_sessions jsonb;
  v_staff_email text;
  v_draft uuid;
  v_ev uuid;
  v_sess uuid;
  v_team uuid;
  v_team_sess uuid;
  v_order uuid;
  v_item uuid;
  v_tt uuid;
  v_code_org text := 'ENSAIO-O-' || substr(md5(gen_random_uuid()::text), 1, 16);
  v_code_team text := 'ENSAIO-E-' || substr(md5(gen_random_uuid()::text), 1, 16);
  v_n integer;
  v_t text;
  v_row record;
begin
  -- Projeto certo (Eventos) e as 2 contas reais da equipe.
  if to_regclass('public.events') is null or to_regclass('public.tickets') is null
     or to_regclass('public.staff_profiles') is null or to_regclass('public.alunos') is not null
     or to_regclass('public.transacoes') is not null then
    raise exception 'ENSAIO projeto errado';
  end if;
  select sp.user_id into v_admin from public.staff_profiles sp
  where sp.role = 'admin' and not sp.is_developer order by sp.user_id limit 1;
  select sp.user_id into v_dev from public.staff_profiles sp
  where sp.is_developer order by sp.user_id limit 1;
  if v_admin is null or v_dev is null then
    raise exception 'ENSAIO sem as 2 contas da equipe';
  end if;
  select u.email into v_staff_email from auth.users u where u.id = v_admin;

  v_sessions := jsonb_build_array(jsonb_build_object(
    'id', null, 'name', null, 'starts_at', v_starts, 'ends_at', null, 'capacity', 30,
    'inteira_quota', null, 'meia_quota', null, 'prices', v_prices));

  update public.organizer_settings set enabled = true where id = 1;
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (v_sid_admin, v_admin, now(), now()), (v_sid_dev, v_dev, now(), now());
  insert into public.verified_sessions (session_id, user_id, method, expires_at)
  values (v_sid_admin, v_admin, 'codigo', now() + interval '1 hour'),
         (v_sid_dev, v_dev, 'codigo', now() + interval '1 hour');

  -- 4) Convite e conta do organizador fictício ----------------------------------------
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.create_organizer_invite(v_admin, 'abc', 'convite', null, null, null);
    r := r || ' c4_hash_formato=falhou';
  exception when others then
    r := r || ' c4_hash_formato=' || case when sqlerrm like 'ORG_CONVITE%' then 'ok' else 'falhou' end;
  end;
  begin
    perform public.create_organizer_invite(v_out, v_hash, 'convite', null, null, null);
    r := r || ' c4_fora_da_equipe=falhou';
  exception when others then
    r := r || ' c4_fora_da_equipe=' || case when sqlerrm like 'ORG_ACESSO%' then 'ok' else 'falhou' end;
  end;
  perform public.create_organizer_invite(v_admin, v_hash, 'convite', 'Ensaio', null, null);
  r := r || ' c4_convite_valido=' || case when public.check_organizer_invite(v_hash) = 'valido' then 'ok' else 'falhou' end;
  r := r || ' c4_email_da_equipe=' || case when public.start_invite_email_code(v_hash, upper(v_staff_email), '135790')
    = 'email_indisponivel' then 'ok' else 'falhou' end;
  r := r || ' c4_envio=' || case when public.start_invite_email_code(v_hash, 'organizador-ensaio@exemplo.com', '246810')
    = 'ok' then 'ok' else 'falhou' end;
  r := r || ' c4_codigo_errado=' || case when public.verify_invite_email_code(v_hash, '000000') = 'invalido' then 'ok' else 'falhou' end;
  r := r || ' c4_codigo_certo=' || case when public.verify_invite_email_code(v_hash, '246810') = 'ok' then 'ok' else 'falhou' end;

  reset role;
  insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
  values (v_org, 'organizador-ensaio@exemplo.com', 'authenticated', 'authenticated', now(), now(), now());
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.accept_organizer_invite(v_hash, v_org, 'Organizador Ensaio', 'Produtora Ensaio', '71999998888',
      'cpf', '52998224724', 'Organizador Ensaio', '52998224724', '2026-10-14');
    r := r || ' c4_cpf_invalido=falhou';
  exception when others then
    r := r || ' c4_cpf_invalido=' || case when sqlerrm like 'ORG_DADOS%' then 'ok' else 'falhou' end;
  end;
  perform public.accept_organizer_invite(v_hash, v_org, 'Organizador Ensaio', 'Produtora Ensaio', '71999998888',
    'cpf', '52998224725', 'Organizador Ensaio', '52998224725', '2026-10-14');
  r := r || ' c4_convite_usado=' || case when public.check_organizer_invite(v_hash) = 'invalido' then 'ok' else 'falhou' end;
  begin
    perform public.accept_organizer_invite(v_hash, v_org, 'Organizador Ensaio', 'Produtora Ensaio', '71999998888',
      'cpf', '52998224725', 'Organizador Ensaio', '52998224725', '2026-10-14');
    r := r || ' c4_segundo_aceite=falhou';
  exception when others then
    r := r || ' c4_segundo_aceite=' || case when sqlerrm like 'ORG_CONVITE%' then 'ok' else 'falhou' end;
  end;
  reset role;
  select count(*) into v_n from public.organizer_profiles op where op.user_id = v_org and op.status = 'ativo';
  r := r || ' c4_perfil_criado=' || case when v_n = 1 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.organizer_invites i
  where i.token_hash = v_hash and i.used_by = v_org
    and i.email_code_hash is null and i.email_code_salt is null and i.email_code_expires_at is null;
  r := r || ' c4_codigo_apagado=' || case when v_n = 1 then 'ok' else 'falhou' end;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (v_sid_org, v_org, now(), now()), (v_sid_org_nv, v_org, now(), now());
  insert into public.verified_sessions (session_id, user_id, method, expires_at)
  values (v_sid_org, v_org, 'codigo', now() + interval '1 hour');

  -- 6) Evento do organizador -----------------------------------------------------------
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.create_organizer_event(v_org, 'ensaio-grande-' || v_suffix, 'Ensaio Grande', 'Espaço Teste', '', null,
      v_types, jsonb_set(v_sessions, '{0,capacity}', '101'));
    r := r || ' c6_lotacao_101=falhou';
  exception when others then
    r := r || ' c6_lotacao_101=' || case when sqlerrm = 'ORG_LOTACAO:100' then 'ok' else 'falhou' end;
  end;
  v_draft := public.create_organizer_event(v_org, 'ensaio-rascunho-' || v_suffix, 'Ensaio Rascunho', 'Espaço Teste',
    'desc', null, v_types, v_sessions);
  v_ev := public.create_organizer_event(v_org, 'ensaio-show-' || v_suffix, 'Ensaio Show', 'Espaço Teste',
    'desc', null, v_types, v_sessions);
  select s.id into v_sess from public.event_sessions s where s.event_id = v_ev and s.archived_at is null;
  begin
    perform public.submit_event_for_approval(v_org, v_ev);
    r := r || ' c6_sem_capa=falhou';
  exception when others then
    r := r || ' c6_sem_capa=' || case when sqlerrm = 'ORG_ESTADO:capa' then 'ok' else 'falhou' end;
  end;
  v_sessions := jsonb_set(v_sessions, '{0,id}', to_jsonb(v_sess));
  perform public.save_event_with_sessions(v_ev, 'Ensaio Show', 'Espaço Teste', 'desc', v_cover, v_types, v_sessions, v_org);
  perform public.submit_event_for_approval(v_org, v_ev);
  select e.approval_status into v_t from public.events e where e.id = v_ev;
  r := r || ' c6_enviado=' || case when v_t = 'em_analise' then 'ok' else 'falhou' end;
  begin
    perform public.save_event_with_sessions(v_ev, 'Ensaio Show', 'Espaço Teste', 'desc', v_cover, v_types, v_sessions, v_org);
    r := r || ' c6_salvar_em_analise=falhou';
  exception when others then
    r := r || ' c6_salvar_em_analise=' || case when sqlerrm = 'ORG_ESTADO:em_analise' then 'ok' else 'falhou' end;
  end;
  begin
    perform public.decide_event_approval(v_out, v_ev, 'aprovar', true, null);
    r := r || ' c6_fora_da_equipe_decide=falhou';
  exception when others then
    r := r || ' c6_fora_da_equipe_decide=' || case when sqlerrm like 'ORG_ACESSO%' then 'ok' else 'falhou' end;
  end;
  begin
    perform public.decide_event_approval(v_admin, v_ev, 'recusar', false, null);
    r := r || ' c6_recusa_sem_nota=falhou';
  exception when others then
    r := r || ' c6_recusa_sem_nota=' || case when sqlerrm like 'ORG_DADOS%' then 'ok' else 'falhou' end;
  end;
  perform public.decide_event_approval(v_admin, v_ev, 'aprovar', true, null);
  select count(*) into v_n from public.events e
  where e.id = v_ev and e.approval_status = 'aprovado' and e.sales_open and e.published_at is not null;
  r := r || ' c6_aprovado_publicado=' || case when v_n = 1 then 'ok' else 'falhou' end;

  -- Pedido pago fictício na sessão do evento do organizador.
  reset role;
  select tt.id into v_tt from public.ticket_types tt where tt.event_id = v_ev and tt.kind = 'inteira' and tt.archived_at is null;
  insert into public.orders (event_id, session_id, buyer_name, buyer_email, total_cents, status, public_token, paid_at)
  values (v_ev, v_sess, 'Comprador Ensaio', 'comprador-ensaio@exemplo.com', 5000, 'pago', gen_random_uuid()::text, now())
  returning id into v_order;
  insert into public.order_items (order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit, quantity, line_total_cents)
  values (v_order, v_tt, 'Inteira', 'inteira', 5000, 1, 1, 5000)
  returning id into v_item;
  insert into public.tickets (order_id, event_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents)
  values (v_order, v_ev, v_tt, v_item, 'inteira', 'pago', v_code_org, 'Comprador Ensaio', 5000);

  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.save_event_with_sessions(v_ev, 'Ensaio Show Novo', 'Espaço Teste', 'desc', v_cover, v_types, v_sessions, v_org);
    r := r || ' c6_nome_com_venda=falhou';
  exception when others then
    r := r || ' c6_nome_com_venda=' || case when sqlerrm = 'ORG_ESTADO:mudanca:nome' then 'ok' else 'falhou' end;
  end;
  begin
    perform public.save_event_with_sessions(v_ev, 'Ensaio Show', 'Espaço Teste', 'desc', v_cover, v_types,
      jsonb_set(v_sessions, '{0,prices,0,price_cents}', '6000'), v_org);
    r := r || ' c6_preco_com_venda=falhou';
  exception when others then
    r := r || ' c6_preco_com_venda=' || case when sqlerrm = 'ORG_ESTADO:mudanca:preco' then 'ok' else 'falhou' end;
  end;
  perform public.save_event_with_sessions(v_ev, 'Ensaio Show', 'Espaço Teste', 'Descrição nova', v_cover, v_types, v_sessions, v_org);
  reset role;
  select count(*) into v_n from public.audit_log a
  where a.event_id = v_ev and a.action = 'evento_alterado_pos_aprovacao' and a.details = '{"campos":["descricao"]}'::jsonb;
  r := r || ' c6_descricao_com_venda=' || case when v_n = 1 then 'ok' else 'falhou' end;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.save_event_with_sessions(v_ev, 'Ensaio Show', 'Espaço Teste', 'desc', v_cover, v_types, v_sessions, v_out);
    r := r || ' c6_estranho_salva=falhou';
  exception when others then
    r := r || ' c6_estranho_salva=' || case when sqlerrm like 'SESSAO_EQUIPE%' then 'ok' else 'falhou' end;
  end;

  -- 1) Trava do evento ------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_dev, 'session_id', v_sid_dev, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.events e where e.id = v_draft;
  r := r || ' c1_equipe_ve_rascunho=' || case when v_n = 1 then 'ok' else 'falhou' end;
  begin
    update public.events set approval_status = 'aprovado' where id = v_draft;
    r := r || ' c1_aprovar_direto=falhou';
  exception when others then
    r := r || ' c1_aprovar_direto=' || case when sqlerrm like 'ORG_ESTADO%' then 'ok' else 'falhou' end;
  end;
  begin
    insert into public.events (slug, name, venue, starts_at, capacity, organizer_id)
    values ('ensaio-pirata-' || v_suffix, 'Ensaio Pirata', 'Espaço Teste', v_starts, 30, v_org);
    r := r || ' c1_inserir_com_dono=falhou';
  exception when others then
    r := r || ' c1_inserir_com_dono=' || case when sqlerrm like 'ORG_ESTADO%' then 'ok' else 'falhou' end;
  end;
  begin
    update public.events set organizer_id = null where id = v_draft;
    r := r || ' c1_trocar_dono=falhou';
  exception when others then
    r := r || ' c1_trocar_dono=' || case when sqlerrm like 'ORG_DONO%' then 'ok' else 'falhou' end;
  end;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    update public.events set sales_open = true where id = v_draft;
    r := r || ' c1_abrir_venda_rascunho=falhou';
  exception when others then
    r := r || ' c1_abrir_venda_rascunho=' || case when sqlerrm like 'ORG_ESTADO%' then 'ok' else 'falhou' end;
  end;

  -- 3) Leitura (RLS) ------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'session_id', v_sid_org, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.events e where e.id = v_draft;
  r := r || ' c3_dono_le_rascunho=' || case when v_n = 1 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.event_sessions s where s.event_id = v_draft;
  r := r || ' c3_dono_le_sessoes=' || case when v_n >= 1 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.ticket_types tt where tt.event_id = v_draft;
  r := r || ' c3_dono_le_tipos=' || case when v_n >= 1 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.organizer_profiles;
  r := r || ' c3_dono_le_so_o_perfil=' || case when v_n = 1 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.orders;
  r := r || ' c3_dono_sem_pedidos=' || case when v_n = 0 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.tickets;
  r := r || ' c3_dono_sem_ingressos=' || case when v_n = 0 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.order_items;
  r := r || ' c3_dono_sem_itens=' || case when v_n = 0 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.order_refunds;
  r := r || ' c3_dono_sem_estornos=' || case when v_n = 0 then 'ok' else 'falhou' end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'session_id', v_sid_org_nv, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.events e where e.id = v_draft;
  r := r || ' c3_sem_codigo_nao_le=' || case when v_n = 0 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.organizer_profiles;
  r := r || ' c3_sem_codigo_sem_perfil=' || case when v_n = 0 then 'ok' else 'falhou' end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_dev, 'session_id', v_sid_dev, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.orders o where o.id = v_order;
  r := r || ' c3_equipe_le_pedido=' || case when v_n = 1 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.organizer_profiles;
  r := r || ' c3_equipe_sem_perfis=' || case when v_n = 0 then 'ok' else 'falhou' end;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_n from public.events e where e.id = v_draft;
  r := r || ' c3_anon_nao_le_rascunho=' || case when v_n = 0 then 'ok' else 'falhou' end;
  select count(*) into v_n from public.events e where e.id = v_ev;
  r := r || ' c3_anon_le_aprovado=' || case when v_n = 1 then 'ok' else 'falhou' end;

  -- 8) Portaria --------------------------------------------------------------------------
  reset role;
  insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open)
  values ('ensaio-espaco-' || v_suffix, 'Ensaio Espaço', 'Espaço Teste', '', v_starts, 30, false)
  returning id into v_team;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.save_event_with_sessions(v_team, 'Ensaio Espaço', 'Espaço Teste', '', null, v_types,
    jsonb_set(v_sessions, '{0,id}', 'null'), v_admin);
  reset role;
  select s.id into v_team_sess from public.event_sessions s where s.event_id = v_team and s.archived_at is null;
  select tt.id into v_tt from public.ticket_types tt where tt.event_id = v_team and tt.kind = 'inteira' and tt.archived_at is null;
  insert into public.orders (event_id, session_id, buyer_name, buyer_email, total_cents, status, public_token, paid_at)
  values (v_team, v_team_sess, 'Comprador Ensaio', 'comprador-ensaio@exemplo.com', 5000, 'pago', gen_random_uuid()::text, now())
  returning id into v_order;
  insert into public.order_items (order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit, quantity, line_total_cents)
  values (v_order, v_tt, 'Inteira', 'inteira', 5000, 1, 1, 5000)
  returning id into v_item;
  insert into public.tickets (order_id, event_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents)
  values (v_order, v_team, v_tt, v_item, 'inteira', 'pago', v_code_team, 'Comprador Ensaio', 5000);

  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select * into v_row from public.check_in_ticket(v_ev, v_sess, v_code_org, v_org);
  r := r || ' c8_dono_check_in=' || case when v_row.outcome = 'ok' then 'ok' else 'falhou' end;
  reset role;
  select count(*) into v_n from public.tickets t where t.code = v_code_org and t.checked_in_by = v_org;
  r := r || ' c8_checked_in_by_dono=' || case when v_n = 1 then 'ok' else 'falhou' end;
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform * from public.check_in_ticket(v_team, v_team_sess, v_code_team, v_org);
    r := r || ' c8_dono_no_evento_do_espaco=falhou';
  exception when others then
    r := r || ' c8_dono_no_evento_do_espaco=' || case when sqlerrm like 'CHECKIN_EQUIPE%' then 'ok' else 'falhou' end;
  end;
  select * into v_row from public.check_in_ticket(v_ev, v_sess, v_code_team, v_org);
  r := r || ' c8_dono_outro_evento_sem_nome='
    || case when v_row.outcome = 'evento_errado' and v_row.other_event_name is null then 'ok' else 'falhou' end;
  select * into v_row from public.check_in_ticket(v_ev, v_sess, v_code_team, v_dev);
  r := r || ' c8_equipe_outro_evento_com_nome='
    || case when v_row.outcome = 'evento_errado' and v_row.other_event_name = 'Ensaio Espaço' then 'ok' else 'falhou' end;
  r := r || ' c8_assinatura_antiga_removida='
    || case when to_regprocedure('public.check_in_ticket(uuid,text,uuid)') is null then 'ok' else 'falhou' end;

  raise exception 'ENSAIO %', r;
end;
$test$;
