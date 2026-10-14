-- Ensaio do código por e-mail. Desfaz tudo: o bloco termina com raise exception e a
-- mensagem do erro traz o resultado. Não imprime e-mails nem outros dados pessoais.
-- Uso (MCP user-supabase-eventos, projeto Espaço Byla Eventos, numa única chamada):
-- colar o conteúdo de 20261017100000_staff_email_code.sql e de
-- 20261017110000_staff_email_code_enforce.sql no lugar marcado e executar o arquivo
-- inteiro. Precisa de 2 contas da equipe com sessão em auth.sessions.
-- Depois, conferir só com leitura que as tabelas novas não existem.

-- >>> conteúdo das duas migrations aqui <<<

do $test$
declare
  r text := '';
  v_uid uuid;
  v_sid uuid;
  v_uid_b uuid;
  v_sid_b uuid;
  v_sid_b2 uuid := gen_random_uuid();
  v_token text := repeat('Ab_-', 11);
  v_status text;
  v_n integer;
  st record;
begin
  select s.user_id, s.id into v_uid, v_sid
  from auth.sessions s join public.staff_profiles sp on sp.user_id = s.user_id
  order by s.user_id limit 1;
  select s.user_id, s.id into v_uid_b, v_sid_b
  from auth.sessions s join public.staff_profiles sp on sp.user_id = s.user_id
  where s.user_id <> v_uid
  order by s.user_id limit 1;
  if v_sid is null or v_sid_b is null then
    raise exception 'ENSAIO sem duas contas da equipe com sessão';
  end if;

  -- Conta A, sessão sem código.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  r := r || ' A_is_staff_antes=' || public.is_staff() || ' A_is_admin_antes=' || public.is_admin();
  select * into st from public.login_session_state();
  r := r || ' A_estado=' || st.status || ' A_codigo_aberto=' || (st.code_expires_at is not null);
  select count(*) into v_n from public.orders;
  r := r || ' A_pedidos_antes=' || v_n;
  select count(*) into v_n from public.ticket_types;
  r := r || ' A_tipos_antes=' || v_n;
  begin
    perform 1 from public.verified_sessions;
    r := r || ' auth_le_tabela=PERMITIDO';
  exception when insufficient_privilege then
    r := r || ' auth_le_tabela=negado';
  end;
  begin
    perform public.issue_login_code(v_uid, v_sid, '123456');
    r := r || ' auth_emite=PERMITIDO';
  exception when insufficient_privilege then
    r := r || ' auth_emite=negado';
  end;

  -- Servidor (service_role) emite o código de A.
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := r || ' emite=' || public.issue_login_code(v_uid, v_sid, '111111');
  r := r || ' emite_de_novo=' || public.issue_login_code(v_uid, v_sid, '222222');
  r := r || ' emite_sessao_de_outro=' || public.issue_login_code(v_uid, v_sid_b, '111111');
  r := r || ' emite_formato=' || public.issue_login_code(v_uid, v_sid, '12345');
  r := r || ' svc_is_staff=' || public.is_staff();
  select count(*) into v_n from public.orders;
  r := r || ' svc_pedidos=' || v_n;

  -- B não usa o código de A.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b, 'session_id', v_sid_b, 'role', 'authenticated')::text, true);
  r := r || ' B_usa_codigo_de_A=' || public.verify_login_code('111111');

  -- A erra, digita fora do formato e acerta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  select * into st from public.login_session_state();
  r := r || ' A_codigo_aberto=' || (st.code_expires_at is not null) || ' A_espera=' || (st.resend_at > now());
  r := r || ' A_errado=' || public.verify_login_code('000000');
  r := r || ' A_formato=' || public.verify_login_code('12ab56');
  r := r || ' A_certo=' || public.verify_login_code('111111');
  r := r || ' A_certo_de_novo=' || public.verify_login_code('111111');
  r := r || ' A_is_staff_depois=' || public.is_staff() || ' A_is_admin_depois=' || public.is_admin();
  select * into st from public.login_session_state();
  r := r || ' A_estado_depois=' || st.status;
  select count(*) into v_n from public.orders;
  r := r || ' A_pedidos_depois=' || v_n;
  select count(*) into v_n from public.ticket_types;
  r := r || ' A_tipos_depois=' || v_n;

  -- Sessão de B continua sem verificação; 5 erros bloqueiam o código.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b, 'session_id', v_sid_b, 'role', 'authenticated')::text, true);
  r := r || ' B_is_staff=' || public.is_staff();
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := r || ' B_emite=' || public.issue_login_code(v_uid_b, v_sid_b, '333333');
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b, 'session_id', v_sid_b, 'role', 'authenticated')::text, true);
  for i in 1..4 loop
    v_status := public.verify_login_code('999999');
  end loop;
  r := r || ' B_4_erros=' || v_status;
  r := r || ' B_5o_erro=' || public.verify_login_code('999999');
  r := r || ' B_certo_depois_do_bloqueio=' || public.verify_login_code('333333');

  -- Aparelho lembrado: B acerta um código novo com "lembrar" e abre outra sessão.
  reset role;
  update public.login_email_codes set created_at = created_at - interval '2 minutes';
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid_b2, v_uid_b, now(), now());
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := r || ' B_emite_2=' || public.issue_login_code(v_uid_b, v_sid_b, '444444');
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b, 'session_id', v_sid_b, 'role', 'authenticated')::text, true);
  r := r || ' B_certo_lembrar=' || public.verify_login_code('444444', v_token, 'Chrome no Android');
  r := r || ' B_is_staff=' || public.is_staff();
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b, 'session_id', v_sid_b2, 'role', 'authenticated')::text, true);
  r := r || ' B2_is_staff_antes=' || public.is_staff();
  r := r || ' B2_aparelho_errado=' || public.verify_session_with_device(repeat('Z', 43));
  r := r || ' B2_aparelho=' || public.verify_session_with_device(v_token);
  r := r || ' B2_is_staff_depois=' || public.is_staff();
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  r := r || ' A_usa_aparelho_de_B=' || public.verify_session_with_device(v_token);

  -- Sessão que não existe no Supabase Auth não conta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'session_id', gen_random_uuid(), 'role', 'authenticated')::text, true);
  r := r || ' sessao_inexistente_is_staff=' || public.is_staff();
  select * into st from public.login_session_state();
  r := r || ' sessao_inexistente_estado=' || st.status;

  -- Sair apaga as verificações de B.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid_b, 'session_id', v_sid_b, 'role', 'authenticated')::text, true);
  perform public.end_login_verification();
  r := r || ' B_depois_de_sair=' || public.is_staff();

  -- Visitante (anon).
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  r := r || ' anon_is_staff=' || public.is_staff();
  begin
    perform * from public.login_session_state();
    r := r || ' anon_estado=PERMITIDO';
  exception when insufficient_privilege then
    r := r || ' anon_estado=negado';
  end;
  select count(*) into v_n from public.events;
  r := r || ' anon_eventos=' || v_n;

  -- Só hashes guardados; validade vencida desliga; limpeza.
  reset role;
  select count(*) into v_n from public.trusted_devices where token_hash = v_token;
  r := r || ' token_em_claro=' || v_n;
  select count(*) into v_n from public.trusted_devices
  where token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
    and expires_at between now() + interval '29 days' and now() + interval '31 days';
  r := r || ' token_hash_30d=' || v_n;
  select count(*) into v_n from public.login_email_codes where code_hash in ('111111', '333333', '444444');
  r := r || ' codigo_em_claro=' || v_n;
  select count(*) into v_n from public.verified_sessions
  where session_id = v_sid and expires_at between now() + interval '11 hours' and now() + interval '13 hours';
  r := r || ' A_sessao_12h=' || v_n;
  update public.verified_sessions set expires_at = now() - interval '1 second' where session_id = v_sid;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  r := r || ' A_vencida_is_staff=' || public.is_staff();
  set local role service_role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := r || ' limpeza=' || public.purge_login_verification();

  raise exception 'ENSAIO%', r;
end;
$test$;
