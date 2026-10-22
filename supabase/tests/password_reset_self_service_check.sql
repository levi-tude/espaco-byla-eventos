-- Ensaio do pedido self-service de nova senha. Desfaz tudo: termina com
-- raise exception 'ENSAIO %' e a mensagem traz só nome_do_caso=ok|falhou.
-- Não imprime e-mails nem tokens. Uso: scripts/db-tests/password-reset-self-service.mjs
-- (banco temporário). NUNCA no projeto de produção.

do $test$
declare
  r text := '';
  v_staff uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_org_susp uuid := gen_random_uuid();
  v_hash1 text := encode(sha256(convert_to('ensaio-reset-1', 'UTF8')), 'hex');
  v_hash2 text := encode(sha256(convert_to('ensaio-reset-2', 'UTF8')), 'hex');
  v_hash3 text := encode(sha256(convert_to('ensaio-reset-3', 'UTF8')), 'hex');
  v_hash4 text := encode(sha256(convert_to('ensaio-reset-4', 'UTF8')), 'hex');
  v_hash5 text := encode(sha256(convert_to('ensaio-reset-5', 'UTF8')), 'hex');
  v_hash_use text := encode(sha256(convert_to('ensaio-reset-use', 'UTF8')), 'hex');
  v_hash_exp text := encode(sha256(convert_to('ensaio-reset-exp', 'UTF8')), 'hex');
  v_n integer;
  v_uid uuid;
  v_invite_a uuid;
  v_invite_b uuid;
  v_sess uuid := gen_random_uuid();
begin
  begin
    if to_regprocedure('public.request_password_reset_link(text,text)') is null
       or to_regclass('public.organizer_invites') is null
       or to_regclass('public.alunos') is not null then
      r := r || ' c0_projeto=falhou';
      raise exception 'parar';
    end if;
    r := r || ' c0_projeto=ok';

    insert into auth.users (id, email, created_at, updated_at)
    values
      (v_staff, 'equipe-ensaio@exemplo.com', now(), now()),
      (v_org, 'org-ensaio@exemplo.com', now(), now()),
      (v_org_susp, 'org-suspenso@exemplo.com', now(), now());

    insert into public.staff_profiles (user_id, display_name, role, is_developer)
    values (v_staff, 'Equipe Ensaio', 'admin', false);

    update public.organizer_settings set enabled = true where id = 1;

    insert into public.organizer_invites (kind, token_hash, created_by, expires_at)
    values
      ('convite', encode(sha256(convert_to('ensaio-convite-a', 'UTF8')), 'hex'), v_staff, now() + interval '7 days'),
      ('convite', encode(sha256(convert_to('ensaio-convite-b', 'UTF8')), 'hex'), v_staff, now() + interval '7 days')
    returning id into v_invite_a;
    -- returning só pega a última; busca pelos hashes
    select id into v_invite_a from public.organizer_invites
      where token_hash = encode(sha256(convert_to('ensaio-convite-a', 'UTF8')), 'hex');
    select id into v_invite_b from public.organizer_invites
      where token_hash = encode(sha256(convert_to('ensaio-convite-b', 'UTF8')), 'hex');

    insert into public.organizer_profiles (
      user_id, full_name, public_name, phone, pix_key_type, pix_key,
      pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id, status
    ) values
      (v_org, 'Org Ensaio', 'Org Ensaio', '71999999999', 'email', 'org-ensaio@exemplo.com',
       'Org Ensaio', '52998224725', '2026-10-14', now(), v_invite_a, 'ativo'),
      (v_org_susp, 'Org Suspenso', 'Org Suspenso', '71988888888', 'email', 'org-suspenso@exemplo.com',
       'Org Suspenso', '52998224725', '2026-10-14', now(), v_invite_b, 'suspenso');

    insert into public.verified_sessions (session_id, user_id, method, expires_at)
    values (v_sess, v_org, 'codigo', now() + interval '1 hour');
    insert into public.trusted_devices (user_id, token_hash, label, expires_at)
    values (v_org, encode(sha256(convert_to('aparelho-ensaio', 'UTF8')), 'hex'), 'cel', now() + interval '30 days');
    insert into auth.sessions (id, user_id, created_at, updated_at)
    values (gen_random_uuid(), v_org, now(), now());

    -- Funções: só service_role
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    select count(*) into v_n from public.request_password_reset_link('naoexiste@exemplo.com', v_hash1);
    r := r || ' c1_inexistente=' || case when v_n = 0 then 'ok' else 'falhou' end;

    select count(*) into v_n from public.request_password_reset_link('org-suspenso@exemplo.com', v_hash1);
    r := r || ' c2_suspenso=' || case when v_n = 0 then 'ok' else 'falhou' end;

    select count(*) into v_n from public.request_password_reset_link('equipe-ensaio@exemplo.com', v_hash1);
    r := r || ' c3_equipe=' || case when v_n = 1 then 'ok' else 'falhou' end;

    perform public.request_password_reset_link('equipe-ensaio@exemplo.com', v_hash2);
    perform public.request_password_reset_link('equipe-ensaio@exemplo.com', v_hash3);
    select count(*) into v_n from public.request_password_reset_link('equipe-ensaio@exemplo.com', v_hash4);
    r := r || ' c4_limite=' || case when v_n = 0 then 'ok' else 'falhou' end;

    perform public.request_password_reset_link('org-ensaio@exemplo.com', v_hash1);
    perform public.request_password_reset_link('org-ensaio@exemplo.com', v_hash5);
    select count(*) into v_n
    from public.organizer_invites i
    where i.target_user_id = v_org and i.token_hash = v_hash1
      and i.revoked_at is not null and i.used_at is null;
    r := r || ' c5_revoga=' || case when v_n = 1 then 'ok' else 'falhou' end;

    v_uid := public.use_password_reset_invite(v_hash5);
    r := r || ' c6_uso=' || case when v_uid = v_org then 'ok' else 'falhou' end;

    begin
      perform public.use_password_reset_invite(v_hash5);
      r := r || ' c7_reuso=falhou';
    exception when others then
      r := r || ' c7_reuso=' || case when sqlerrm like 'ORG_CONVITE%' then 'ok' else 'falhou' end;
    end;

    select count(*) into v_n from public.verified_sessions where user_id = v_org;
    r := r || ' c8_verified=' || case when v_n = 0 then 'ok' else 'falhou' end;
    select count(*) into v_n from public.trusted_devices where user_id = v_org and revoked_at is null;
    r := r || ' c9_devices=' || case when v_n = 0 then 'ok' else 'falhou' end;
    select count(*) into v_n from auth.sessions where user_id = v_org;
    r := r || ' c10_sessions=' || case when v_n = 0 then 'ok' else 'falhou' end;

    -- link vencido (insert como postgres: sai do service_role)
    reset role;
    insert into public.organizer_invites (kind, token_hash, target_user_id, created_by, expires_at)
    values ('redefinir_senha', v_hash_exp, v_org, v_org, now() - interval '1 hour');
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    begin
      perform public.use_password_reset_invite(v_hash_exp);
      r := r || ' c11_vencido=falhou';
    exception when others then
      r := r || ' c11_vencido=' || case when sqlerrm like 'ORG_CONVITE%' then 'ok' else 'falhou' end;
    end;

    select count(*) into v_n from public.audit_log
      where action = 'link_senha_pedido' and organizer_id = v_staff;
    r := r || ' c12_audit_pedido=' || case when v_n >= 1 then 'ok' else 'falhou' end;
    select count(*) into v_n from public.audit_log
      where action = 'senha_redefinida_link' and organizer_id = v_org;
    r := r || ' c13_audit_uso=' || case when v_n >= 1 then 'ok' else 'falhou' end;

    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform public.request_password_reset_link('equipe-ensaio@exemplo.com', v_hash_use);
      r := r || ' c14_anon=falhou';
    exception when insufficient_privilege then
      r := r || ' c14_anon=ok';
    when others then
      r := r || ' c14_anon=ok';
    end;

    begin
      set local role authenticated;
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', v_staff, 'role', 'authenticated')::text,
        true
      );
      perform public.use_password_reset_invite(v_hash_use);
      r := r || ' c15_auth=falhou';
    exception when insufficient_privilege then
      r := r || ' c15_auth=ok';
    when others then
      r := r || ' c15_auth=ok';
    end;

  exception when others then
    if sqlerrm <> 'parar' then
      r := r || ' interrompido=falhou';
    end if;
  end;

  raise exception 'ENSAIO %', btrim(r);
end;
$test$;
