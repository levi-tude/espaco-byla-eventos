-- Ensaio do dinheiro do organizador (fase 3). Desfaz tudo: o bloco termina sempre com
-- raise exception 'ENSAIO %' e a mensagem traz só nome_do_caso=ok|falhou (nunca o texto
-- do erro). Não imprime e-mails, chaves PIX nem outros dados pessoais.
-- Uso (MCP user-supabase-eventos, projeto Espaço Byla Eventos, numa única chamada
-- execute_sql, só com "pode" do dono): colar o conteúdo de
-- 20261019100000_payment_fees_calendar.sql, 20261019110000_organizer_payouts.sql e
-- 20261019120000_organizer_pix_limits.sql, nesta ordem, no lugar marcado e executar o
-- arquivo inteiro. As 2 contas reais da equipe (Admin do Espaço e Admin desenvolvedor)
-- entram só como quem age. O organizador, os eventos e os pedidos são fictícios e a área
-- de organizadores só é ligada dentro desta transação.
-- Resultado esperado: todos os casos =ok. "interrompido=falhou" = um passo sem caso
-- próprio quebrou; o que veio antes dele continua valendo.
-- Depois, conferir só com leitura que nada ficou:
--   select to_regclass('public.organizer_payouts'), to_regclass('public.order_payment_fees');
--   → null, null
-- Local: scripts/db-tests/organizer-finance.mjs roda este arquivo num banco temporário.

-- >>> conteúdo das três migrations aqui <<<

do $test$
declare
  r text := '';
  v_admin uuid;
  v_dev uuid;
  v_org uuid := gen_random_uuid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_suffix text := substr(md5(gen_random_uuid()::text), 1, 12);
  v_real_events integer;
  v_e1 uuid;
  v_e2 uuid;
  v_e3 uuid;
  v_future uuid;
  v_ev uuid;
  v_sess uuid;
  v_order uuid;
  v_orders uuid[] := '{}';
  v_late uuid;
  v_refund uuid;
  v_req jsonb;
  v_out jsonb;
  v_n integer;
  v_t text;
  v_row record;
  i integer;
begin
  begin
    -- Projeto certo (Eventos) e as 2 contas reais da equipe.
    if to_regclass('public.events') is null or to_regclass('public.tickets') is null
       or to_regclass('public.orders') is null or to_regclass('public.ticket_types') is null
       or to_regclass('public.staff_profiles') is null or to_regclass('public.alunos') is not null
       or to_regclass('public.transacoes') is not null then
      r := r || ' c0_projeto_eventos=falhou';
      raise exception 'parar';
    end if;
    r := r || ' c0_projeto_eventos=ok';
    select sp.user_id into v_admin from public.staff_profiles sp
    where sp.role = 'admin' and not sp.is_developer order by sp.user_id limit 1;
    select sp.user_id into v_dev from public.staff_profiles sp
    where sp.is_developer order by sp.user_id limit 1;
    if v_admin is null or v_dev is null then
      r := r || ' c0_contas_da_equipe=falhou';
      raise exception 'parar';
    end if;
    r := r || ' c0_contas_da_equipe=ok';
    select count(*) into v_real_events from public.events e where e.organizer_id is null;

    -- Organizador fictício com chave CPF.
    update public.organizer_settings set enabled = true where id = 1;
    insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
    values (v_org, 'organizador-ensaio-' || v_suffix || '@exemplo.com', 'authenticated', 'authenticated', now(), now(), now());
    insert into public.organizer_profiles (user_id, full_name, public_name, phone, pix_key_type, pix_key,
      pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id)
    values (v_org, 'Organizador Ensaio', 'Produtora Ensaio', '71900000001', 'cpf', '52998224725',
      'Organizador Ensaio', '52998224725', '2026-10-14', now(), gen_random_uuid());

    -- Eventos: E1, E2, E3 terminaram há 10 dias; um ainda vai acontecer.
    for i in 1..4 loop
      perform set_config('byla.organizer_flow', 'on', true);
      insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open, organizer_id, approval_status)
      values ('ensaio-f3-' || i || '-' || v_suffix, 'Ensaio F3 ' || i, 'Espaço Teste', '',
        ((v_today + case when i = 4 then 5 else -10 end)::timestamp + interval '19 hours') at time zone 'America/Sao_Paulo',
        30, false, v_org, 'aprovado')
      returning id into v_ev;
      perform set_config('byla.organizer_flow', '', true);
      if not exists (select 1 from public.event_sessions s where s.event_id = v_ev) then
        insert into public.event_sessions (event_id, starts_at, capacity)
        select v_ev, e.starts_at, 30 from public.events e where e.id = v_ev;
      end if;
      case i when 1 then v_e1 := v_ev; when 2 then v_e2 := v_ev; when 3 then v_e3 := v_ev; else v_future := v_ev; end case;
    end loop;

    -- 10 pedidos pagos em E1 (exemplo da spec), 4 em E2 e 1 no evento futuro.
    for i in 1..15 loop
      v_ev := case when i <= 10 then v_e1 when i <= 14 then v_e2 else v_future end;
      select s.id into v_sess from public.event_sessions s where s.event_id = v_ev order by s.starts_at limit 1;
      insert into public.orders (event_id, session_id, buyer_name, buyer_email, buyer_phone, total_cents,
        tickets_subtotal_cents, service_fee_cents, status, public_token, paid_at, payment_provider, provider_order_id)
      values (v_ev, v_sess, 'Comprador Ensaio', 'comprador-ensaio@exemplo.com', '71900000002', 5250, 5000, 250,
        'pago', gen_random_uuid()::text, now(), 'mercadopago', 'ENSAIO' || upper(substr(md5(gen_random_uuid()::text), 1, 20)))
      returning id into v_order;
      v_orders := v_orders || v_order;
    end loop;
    r := r || ' c0_dados_ficticios=ok';

    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    for i in 1..15 loop
      perform public.record_payment_fee(v_orders[i], 5250,
        case when i between 7 and 10 then 261 else 52 end, '[]'::jsonb, null, false);
    end loop;
    reset role;
    -- Estorno de um pedido de cartão em E1; o banco devolveu a tarifa dele.
    update public.orders set status = 'estornado' where id = v_orders[10];
    v_refund := gen_random_uuid();
    insert into public.order_refunds (id, order_id, amount_cents, status, idempotency_key, previous_order_status,
      requested_by_name, reason, completed_at)
    values (v_refund, v_orders[10], 5250, 'concluido', v_refund, 'pago', 'Ensaio', 'Estorno de ensaio', clock_timestamp());
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform public.record_payment_fee(v_orders[10], 5250, 0, '[]'::jsonb, null, true);

    -- T6.1) Exemplo da spec: parte R$ 439,05.
    select * into v_row from public.organizer_event_balance(v_e1);
    r := r || ' t6_1_exemplo_spec=' || case when v_row.share_cents = 43905 and v_row.bank_fee_cents = 1095
      and v_row.refunded_cents = 5000 and v_row.service_fee_cents = 2250 and v_row.balance_cents = 43905
      then 'ok' else 'falhou' end;

    -- T6.3) Prazo e data do PIX.
    begin
      perform public.record_organizer_payout(v_admin, v_future, 4948, v_today, null);
      r := r || ' t6_3_prazo=falhou';
    exception when others then
      r := r || ' t6_3_prazo=' || case when sqlerrm like 'ORG_PRAZO%' then 'ok' else 'falhou' end;
    end;
    begin
      perform public.record_organizer_payout(v_admin, v_e1, 43905, v_today + 1, null);
      r := r || ' t6_3_data_futura=falhou';
    exception when others then
      r := r || ' t6_3_data_futura=' || case when sqlerrm like 'ORG_DATA%' then 'ok' else 'falhou' end;
    end;
    begin
      perform public.record_organizer_payout(v_dev, v_e1, 43905, v_today, null);
      r := r || ' t6_papel_desenvolvedor=falhou';
    exception when others then
      r := r || ' t6_papel_desenvolvedor=' || case when sqlerrm like 'TAXA_DEV%' then 'ok' else 'falhou' end;
    end;
    -- Repasse de E1 com a chave atual.
    begin
      v_out := public.record_organizer_payout(v_admin, v_e1, 43905, v_today, null);
      r := r || ' t6_repasse_e1=' || case when v_out ->> 'kind' = 'repasse' then 'ok' else 'falhou' end;
    exception when others then
      r := r || ' t6_repasse_e1=falhou';
    end;

    -- T6.6) Estorno tardio de um pedido PIX de E1 (tarifa 52 mantida): E1 fica -5000.
    reset role;
    update public.orders set status = 'estornado' where id = v_orders[1];
    v_refund := gen_random_uuid();
    insert into public.order_refunds (id, order_id, amount_cents, status, idempotency_key, previous_order_status,
      requested_by_name, reason, completed_at)
    values (v_refund, v_orders[1], 5250, 'concluido', v_refund, 'pago', 'Ensaio', 'Estorno de ensaio', clock_timestamp());
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    r := r || ' t6_6_saldo_negativo=' || case when (select b.balance_cents from public.organizer_event_balance(v_e1) b) = -5000
      then 'ok' else 'falhou' end;

    -- T7.2) Dados da troca de chave.
    begin
      perform public.request_pix_change(v_org, '000000', 'cpf', '11144477735', 'Organizador Ensaio', '52998224725');
      r := r || ' t7_2_cpf_diferente=falhou';
    exception when others then
      r := r || ' t7_2_cpf_diferente=' || case when sqlerrm like 'ORG_DADOS%' then 'ok' else 'falhou' end;
    end;
    begin
      perform public.request_pix_change(v_org, '000000', 'cpf', '52998224725', 'Organizador Ensaio', '52998224725');
      r := r || ' t7_2_igual_atual=falhou';
    exception when others then
      r := r || ' t7_2_igual_atual=' || case when sqlerrm like 'ORG_PIX_IGUAL%' then 'ok' else 'falhou' end;
    end;
    r := r || ' t7_2_codigo=' || case when public.issue_organizer_action_code(v_org, 'pix_change', '246810') = 'ok'
      then 'ok' else 'falhou' end;
    r := r || ' t7_2_codigo_errado=' || case when public.request_pix_change(v_org, '000000', 'email',
      'nova-ensaio@exemplo.com', 'Organizador Ensaio', '52998224725') ->> 'status' = 'invalido' then 'ok' else 'falhou' end;
    v_req := public.request_pix_change(v_org, '246810', 'email', 'nova-ensaio@exemplo.com', 'Organizador Ensaio', '52998224725');
    r := r || ' t7_2_troca_pedida=' || case when v_req ->> 'status' = 'ok'
      and (v_req ->> 'confirm_after')::timestamptz > now() + interval '23 hours 59 minutes' then 'ok' else 'falhou' end;
    begin
      perform public.request_pix_change(v_org, '246810', 'email', 'outra-ensaio@exemplo.com', 'Organizador Ensaio', '52998224725');
      r := r || ' t7_2_segunda_pendente=falhou';
    exception when others then
      r := r || ' t7_2_segunda_pendente=' || case when sqlerrm like 'ORG_PIX_PENDENTE%' then 'ok' else 'falhou' end;
    end;

    -- T7.3) Repasse com troca pendente.
    begin
      perform public.record_organizer_payout(v_admin, v_e2, 14792, v_today, null);
      r := r || ' t7_3_repasse_bloqueado=falhou';
    exception when others then
      r := r || ' t7_3_repasse_bloqueado=' || case when sqlerrm like 'ORG_PIX_PENDENTE%' then 'ok' else 'falhou' end;
    end;

    -- T7.4) Decisão: espera de 24 h, depois aprova; repasse seguinte com a chave nova.
    begin
      perform public.decide_pix_change(v_admin, (v_req ->> 'request_id')::uuid, true, null);
      r := r || ' t7_4_espera=falhou';
    exception when others then
      r := r || ' t7_4_espera=' || case when sqlerrm like 'ORG_ESPERA:%' then 'ok' else 'falhou' end;
    end;
    begin
      perform public.decide_pix_change(v_dev, (v_req ->> 'request_id')::uuid, true, null);
      r := r || ' t7_4_desenvolvedor=falhou';
    exception when others then
      r := r || ' t7_4_desenvolvedor=' || case when sqlerrm like 'TAXA_DEV%' then 'ok' else 'falhou' end;
    end;
    reset role;
    update public.organizer_pix_change_requests set confirm_after = now() - interval '1 minute'
    where id = (v_req ->> 'request_id')::uuid;
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    begin
      v_out := public.decide_pix_change(v_admin, (v_req ->> 'request_id')::uuid, true, null);
      r := r || ' t7_4_aprovada=' || case when v_out ->> 'status' = 'confirmada' then 'ok' else 'falhou' end;
    exception when others then
      r := r || ' t7_4_aprovada=falhou';
    end;

    -- T6.6) E2 (saldo 19792) paga já descontando os -5000 de E1.
    begin
      v_out := public.record_organizer_payout(v_admin, v_e2, 14792, v_today, null);
      r := r || ' t6_6_desconto_no_repasse=' || case when v_out ->> 'kind' = 'repasse'
        and (v_out ->> 'discount_cents')::integer = 5000
        and (select b.balance_cents from public.organizer_event_balance(v_e1) b) = 0 then 'ok' else 'falhou' end;
    exception when others then
      r := r || ' t6_6_desconto_no_repasse=falhou';
    end;
    reset role;
    select count(*) into v_n from public.organizer_payouts p
    join public.organizer_payout_items it on it.payout_id = p.id and it.amount_cents > 0
    where p.kind = 'repasse' and (
      (it.event_id = v_e1 and p.pix_key_snapshot = '52998224725' and p.pix_key_changed_at_snapshot is null)
      or (it.event_id = v_e2 and p.pix_key_snapshot = 'nova-ensaio@exemplo.com' and p.pix_key_changed_at_snapshot is not null));
    r := r || ' t7_4_chave_por_repasse=' || case when v_n = 2 then 'ok' else 'falhou' end;
    select count(*) into v_n from public.audit_log a
    where a.organizer_id = v_org and a.details::text ~ '(52998224725|nova-ensaio|@)';
    r := r || ' t7_historico_sem_chave=' || case when v_n = 0 then 'ok' else 'falhou' end;

    -- T6.8) Devolução: ajuste a favor do Espaço deixa E3 negativo; 30 dias depois vira devolução.
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform public.record_organizer_payout_adjustment(v_admin, v_e3, 4739, 'Ajuste do ensaio');
    perform * from public.refresh_organizer_balance_flags();
    reset role;
    update public.organizer_balance_flags f set negative_since = v_today - 30
    where f.event_id = v_e3 and f.resolved_at is null;
    set local role service_role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select count(*) into v_n from public.refresh_organizer_balance_flags() x
    where x.event_id = v_e3 and x.owed_cents = 4739 and x.return_due_date = v_today + 10;
    r := r || ' t6_8_devolucao_aberta=' || case when v_n = 1 then 'ok' else 'falhou' end;
    begin
      perform public.record_organizer_refund_received(v_admin, v_org, 4740, v_today, null);
      r := r || ' t6_8_valor_maior=falhou';
    exception when others then
      r := r || ' t6_8_valor_maior=' || case when sqlerrm like 'ORG_VALOR:4739%' then 'ok' else 'falhou' end;
    end;
    begin
      perform public.record_organizer_refund_received(v_admin, v_org, 2000, v_today, null);
      perform public.record_organizer_refund_received(v_admin, v_org, 2739, v_today, null);
      reset role;
      select count(*) into v_n from public.organizer_balance_flags f where f.event_id = v_e3 and f.resolved_at is null;
      r := r || ' t6_8_devolucao_quitada=' || case when v_n = 0 then 'ok' else 'falhou' end;
    exception when others then
      r := r || ' t6_8_devolucao_quitada=falhou';
    end;

    -- Eventos reais: continuam sem organizador e fora das contas de repasse.
    reset role;
    select count(*) into v_n from public.events e where e.organizer_id is null;
    r := r || ' c9_eventos_reais_iguais=' || case when v_n = v_real_events then 'ok' else 'falhou' end;
    select count(*) into v_n from public.organizer_finance_event_ids() ids(id)
    join public.events e on e.id = ids.id where e.organizer_id is distinct from v_org;
    r := r || ' c9_eventos_reais_fora_dos_repasses=' || case when v_n = 0 then 'ok' else 'falhou' end;
  exception when others then
    -- Sem sqlerrm: a mensagem do erro poderia trazer dados.
    r := r || ' interrompido=falhou';
  end;

  raise exception 'ENSAIO %', r;
end;
$test$;
