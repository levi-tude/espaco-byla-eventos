-- Pedido self-service de link de nova senha (organizador ativo ou equipe).
-- Fluxo:
--   1. App gera token aleatório (32 bytes), calcula sha256 hex e chama
--      request_password_reset_link(p_email, p_token_hash) com service_role.
--   2. Se a função devolver uma linha (user_id, email), o app manda o link
--      /redefinir-senha#token=... pelo Resend. Sem linha = não manda nada, mas a
--      tela mostra a MESMA mensagem (não revela se a conta existe).
--   3. use_password_reset_invite (abaixo) gasta o link, derruba sessões e aparelhos.

begin;

-- log_audit grava em public.audit_log, que tem CHECK fechado de ações
-- (audit_log_action_check). Recria o CHECK com a ação nova 'link_senha_pedido'.
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action = any (array[
  'convite_gerado', 'convite_revogado', 'convite_usado', 'link_senha_gerado', 'link_senha_pedido',
  'senha_redefinida_link', 'conta_criada', 'conta_suspensa', 'conta_reativada', 'conta_encerrada',
  'aparelhos_esquecidos', 'evento_criado', 'evento_enviado', 'evento_envio_desfeito',
  'evento_aprovado', 'evento_recusado', 'evento_alterado_pos_aprovacao', 'evento_excluido',
  'vendas_abertas', 'vendas_pausadas', 'pedido_estorno_criado', 'pedido_exclusao_criado',
  'pedido_mudanca_criado', 'pedido_atendido', 'pedido_recusado', 'pedido_cancelado',
  'tarifa_lancada', 'repasse_registrado', 'repasse_compensado', 'repasse_ajuste',
  'devolucao_recebida', 'devolucao_pendente', 'pix_troca_pedida', 'pix_troca_cancelada',
  'pix_troca_confirmada', 'pix_troca_recusada'
]::text[]));

-- created_by é NOT NULL (FK auth.users): no pedido self-service, o próprio dono.
-- Nenhuma mudança de tabela é necessária; kind 'redefinir_senha' + target_user_id já existem.

-- Índice para revogar/contar links ativos por conta sem varrer a tabela.
create index if not exists organizer_invites_reset_target_idx
  on public.organizer_invites (target_user_id, created_at desc)
  where kind = 'redefinir_senha';

-- Conta elegível: organizador ativo (com área ligada) OU conta da equipe.
-- staff_profiles não tem coluna de ativo/status (user_id, display_name, created_at,
-- role, is_developer): existir a linha = conta da equipe válida.
create or replace function public.password_reset_account_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p_user_id is not null and (
    public.organizer_is_active(p_user_id)
    or exists (select 1 from public.staff_profiles sp where sp.user_id = p_user_id)
  );
$$;

revoke all on function public.password_reset_account_allowed(uuid) from public, anon, authenticated;
grant execute on function public.password_reset_account_allowed(uuid) to service_role;

-- Pedido público (via servidor, service_role) de link de nova senha.
create or replace function public.request_password_reset_link(p_email text, p_token_hash text)
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or char_length(v_email) not between 3 and 254 then
    return; -- nada; o app responde a mesma mensagem
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = v_email
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
  limit 1;

  if v_user_id is null or not public.password_reset_account_allowed(v_user_id) then
    return;
  end if;

  -- Teto por conta (além dos limites por IP/e-mail do app): 3 links por 24 h.
  if (
    select count(*) from public.organizer_invites i
    where i.kind = 'redefinir_senha' and i.target_user_id = v_user_id
      and i.created_by = v_user_id and i.created_at > now() - interval '24 hours'
  ) >= 3 then
    return;
  end if;

  -- Só um link ativo por conta: revoga os anteriores.
  update public.organizer_invites i
  set revoked_at = now(), revoked_by = v_user_id
  where i.kind = 'redefinir_senha' and i.target_user_id = v_user_id
    and i.used_at is null and i.revoked_at is null and i.expires_at > now();

  insert into public.organizer_invites (kind, token_hash, target_user_id, created_by, expires_at)
  values ('redefinir_senha', p_token_hash, v_user_id, v_user_id, now() + interval '24 hours');

  perform public.log_audit(
    v_user_id, 'link_senha_pedido', null, null, v_user_id,
    jsonb_build_object('kind', 'redefinir_senha', 'origem', 'self_service')
  );

  return query select v_user_id, v_email;
end;
$$;

revoke all on function public.request_password_reset_link(text, text) from public, anon, authenticated;
grant execute on function public.request_password_reset_link(text, text) to service_role;

-- Uso do link: agora aceita organizador ativo OU equipe. Mantém uso único,
-- 24 h, e derruba sessões verificadas + aparelhos lembrados.
create or replace function public.use_password_reset_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_invite public.organizer_invites%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ORG_CONVITE: Link inválido.';
  end if;

  select * into v_invite
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'redefinir_senha'
  for update;

  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now()
     or not public.password_reset_account_allowed(v_invite.target_user_id) then
    raise exception 'ORG_CONVITE: Link inválido.';
  end if;

  update public.organizer_invites i
  set used_at = now(), used_by = v_invite.target_user_id
  where i.id = v_invite.id;

  -- Outros links ativos da mesma conta deixam de valer.
  update public.organizer_invites i
  set revoked_at = now(), revoked_by = v_invite.target_user_id
  where i.kind = 'redefinir_senha' and i.target_user_id = v_invite.target_user_id
    and i.id <> v_invite.id and i.used_at is null and i.revoked_at is null;

  delete from public.verified_sessions v where v.user_id = v_invite.target_user_id;
  update public.trusted_devices d
  set revoked_at = now()
  where d.user_id = v_invite.target_user_id and d.revoked_at is null;
  -- Hoje nenhum fluxo derruba as sessões do Supabase Auth na troca de senha (só
  -- verified_sessions). Apaga as sessões (refresh tokens caem em cascata): todo
  -- aparelho precisa entrar de novo com a senha nova. O app NÃO precisa de signOut extra
  -- (auth.admin.signOut só aceita JWT, não user_id).
  delete from auth.sessions s where s.user_id = v_invite.target_user_id;

  perform public.log_audit(
    v_invite.target_user_id, 'senha_redefinida_link', null, null, v_invite.target_user_id,
    jsonb_build_object('invite_id', v_invite.id)
  );
  return v_invite.target_user_id;
end;
$$;

revoke all on function public.use_password_reset_invite(text) from public, anon, authenticated;
grant execute on function public.use_password_reset_invite(text) to service_role;

commit;
