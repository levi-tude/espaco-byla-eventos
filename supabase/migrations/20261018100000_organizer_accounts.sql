-- Contas de organizador, fase 2 (spec 2026-10-13-contas-organizador-design; plano
-- 2026-10-14-contas-organizador-fase2, tarefa 1): contas, convites, cadastro pelo
-- site, eventos de organizador e aprovação pelo Admin.
--
-- ADITIVA: aplicar ANTES do deploy do código da fase 2. A área nasce desligada
-- (organizer_settings.enabled = false): sem organizador ativo, nada muda para a
-- equipe nem para o público.
-- Voltar atrás = update public.organizer_settings set enabled = false;
--
-- Tabelas novas: RLS ligada e nenhum acesso direto (nem service_role); só
-- organizer_profiles tem leitura do próprio perfil. Tudo passa pelas funções abaixo.
-- Convite e código do e-mail: só hashes (o token e o código nunca são guardados).

-- 1) Tabelas ---------------------------------------------------------------------

create table public.organizer_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  max_session_capacity integer not null default 100 check (max_session_capacity between 1 and 2000),
  updated_at timestamptz not null default now()
);
insert into public.organizer_settings (id) values (1);

create table public.organizer_signup_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  contact text not null check (char_length(btrim(contact)) between 5 and 160),
  idea text not null check (char_length(btrim(idea)) between 10 and 1000),
  approx_date text check (approx_date is null or char_length(approx_date) <= 60),
  privacy_policy_version text not null check (char_length(privacy_policy_version) between 8 and 20),
  status text not null default 'nova' check (status in ('nova', 'convidada', 'arquivada')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.organizer_invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'convite' check (kind in ('convite', 'redefinir_senha')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  target_user_id uuid references auth.users (id) on delete cascade,
  label text check (label is null or char_length(label) <= 80),
  request_id uuid references public.organizer_signup_requests (id) on delete set null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  email_code_salt text,
  email_code_hash text,
  email_code_email text check (email_code_email is null or char_length(email_code_email) <= 254),
  email_code_expires_at timestamptz,
  email_code_attempts smallint not null default 0 check (email_code_attempts between 0 and 5),
  email_code_sends smallint not null default 0 check (email_code_sends between 0 and 3),
  email_verified_at timestamptz,
  check (used_at is null or revoked_at is null),
  check ((kind = 'redefinir_senha') = (target_user_id is not null))
);

create table public.organizer_profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  public_name text not null check (char_length(btrim(public_name)) between 2 and 80),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key text not null check (char_length(pix_key) between 1 and 77),
  pix_holder_name text not null check (char_length(btrim(pix_holder_name)) between 2 and 120),
  pix_holder_document text not null check (pix_holder_document ~ '^([0-9]{11}|[0-9]{14})$'),
  pix_key_changed_at timestamptz,
  status text not null default 'ativo' check (status in ('ativo', 'suspenso', 'encerrado')),
  status_reason text check (status_reason is null or char_length(status_reason) between 5 and 500),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  invite_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events
  add column organizer_id uuid references public.organizer_profiles (user_id),
  add column approval_status text not null default 'aprovado'
    check (approval_status in ('rascunho', 'em_analise', 'aprovado', 'recusado')),
  add column submitted_at timestamptz,
  add column approval_decided_by uuid references auth.users (id) on delete set null,
  add column approval_decided_at timestamptz,
  add column approval_note text check (approval_note is null or char_length(approval_note) between 5 and 500),
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null;
create index events_organizer_id_idx on public.events (organizer_id) where organizer_id is not null;

create table public.organizer_ops_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('estorno', 'exclusao', 'mudanca')),
  event_id uuid not null references public.events (id) on delete cascade,
  order_id uuid references public.orders (id),
  details jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  status text not null default 'pendente' check (status in ('pendente', 'atendido', 'recusado', 'cancelado')),
  requested_by uuid not null references auth.users (id),
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) between 5 and 500),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'estorno') = (order_id is not null))
);
create unique index organizer_ops_requests_refund_pending
  on public.organizer_ops_requests (order_id) where kind = 'estorno' and status = 'pendente';
create unique index organizer_ops_requests_deletion_pending
  on public.organizer_ops_requests (event_id) where kind = 'exclusao' and status = 'pendente';
create index organizer_ops_requests_event_idx on public.organizer_ops_requests (event_id, created_at desc);

-- Sem chaves estrangeiras: o histórico é imutável e sobrevive a evento apagado.
-- details nunca leva nome, e-mail, telefone, chave PIX, CPF/CNPJ ou token (só nomes de
-- campos, estados e IDs).
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'secretaria', 'organizador', 'sistema')),
  action text not null check (action in (
    'convite_gerado', 'convite_revogado', 'convite_usado', 'link_senha_gerado', 'senha_redefinida_link',
    'conta_criada', 'conta_suspensa', 'conta_reativada', 'conta_encerrada', 'aparelhos_esquecidos',
    'evento_criado', 'evento_enviado', 'evento_envio_desfeito', 'evento_aprovado', 'evento_recusado',
    'evento_alterado_pos_aprovacao', 'evento_excluido', 'vendas_abertas', 'vendas_pausadas',
    'pedido_estorno_criado', 'pedido_exclusao_criado', 'pedido_mudanca_criado',
    'pedido_atendido', 'pedido_recusado', 'pedido_cancelado'
  )),
  event_id uuid,
  order_id uuid,
  organizer_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_event_idx on public.audit_log (event_id, created_at desc) where event_id is not null;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.reject_finance_record_change();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_finance_record_change();

alter table public.organizer_settings enable row level security;
alter table public.organizer_signup_requests enable row level security;
alter table public.organizer_invites enable row level security;
alter table public.organizer_profiles enable row level security;
alter table public.organizer_ops_requests enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.organizer_settings from public, anon, authenticated, service_role;
revoke all on table public.organizer_signup_requests from public, anon, authenticated, service_role;
revoke all on table public.organizer_invites from public, anon, authenticated, service_role;
revoke all on table public.organizer_profiles from public, anon, authenticated, service_role;
revoke all on table public.organizer_ops_requests from public, anon, authenticated, service_role;
revoke all on table public.audit_log from public, anon, authenticated, service_role;

grant select on table public.organizer_profiles to authenticated;

-- 2) Identidade --------------------------------------------------------------------

create function public.organizer_area_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.organizer_settings s where s.id = 1), false);
$$;

create function public.organizer_is_active(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and public.organizer_area_enabled()
    and exists (
      select 1 from public.organizer_profiles op
      where op.user_id = p_user_id and op.status = 'ativo'
    );
$$;

-- Fase 1 deixou este ponto preparado: agora o organizador ativo também usa o código.
create or replace function public.login_code_eligible(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and (
      exists (select 1 from public.staff_profiles sp where sp.user_id = p_user_id)
      or public.organizer_is_active(p_user_id)
    );
$$;

-- Para o proxy e o login escolherem a área; não exige o código e não revela mais nada.
create function public.my_account_kind()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())) then 'equipe'
    when exists (select 1 from public.organizer_profiles op where op.user_id = (select auth.uid())) then 'organizador'
  end;
$$;

create function public.is_organizer()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.organizer_is_active((select auth.uid())) and public.session_is_verified();
$$;

create function public.owns_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_organizer()
    and exists (
      select 1 from public.events e
      where e.id = p_event_id and e.organizer_id = (select auth.uid()) and e.deleted_at is null
    );
$$;

-- Base de toda função compartilhada (service_role). O servidor já conferiu a sessão
-- verificada com is_staff()/is_organizer() antes de chamar.
create function public.actor_event_access(p_actor_user_id uuid, p_event_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_actor_user_id is null or p_event_id is null then null
    when exists (select 1 from public.staff_profiles sp where sp.user_id = p_actor_user_id) then
      case when exists (select 1 from public.events e where e.id = p_event_id) then 'equipe' end
    when public.organizer_is_active(p_actor_user_id)
      and exists (
        select 1 from public.events e
        where e.id = p_event_id and e.organizer_id = p_actor_user_id and e.deleted_at is null
      ) then 'dono'
  end;
$$;

create function public.staff_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_profiles sp where sp.user_id = p_user_id and sp.role = 'admin'
  );
$$;

-- Funções security invoker (service_role) não leem organizer_settings nem
-- organizer_ops_requests: usam estes dois auxiliares.
create function public.organizer_max_capacity()
returns integer language sql stable security definer set search_path = '' as $$
  select s.max_session_capacity from public.organizer_settings s where s.id = 1;
$$;

create function public.event_deletion_pending(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizer_ops_requests r
    where r.event_id = p_event_id and r.kind = 'exclusao' and r.status = 'pendente'
  );
$$;

create policy organizer_profiles_self_read on public.organizer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_organizer());

-- Ninguém é equipe e organizador ao mesmo tempo.
create function public.forbid_staff_and_organizer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'organizer_profiles'
     and exists (select 1 from public.staff_profiles sp where sp.user_id = new.user_id) then
    raise exception 'ORG_ACESSO: Conta da equipe não pode ser organizador.';
  end if;
  if tg_table_name = 'staff_profiles'
     and exists (select 1 from public.organizer_profiles op where op.user_id = new.user_id) then
    raise exception 'ORG_ACESSO: Conta de organizador não pode ser da equipe.';
  end if;
  return new;
end;
$$;
create trigger organizer_profiles_not_staff
  before insert or update of user_id on public.organizer_profiles
  for each row execute function public.forbid_staff_and_organizer();
create trigger staff_profiles_not_organizer
  before insert or update of user_id on public.staff_profiles
  for each row execute function public.forbid_staff_and_organizer();

create function public.log_audit(
  p_actor uuid, p_action text, p_event_id uuid, p_order_id uuid, p_organizer_id uuid, p_details jsonb
)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_log (actor_user_id, actor_kind, action, event_id, order_id, organizer_id, details)
  values (
    p_actor,
    case
      when p_actor is null then 'sistema'
      when public.staff_is_admin(p_actor) then 'admin'
      when exists (select 1 from public.staff_profiles sp where sp.user_id = p_actor) then 'secretaria'
      else 'organizador'
    end,
    p_action, p_event_id, p_order_id, p_organizer_id, coalesce(p_details, '{}'::jsonb)
  );
$$;

create function public.valid_tax_document(p_doc text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  d integer[];
  s integer;
  r integer;
  i integer;
  w1 integer[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  w2 integer[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
begin
  if p_doc is null or p_doc !~ '^([0-9]{11}|[0-9]{14})$' or p_doc ~ '^(.)\1*$' then
    return false;
  end if;
  d := array(select substr(p_doc, g, 1)::integer from generate_series(1, length(p_doc)) g);
  if length(p_doc) = 11 then
    s := 0;
    for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> d[10] then return false; end if;
    s := 0;
    for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = d[11];
  end if;
  s := 0;
  for i in 1..12 loop s := s + d[i] * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> d[13] then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + d[i] * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = d[14];
end;
$$;

-- 3) Trava do evento de organizador -------------------------------------------------

-- Só as funções do fluxo (que ligam byla.organizer_flow) mudam dono, aprovação e
-- exclusão. Mesmo um erro no servidor ou uma conta da equipe escrevendo direto pela
-- política events_staff_write não publica rascunho nem pula o Admin.
create function public.events_guard_organizer()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_flow boolean := coalesce(current_setting('byla.organizer_flow', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_flow and (
      new.organizer_id is not null or new.approval_status <> 'aprovado'
      or new.submitted_at is not null or new.approval_decided_by is not null
      or new.approval_decided_at is not null or new.approval_note is not null
      or new.deleted_at is not null or new.deleted_by is not null
    ) then
      raise exception 'ORG_ESTADO: Evento de organizador só pelo fluxo próprio.';
    end if;
  else
    if new.organizer_id is distinct from old.organizer_id then
      raise exception 'ORG_DONO: O dono do evento não muda.';
    end if;
    if not v_flow and (
      new.approval_status, new.submitted_at, new.approval_decided_by, new.approval_decided_at,
      new.approval_note, new.deleted_at, new.deleted_by
    ) is distinct from (
      old.approval_status, old.submitted_at, old.approval_decided_by, old.approval_decided_at,
      old.approval_note, old.deleted_at, old.deleted_by
    ) then
      raise exception 'ORG_ESTADO: Aprovação e exclusão só pelo fluxo próprio.';
    end if;
  end if;

  if new.sales_open and (
    new.deleted_at is not null
    or (new.organizer_id is not null and new.approval_status <> 'aprovado')
  ) then
    raise exception 'ORG_ESTADO: Evento de organizador só abre vendas depois de aprovado.';
  end if;
  return new;
end;
$$;

-- Nome em ordem alfabética antes de events_mark_published: dispara primeiro.
create trigger events_guard_organizer
  before insert or update on public.events
  for each row execute function public.events_guard_organizer();

-- 4) Convites, código do e-mail e pedidos do site ------------------------------------

-- "Convite válido" = kind 'convite', não usado, não revogado, dentro da validade e com a
-- área ligada. Toda função trava a linha do convite (for update) antes de mudar algo.

create function public.create_organizer_invite(
  p_admin uuid,
  p_token_hash text,
  p_kind text,
  p_label text,
  p_request_id uuid,
  p_target_user_id uuid
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_label text;
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_kind is null or p_kind not in ('convite', 'redefinir_senha') then
    raise exception 'ORG_CONVITE: Convite inválido.';
  end if;

  if p_kind = 'convite' then
    v_label := nullif(btrim(coalesce(p_label, '')), '');
    if v_label is not null and char_length(v_label) > 80 then
      raise exception 'ORG_CONVITE: Apelido muito longo.';
    end if;
    if p_request_id is not null then
      perform 1 from public.organizer_signup_requests r where r.id = p_request_id for update;
      if not found then
        raise exception 'ORG_CONVITE: Pedido não encontrado.';
      end if;
    end if;
  elsif p_target_user_id is null or not exists (
    select 1 from public.organizer_profiles op where op.user_id = p_target_user_id
  ) then
    raise exception 'ORG_ACESSO: Link de senha só para conta de organizador.';
  elsif not exists (
    select 1 from public.organizer_profiles op
    where op.user_id = p_target_user_id and op.status = 'ativo'
  ) then
    raise exception 'ORG_CONVITE: Organizador não está ativo.';
  end if;

  if not public.consume_rate_limit(
    'org-invite:admin-day',
    encode(sha256(convert_to('byla-rate-limit:' || p_admin::text, 'UTF8')), 'hex'),
    30,
    86400
  ) then
    raise exception 'ORG_LIMITE: Limite de convites do dia atingido.';
  end if;

  if p_kind = 'convite' then
    insert into public.organizer_invites (kind, token_hash, label, request_id, created_by, expires_at)
    values ('convite', p_token_hash, v_label, p_request_id, p_admin, now() + interval '7 days')
    returning id into v_id;

    if p_request_id is not null then
      update public.organizer_signup_requests r
      set status = 'convidada', handled_by = p_admin, handled_at = now()
      where r.id = p_request_id;
    end if;

    perform public.log_audit(p_admin, 'convite_gerado', null, null, null, jsonb_build_object('kind', 'convite'));
  else
    -- Só um link de senha ativo por organizador.
    update public.organizer_invites i
    set revoked_at = now(), revoked_by = p_admin
    where i.kind = 'redefinir_senha' and i.target_user_id = p_target_user_id
      and i.used_at is null and i.revoked_at is null and i.expires_at > now();

    insert into public.organizer_invites (kind, token_hash, target_user_id, created_by, expires_at)
    values ('redefinir_senha', p_token_hash, p_target_user_id, p_admin, now() + interval '24 hours')
    returning id into v_id;

    perform public.log_audit(
      p_admin, 'link_senha_gerado', null, null, p_target_user_id,
      jsonb_build_object('kind', 'redefinir_senha')
    );
  end if;

  return v_id;
end;
$$;

create function public.revoke_organizer_invite(p_admin uuid, p_invite_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.organizer_invites%rowtype;
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  select * into v_invite from public.organizer_invites i where i.id = p_invite_id for update;
  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() then
    return false;
  end if;
  update public.organizer_invites i
  set revoked_at = now(), revoked_by = p_admin
  where i.id = v_invite.id;
  perform public.log_audit(
    p_admin, 'convite_revogado', null, null, v_invite.target_user_id,
    jsonb_build_object('kind', v_invite.kind, 'invite_id', v_invite.id)
  );
  return true;
end;
$$;

create function public.list_organizer_invites(p_admin uuid)
returns table (
  id uuid,
  kind text,
  label text,
  status text,
  expires_at timestamptz,
  used_at timestamptz,
  used_by_public_name text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  return query
  select
    i.id,
    i.kind,
    i.label,
    case
      when i.revoked_at is not null then 'revogado'
      when i.used_at is not null then 'usado'
      when i.expires_at <= now() then 'vencido'
      else 'ativo'
    end,
    i.expires_at,
    i.used_at,
    op.public_name,
    i.created_at
  from public.organizer_invites i
  left join public.organizer_profiles op on op.user_id = i.used_by
  order by i.created_at desc, i.id
  limit 200;
end;
$$;

create function public.check_organizer_invite(p_token_hash text)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.organizer_invites i
    where i.token_hash = p_token_hash and i.kind = 'convite'
      and i.used_at is null and i.revoked_at is null and i.expires_at > now()
  ) and public.organizer_area_enabled() then 'valido' else 'invalido' end;
$$;

-- Código de 6 dígitos gerado pelo servidor (gerador criptográfico) e enviado ao e-mail.
-- Guarda só sha256(sal || ':' || código), com sal por convite que nunca sai do banco.
-- 'ok' | 'limite' (3 envios por convite) | 'email_indisponivel' | 'invalido'.
create function public.start_invite_email_code(p_token_hash text, p_email text, p_code text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.organizer_invites%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_salt text;
begin
  select * into v_invite
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'convite'
  for update;

  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() or not public.organizer_area_enabled() then
    return 'invalido';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$'
     or char_length(v_email) > 254
     or v_email !~ '^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,}$' then
    return 'invalido';
  end if;
  if v_invite.email_code_sends >= 3 then
    return 'limite';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return 'email_indisponivel';
  end if;

  v_salt := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.organizer_invites i
  set email_code_salt = v_salt,
      email_code_hash = encode(sha256(convert_to(v_salt || ':' || p_code, 'UTF8')), 'hex'),
      email_code_email = v_email,
      email_code_expires_at = now() + interval '15 minutes',
      email_code_attempts = 0,
      email_code_sends = i.email_code_sends + 1,
      email_verified_at = null
  where i.id = v_invite.id;
  return 'ok';
end;
$$;

-- 'ok' | 'invalido' | 'expirado' | 'bloqueado' | 'convite_invalido'. 5 erros
-- invalidam o código (um novo envio, dentro do limite, recomeça a contagem).
create function public.verify_invite_email_code(p_token_hash text, p_code text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.organizer_invites%rowtype;
begin
  select * into v_invite
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'convite'
  for update;

  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() or not public.organizer_area_enabled() then
    return 'convite_invalido';
  end if;
  if v_invite.email_code_hash is null or v_invite.email_code_expires_at is null
     or v_invite.email_code_expires_at <= now() then
    return 'expirado';
  end if;
  if v_invite.email_code_attempts >= 5 then
    return 'bloqueado';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return 'invalido';
  end if;

  if encode(sha256(convert_to(v_invite.email_code_salt || ':' || p_code, 'UTF8')), 'hex')
     <> v_invite.email_code_hash then
    update public.organizer_invites i
    set email_code_attempts = i.email_code_attempts + 1
    where i.id = v_invite.id;
    return case when v_invite.email_code_attempts + 1 >= 5 then 'bloqueado' else 'invalido' end;
  end if;

  update public.organizer_invites i
  set email_verified_at = now(), email_code_salt = null, email_code_hash = null
  where i.id = v_invite.id;
  return 'ok';
end;
$$;

create function public.invite_verified_email(p_token_hash text)
returns text language sql stable security definer set search_path = '' as $$
  select i.email_code_email
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'convite'
    and i.used_at is null and i.revoked_at is null and i.expires_at > now()
    and i.email_verified_at is not null
    and public.organizer_area_enabled();
$$;

-- O servidor cria a conta (auth.admin.createUser, e-mail já confirmado) e chama esta
-- função; se ela falhar, apaga a conta recém-criada. Dois envios ao mesmo tempo: só um
-- passa (trava no convite).
create function public.accept_organizer_invite(
  p_token_hash text,
  p_user_id uuid,
  p_full_name text,
  p_public_name text,
  p_phone text,
  p_pix_key_type text,
  p_pix_key text,
  p_pix_holder_name text,
  p_pix_holder_document text,
  p_terms_version text
)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.organizer_invites%rowtype;
  v_email text;
begin
  select * into v_invite
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'convite'
  for update;

  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() or not public.organizer_area_enabled() then
    raise exception 'ORG_CONVITE: Convite inválido.';
  end if;
  if v_invite.email_verified_at is null or v_invite.email_code_email is null then
    raise exception 'ORG_EMAIL: E-mail não confirmado.';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_email <> v_invite.email_code_email then
    raise exception 'ORG_EMAIL: E-mail da conta diferente do confirmado.';
  end if;

  if p_terms_version is null or char_length(p_terms_version) not between 8 and 20
     or not public.valid_tax_document(p_pix_holder_document)
     or (p_pix_key_type = 'cpf' and char_length(p_pix_holder_document) <> 11)
     or (p_pix_key_type = 'cnpj' and char_length(p_pix_holder_document) <> 14)
     or (p_pix_key_type in ('cpf', 'cnpj') and p_pix_key <> p_pix_holder_document) then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;

  begin
    insert into public.organizer_profiles (
      user_id, full_name, public_name, phone, pix_key_type, pix_key, pix_holder_name,
      pix_holder_document, terms_version, terms_accepted_at, invite_id
    ) values (
      p_user_id, btrim(p_full_name), btrim(p_public_name), p_phone, p_pix_key_type, btrim(p_pix_key),
      btrim(p_pix_holder_name), p_pix_holder_document, p_terms_version, now(), v_invite.id
    );
  exception when check_violation or not_null_violation or unique_violation then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end;

  update public.organizer_invites i
  set used_at = now(), used_by = p_user_id,
      email_code_salt = null, email_code_hash = null, email_code_expires_at = null
  where i.id = v_invite.id;

  perform public.log_audit(p_user_id, 'convite_usado', null, null, p_user_id, jsonb_build_object('invite_id', v_invite.id));
  perform public.log_audit(p_user_id, 'conta_criada', null, null, p_user_id, '{}'::jsonb);
end;
$$;

-- Link de redefinição de senha (gerado pelo Admin, uso único, 24 h). Marca usado,
-- derruba as verificações e esquece os aparelhos; o servidor troca a senha do alvo.
create function public.use_password_reset_invite(p_token_hash text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.organizer_invites%rowtype;
begin
  select * into v_invite
  from public.organizer_invites i
  where i.token_hash = p_token_hash and i.kind = 'redefinir_senha'
  for update;

  if not found or v_invite.used_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() or not public.organizer_is_active(v_invite.target_user_id) then
    raise exception 'ORG_CONVITE: Link inválido.';
  end if;

  update public.organizer_invites i
  set used_at = now(), used_by = v_invite.target_user_id
  where i.id = v_invite.id;

  delete from public.verified_sessions v where v.user_id = v_invite.target_user_id;
  update public.trusted_devices d
  set revoked_at = now()
  where d.user_id = v_invite.target_user_id and d.revoked_at is null;

  perform public.log_audit(
    v_invite.target_user_id, 'senha_redefinida_link', null, null, v_invite.target_user_id,
    jsonb_build_object('invite_id', v_invite.id)
  );
  return v_invite.target_user_id;
end;
$$;

-- "Quero fazer meu evento". O servidor já passou pelo anti-robô e pelo limite por IP.
create function public.submit_signup_request(
  p_name text,
  p_contact text,
  p_idea text,
  p_approx_date text,
  p_privacy_version text
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_idea text := btrim(coalesce(p_idea, ''));
  v_date text := nullif(btrim(coalesce(p_approx_date, '')), '');
begin
  if not public.organizer_area_enabled() then
    raise exception 'ORG_DESLIGADO: Área de organizadores desligada.';
  end if;
  if char_length(v_name) not between 2 and 120
     or char_length(v_contact) not between 5 and 160
     or char_length(v_idea) not between 10 and 1000
     or (v_date is not null and char_length(v_date) > 60)
     or p_privacy_version is null or char_length(p_privacy_version) not between 8 and 20 then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;
  if not public.consume_rate_limit('org-request:all-day', 'site', 30, 86400) then
    raise exception 'ORG_LIMITE: Limite de pedidos do dia atingido.';
  end if;

  begin
    insert into public.organizer_signup_requests (name, contact, idea, approx_date, privacy_policy_version)
    values (v_name, v_contact, v_idea, v_date, p_privacy_version)
    returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end;
  return v_id;
end;
$$;

create function public.list_signup_requests(p_admin uuid, p_status text)
returns table (
  id uuid,
  name text,
  contact text,
  idea text,
  approx_date text,
  status text,
  handled_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_status is null or p_status not in ('nova', 'convidada', 'arquivada') then
    raise exception 'ORG_DADOS: Situação inválida.';
  end if;
  return query
  select r.id, r.name, r.contact, r.idea, r.approx_date, r.status, r.handled_at, r.created_at
  from public.organizer_signup_requests r
  where r.status = p_status
  order by r.created_at desc, r.id
  limit 200;
end;
$$;

create function public.archive_signup_request(p_admin uuid, p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  update public.organizer_signup_requests r
  set status = 'arquivada', handled_by = p_admin, handled_at = now()
  where r.id = p_id and r.status in ('nova', 'convidada');
  return found;
end;
$$;

-- 5) Contas e aparelhos ---------------------------------------------------------------

-- Chave PIX e CPF/CNPJ do titular só mascarados nesta fase.
create function public.list_organizers(p_admin uuid)
returns table (
  user_id uuid,
  full_name text,
  public_name text,
  email text,
  phone text,
  status text,
  pix_key_type text,
  pix_key_masked text,
  pix_holder_name text,
  pix_holder_document_masked text,
  events_count integer,
  devices_count integer,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  return query
  select
    op.user_id,
    op.full_name,
    op.public_name,
    u.email::text,
    op.phone,
    op.status,
    op.pix_key_type,
    case
      when op.pix_key_type = 'email' then '•••@' || split_part(op.pix_key, '@', 2)
      else '•••• ' || right(op.pix_key, 4)
    end,
    op.pix_holder_name,
    case
      when char_length(op.pix_holder_document) = 11 then
        '•••.' || substr(op.pix_holder_document, 4, 3) || '.' || substr(op.pix_holder_document, 7, 3) || '-••'
      else
        '••.•••.' || substr(op.pix_holder_document, 6, 3) || '/' || substr(op.pix_holder_document, 9, 4) || '-••'
    end,
    (select count(*)::integer from public.events e
     where e.organizer_id = op.user_id and e.deleted_at is null),
    (select count(*)::integer from public.trusted_devices d
     where d.user_id = op.user_id and d.revoked_at is null and d.expires_at > now()),
    op.created_at
  from public.organizer_profiles op
  left join auth.users u on u.id = op.user_id
  order by op.created_at desc, op.user_id;
end;
$$;

-- Sair de 'ativo' derruba na hora as sessões verificadas (o organizador perde o acesso).
create function public.set_organizer_status(p_admin uuid, p_user_id uuid, p_status text, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_status is null or p_status not in ('ativo', 'suspenso', 'encerrado')
     or (p_status <> 'ativo' and (v_reason is null or char_length(v_reason) not between 5 and 500)) then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;

  select op.status into v_old from public.organizer_profiles op where op.user_id = p_user_id for update;
  if not found then
    raise exception 'ORG_DADOS: Organizador não encontrado.';
  end if;
  if v_old = p_status then
    return;
  end if;

  update public.organizer_profiles op
  set status = p_status,
      status_reason = case when p_status = 'ativo' then null else v_reason end,
      updated_at = now()
  where op.user_id = p_user_id;

  if p_status <> 'ativo' then
    delete from public.verified_sessions v where v.user_id = p_user_id;
  end if;

  perform public.log_audit(
    p_admin,
    case p_status when 'suspenso' then 'conta_suspensa' when 'encerrado' then 'conta_encerrada' else 'conta_reativada' end,
    null, null, p_user_id,
    jsonb_build_object('de', v_old, 'para', p_status)
  );
end;
$$;

-- "Meus aparelhos" (equipe e organizador), com a sessão verificada do próprio usuário.
create function public.list_my_devices(p_current_token text)
returns table (
  id uuid,
  label text,
  created_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  is_current boolean
)
language sql stable security definer set search_path = '' as $$
  select
    d.id,
    d.label,
    d.created_at,
    d.last_used_at,
    d.expires_at,
    coalesce(
      p_current_token ~ '^[A-Za-z0-9_-]{43,128}$'
        and d.token_hash = encode(sha256(convert_to(p_current_token, 'UTF8')), 'hex'),
      false
    )
  from public.trusted_devices d
  where d.user_id = (select auth.uid())
    and public.session_is_verified()
    and d.revoked_at is null
    and d.expires_at > now()
  order by coalesce(d.last_used_at, d.created_at) desc, d.id;
$$;

create function public.forget_my_device(p_device_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or p_device_id is null or not public.session_is_verified() then
    return false;
  end if;
  update public.trusted_devices d
  set revoked_at = now()
  where d.id = p_device_id and d.user_id = (select auth.uid()) and d.revoked_at is null;
  if not found then
    return false;
  end if;
  -- verified_sessions não guarda qual aparelho verificou cada sessão: derruba todas as
  -- outras da conta (o aparelho perdido para na hora). Navegadores ainda lembrados se
  -- verificam de novo sozinhos pelo cookie; o esquecido precisa do código no e-mail.
  delete from public.verified_sessions v
  where v.user_id = (select auth.uid())
    and v.session_id is distinct from public.current_session_id();
  return true;
end;
$$;

create function public.admin_forget_devices(p_admin uuid, p_user_id uuid)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_user_id is null then
    raise exception 'ORG_DADOS: Conta não informada.';
  end if;

  update public.trusted_devices d
  set revoked_at = now()
  where d.user_id = p_user_id and d.revoked_at is null;
  get diagnostics v_count = row_count;

  delete from public.verified_sessions v where v.user_id = p_user_id;

  perform public.log_audit(
    p_admin, 'aparelhos_esquecidos', null, null,
    case when exists (select 1 from public.organizer_profiles op where op.user_id = p_user_id) then p_user_id end,
    jsonb_build_object('aparelhos', v_count)
  );
  return v_count;
end;
$$;

create function public.staff_security_overview(p_admin uuid)
returns table (
  user_id uuid,
  display_name text,
  role text,
  is_developer boolean,
  devices_count integer,
  last_used_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  return query
  select
    sp.user_id,
    sp.display_name,
    sp.role,
    sp.is_developer,
    (select count(*)::integer from public.trusted_devices d
     where d.user_id = sp.user_id and d.revoked_at is null and d.expires_at > now()),
    (select max(d.last_used_at) from public.trusted_devices d
     where d.user_id = sp.user_id and d.revoked_at is null and d.expires_at > now())
  from public.staff_profiles sp
  order by sp.display_name, sp.user_id;
end;
$$;

-- 6) Evento de organizador e aprovação ------------------------------------------------

-- Evento aprovado: o que o dono não pode mudar sozinho (seção 6.4 do spec). Chamada
-- por save_event_with_sessions DEPOIS de save_event_ticket_types (type_index aponta
-- para a lista nova) e ANTES de save_event_sessions (as sessões ainda têm os valores
-- antigos). Só sessões com vendas contam para horário, preço e lotação.
create function public.organizer_change_violations(
  p_event_id uuid, p_name text, p_venue text, p_sessions jsonb
)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_out text[] := '{}';
  v_item jsonb;
  v_price jsonb;
  v_session public.event_sessions%rowtype;
  v_type_ids uuid[];
  v_type_id uuid;
  v_listed uuid[];
  v_old public.session_ticket_types%rowtype;
  v_new_int integer;
  v_pos integer := 0;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if btrim(coalesce(p_name, '')) is distinct from btrim(coalesce(v_event.name, '')) then
    v_out := array_append(v_out, 'nome');
  end if;
  if btrim(coalesce(p_venue, '')) is distinct from btrim(coalesce(v_event.venue, '')) then
    v_out := array_append(v_out, 'local');
  end if;

  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array' then
    return array(select distinct x from unnest(v_out) x order by x);
  end if;

  select coalesce(array_agg(tt.id order by tt.sort_order, tt.id), '{}') into v_type_ids
  from public.ticket_types tt
  where tt.event_id = p_event_id and tt.archived_at is null and tt.kind <> 'cortesia';

  for v_item in select e.item from jsonb_array_elements(p_sessions) as e(item) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string'
       or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      continue;
    end if;
    select * into v_session from public.event_sessions s
    where s.id = (v_item ->> 'id')::uuid and s.event_id = p_event_id;
    if not found or not public.session_has_live_orders(v_session.id) then continue; end if;

    if (v_item ->> 'starts_at')::timestamptz is distinct from v_session.starts_at
       or nullif(v_item ->> 'ends_at', '')::timestamptz is distinct from v_session.ends_at then
      v_out := array_append(v_out, 'horario');
    end if;
    if (v_item ->> 'capacity')::integer < v_session.capacity then
      v_out := array_append(v_out, 'lotacao');
    end if;
    v_new_int := nullif(v_item ->> 'inteira_quota', '')::integer;
    if (v_session.inteira_quota is null and v_new_int is not null) or v_new_int < v_session.inteira_quota then
      v_out := array_append(v_out, 'lotacao');
    end if;
    v_new_int := nullif(v_item ->> 'meia_quota', '')::integer;
    if (v_session.meia_quota is null and v_new_int is not null) or v_new_int < v_session.meia_quota then
      v_out := array_append(v_out, 'lotacao');
    end if;

    v_listed := '{}';
    for v_price in select p.item from jsonb_array_elements(coalesce(v_item -> 'prices', '[]'::jsonb)) as p(item) loop
      v_type_id := v_type_ids[(v_price ->> 'type_index')::integer + 1];
      if v_type_id is not null then
        v_listed := v_listed || v_type_id;
      end if;
      select * into v_old from public.session_ticket_types stt
      where stt.session_id = v_session.id and stt.ticket_type_id = v_type_id;
      if not found or not v_old.on_sale then continue; end if;
      if not coalesce((v_price ->> 'on_sale')::boolean, false)
         or (v_price ->> 'price_cents')::integer is distinct from v_old.price_cents then
        v_out := array_append(v_out, 'preco');
      end if;
      v_new_int := nullif(v_price ->> 'max_units', '')::integer;
      if (v_old.max_units is null and v_new_int is not null) or v_new_int < v_old.max_units then
        v_out := array_append(v_out, 'lotacao');
      end if;
    end loop;

    -- Tipo à venda que sumiu da lista desta sessão ou foi tirado do evento agora
    -- (save_event_ticket_types arquiva com now()) também sai da venda: é mudança de preço.
    if exists (
      select 1
      from public.session_ticket_types stt
      join public.ticket_types tt on tt.id = stt.ticket_type_id
      where stt.session_id = v_session.id
        and stt.on_sale
        and tt.kind <> 'cortesia'
        and (tt.archived_at is null or tt.archived_at >= now())
        and not (stt.ticket_type_id = any(v_listed))
    ) then
      v_out := array_append(v_out, 'preco');
    end if;
  end loop;

  return array(select distinct x from unnest(v_out) x order by x);
exception when data_exception then
  raise exception 'SESSAO_INVALIDA:%', greatest(v_pos, 1);
end;
$$;

-- p_staff_user_id passa a significar "quem age" (equipe ou dono do evento). O dono só
-- chega aqui por save_event_with_sessions (que liga byla.session_editor e confere as
-- regras do organizador antes).
create or replace function public.save_event_sessions(
  p_event_id uuid,
  p_sessions jsonb,
  p_staff_user_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_access text;
  v_type_ids uuid[];
  v_type_names text[];
  v_type_count integer;
  v_item jsonb;
  v_price jsonb;
  v_raw text;
  v_pos integer := 0;
  v_ids uuid[] := '{}';
  v_prev_starts timestamptz[] := '{}';
  v_prev_ends timestamptz[] := '{}';
  v_names text[] := '{}';
  v_starts timestamptz[] := '{}';
  v_ends timestamptz[] := '{}';
  v_capacities integer[] := '{}';
  v_inteiras integer[] := '{}';
  v_meias integer[] := '{}';
  v_id uuid;
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_capacity integer;
  v_inteira integer;
  v_meia integer;
  v_existing public.event_sessions%rowtype;
  v_session public.event_sessions%rowtype;
  v_taken bigint;
  v_paid integer;
  v_type_index integer;
  v_type_id uuid;
  v_price_cents integer;
  v_max integer;
  v_on_sale boolean;
  v_seen_types uuid[];
  v_on_sale_count integer;
  i integer;
begin
  v_access := public.actor_event_access(p_staff_user_id, p_event_id);
  if v_access is null then
    if p_staff_user_id is not null
      and exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id) then
      raise exception 'SESSAO_EVENTO: Evento não encontrado.';
    end if;
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  if v_access = 'dono' and not public.session_editor_active() then
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'SESSAO_EVENTO: Evento não encontrado.';
  end if;
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array'
    or jsonb_array_length(p_sessions) not between 1 and 20 then
    raise exception 'SESSAO_QUANTIDADE: Cadastre de 1 a 20 sessões.';
  end if;

  -- Trava todas as sessões do evento (ordem fixa: evento → sessões por id).
  perform 1 from public.event_sessions s where s.event_id = p_event_id order by s.id for update;

  select coalesce(array_agg(tt.id order by tt.sort_order, tt.id), '{}'),
         coalesce(array_agg(tt.name order by tt.sort_order, tt.id), '{}')
  into v_type_ids, v_type_names
  from public.ticket_types tt
  where tt.event_id = p_event_id and tt.archived_at is null and tt.kind <> 'cortesia';
  v_type_count := coalesce(array_length(v_type_ids, 1), 0);

  -- 4.1) Leitura e validação de formato de cada sessão.
  for v_item in select e.item from jsonb_array_elements(p_sessions) as e(item) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;

    v_id := null;
    if v_item -> 'id' is not null and jsonb_typeof(v_item -> 'id') <> 'null' then
      v_raw := v_item ->> 'id';
      if jsonb_typeof(v_item -> 'id') <> 'string'
        or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_id := v_raw::uuid;
      if v_id = any(v_ids) then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      select * into v_existing
      from public.event_sessions s
      where s.id = v_id and s.event_id = p_event_id and s.archived_at is null;
      if not found then
        raise exception 'SESSAO_DESATUALIZADA: Sessão não encontrada.';
      end if;
      if v_existing.status <> 'ativa' then
        raise exception 'SESSAO_CANCELADA:%', v_pos;
      end if;
    end if;

    v_name := null;
    if v_item -> 'name' is not null and jsonb_typeof(v_item -> 'name') <> 'null' then
      if jsonb_typeof(v_item -> 'name') <> 'string' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_name := nullif(btrim(v_item ->> 'name'), '');
      if v_name is not null and char_length(v_name) > 60 then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
    end if;

    if jsonb_typeof(v_item -> 'starts_at') is distinct from 'string' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    begin
      v_start := (v_item ->> 'starts_at')::timestamptz;
      v_end := null;
      if v_item -> 'ends_at' is not null and jsonb_typeof(v_item -> 'ends_at') <> 'null' then
        if jsonb_typeof(v_item -> 'ends_at') <> 'string' then
          raise exception 'SESSAO_INVALIDA:%', v_pos;
        end if;
        v_end := (v_item ->> 'ends_at')::timestamptz;
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end;
    if v_end is not null and v_end <= v_start then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    if v_start = any(v_starts) or exists (
      select 1 from public.event_sessions s
      where s.event_id = p_event_id
        and s.archived_at is null
        and s.status <> 'ativa'
        and s.starts_at = v_start
    ) then
      raise exception 'SESSAO_HORARIO_REPETIDO:%', v_pos;
    end if;

    v_raw := v_item ->> 'capacity';
    if jsonb_typeof(v_item -> 'capacity') is distinct from 'number' or v_raw !~ '^[0-9]{1,6}$' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    v_capacity := v_raw::integer;
    if v_capacity not between 1 and 100000 then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;

    v_inteira := null;
    if v_item -> 'inteira_quota' is not null and jsonb_typeof(v_item -> 'inteira_quota') <> 'null' then
      v_raw := v_item ->> 'inteira_quota';
      if jsonb_typeof(v_item -> 'inteira_quota') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_inteira := v_raw::integer;
    end if;
    v_meia := null;
    if v_item -> 'meia_quota' is not null and jsonb_typeof(v_item -> 'meia_quota') <> 'null' then
      v_raw := v_item ->> 'meia_quota';
      if jsonb_typeof(v_item -> 'meia_quota') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_meia := v_raw::integer;
    end if;
    if (v_inteira is not null and v_inteira not between 1 and v_capacity)
      or (v_meia is not null and v_meia not between 1 and v_capacity)
      or coalesce(v_inteira, 0) + coalesce(v_meia, 0) > v_capacity then
      raise exception 'SESSAO_COTA_INVALIDA:%', v_pos;
    end if;

    if v_id is not null then
      v_taken := public.session_occupied_count(v_id);
      if v_capacity < v_taken then
        raise exception 'SESSAO_LOTACAO_MENOR:%:%', v_pos, v_taken;
      end if;
      if v_inteira is not null then
        v_taken := public.session_kind_occupied_count(v_id, 'inteira');
        if v_inteira < v_taken then
          raise exception 'SESSAO_COTA_MENOR:%:inteira:%', v_pos, v_taken;
        end if;
      end if;
      if v_meia is not null then
        v_taken := public.session_kind_occupied_count(v_id, 'meia');
        if v_meia < v_taken then
          raise exception 'SESSAO_COTA_MENOR:%:meia:%', v_pos, v_taken;
        end if;
      end if;
    end if;

    -- Preços: um item por tipo, no máximo; tipo à venda exige preço.
    if jsonb_typeof(v_item -> 'prices') is distinct from 'array' then
      raise exception 'SESSAO_INVALIDA:%', v_pos;
    end if;
    v_seen_types := '{}';
    v_on_sale_count := 0;
    for v_price in select e.item from jsonb_array_elements(v_item -> 'prices') as e(item) loop
      if jsonb_typeof(v_price) <> 'object' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_raw := v_price ->> 'type_index';
      if jsonb_typeof(v_price -> 'type_index') is distinct from 'number' or v_raw !~ '^[0-9]{1,2}$' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_type_index := v_raw::integer;
      if v_type_index >= v_type_count then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_type_id := v_type_ids[v_type_index + 1];
      if v_type_id = any(v_seen_types) then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_seen_types := v_seen_types || v_type_id;

      if jsonb_typeof(v_price -> 'on_sale') is distinct from 'boolean' then
        raise exception 'SESSAO_INVALIDA:%', v_pos;
      end if;
      v_on_sale := (v_price ->> 'on_sale')::boolean;

      v_price_cents := null;
      if v_price -> 'price_cents' is not null and jsonb_typeof(v_price -> 'price_cents') <> 'null' then
        v_raw := v_price ->> 'price_cents';
        if jsonb_typeof(v_price -> 'price_cents') <> 'number' or v_raw !~ '^[0-9]{1,9}$' then
          raise exception 'SESSAO_PRECO:%', v_pos;
        end if;
        v_price_cents := v_raw::integer;
        if v_price_cents not between 1 and 10000000 then
          raise exception 'SESSAO_PRECO:%', v_pos;
        end if;
      end if;
      if v_on_sale and v_price_cents is null then
        raise exception 'SESSAO_PRECO:%', v_pos;
      end if;

      v_max := null;
      if v_price -> 'max_units' is not null and jsonb_typeof(v_price -> 'max_units') <> 'null' then
        v_raw := v_price ->> 'max_units';
        if jsonb_typeof(v_price -> 'max_units') <> 'number' or v_raw !~ '^[0-9]{1,6}$' then
          raise exception 'SESSAO_INVALIDA:%', v_pos;
        end if;
        v_max := v_raw::integer;
        if v_max not between 1 and 100000 then
          raise exception 'SESSAO_INVALIDA:%', v_pos;
        end if;
        if v_id is not null then
          v_taken := public.session_type_units_taken(v_id, v_type_id);
          if v_max < v_taken then
            raise exception 'SESSAO_LIMITE_MENOR:%:%:%', v_pos, v_taken, v_type_names[v_type_index + 1];
          end if;
        end if;
      end if;

      if v_on_sale then
        v_on_sale_count := v_on_sale_count + 1;
      end if;
    end loop;
    if v_on_sale_count = 0 then
      raise exception 'SESSAO_SEM_TIPO:%', v_pos;
    end if;

    v_ids := v_ids || v_id;
    v_prev_starts := v_prev_starts || case when v_id is null then null else v_existing.starts_at end;
    v_prev_ends := v_prev_ends || case when v_id is null then null else v_existing.ends_at end;
    v_names := v_names || v_name;
    v_starts := v_starts || v_start;
    v_ends := v_ends || v_end;
    v_capacities := v_capacities || v_capacity;
    v_inteiras := v_inteiras || v_inteira;
    v_meias := v_meias || v_meia;
  end loop;

  -- 4.2) Sessões ativas que saíram da lista: apagar, arquivar ou recusar.
  for v_session in
    select * from public.event_sessions s
    where s.event_id = p_event_id
      and s.archived_at is null
      and s.status = 'ativa'
      and not (s.id = any(array_remove(v_ids, null)))
    order by s.id
  loop
    if public.session_has_live_orders(v_session.id) then
      raise exception 'SESSAO_COM_VENDAS:%', v_session.id;
    elsif exists (select 1 from public.orders o where o.session_id = v_session.id) then
      update public.event_sessions s
      set archived_at = now(), sales_open = false, updated_at = now()
      where s.id = v_session.id;
    else
      delete from public.event_sessions s where s.id = v_session.id;
    end if;
  end loop;

  -- 4.3) Horário provisório nas sessões mantidas: permite trocar horários entre
  -- sessões (19h ↔ 20h30) sem esbarrar no índice único de horário por evento.
  update public.event_sessions s
  set starts_at = timestamptz '1900-01-01 00:00:00+00' + make_interval(mins => x.n),
      ends_at = null
  from (
    select u.id, row_number() over (order by u.id)::integer as n
    from unnest(array_remove(v_ids, null)) as u(id)
  ) x
  where s.id = x.id;

  -- 4.4) Grava cada sessão e os seus preços.
  v_pos := 0;
  for v_item in select e.item from jsonb_array_elements(p_sessions) as e(item) loop
    v_pos := v_pos + 1;
    v_id := v_ids[v_pos];

    if v_id is null then
      insert into public.event_sessions (
        event_id, name, starts_at, ends_at, capacity, inteira_quota, meia_quota
      ) values (
        p_event_id, v_names[v_pos], v_starts[v_pos], v_ends[v_pos],
        v_capacities[v_pos], v_inteiras[v_pos], v_meias[v_pos]
      )
      returning id into v_id;
    else
      -- Mudou o horário de sessão com pedidos pagos: registro para o aviso (fase 5).
      if (v_prev_starts[v_pos], v_prev_ends[v_pos]) is distinct from (v_starts[v_pos], v_ends[v_pos]) then
        select count(*)::integer into v_paid
        from public.orders o
        where o.session_id = v_id
          and o.status = 'pago'
          and exists (
            select 1 from public.tickets t
            where t.order_id = o.id and t.status in ('pago', 'check_in')
          );
        if v_paid > 0 then
          insert into public.session_schedule_changes (
            session_id, previous_starts_at, previous_ends_at, new_starts_at, new_ends_at,
            paid_orders, changed_by
          ) values (
            v_id, v_prev_starts[v_pos], v_prev_ends[v_pos], v_starts[v_pos], v_ends[v_pos],
            v_paid, p_staff_user_id
          );
        end if;
      end if;

      update public.event_sessions s
      set name = v_names[v_pos],
          starts_at = v_starts[v_pos],
          ends_at = v_ends[v_pos],
          capacity = v_capacities[v_pos],
          inteira_quota = v_inteiras[v_pos],
          meia_quota = v_meias[v_pos],
          updated_at = now()
      where s.id = v_id;
    end if;

    for v_price in select e.item from jsonb_array_elements(v_item -> 'prices') as e(item) loop
      v_type_id := v_type_ids[(v_price ->> 'type_index')::integer + 1];
      v_on_sale := (v_price ->> 'on_sale')::boolean;
      v_price_cents := nullif(v_price ->> 'price_cents', '')::integer;
      v_max := nullif(v_price ->> 'max_units', '')::integer;
      if v_price_cents is null then
        -- Fora da venda e sem preço: a linha antiga (se houver) só sai da venda.
        update public.session_ticket_types stt
        set on_sale = false, max_units = v_max, updated_at = now()
        where stt.session_id = v_id and stt.ticket_type_id = v_type_id;
      else
        insert into public.session_ticket_types as stt (
          session_id, ticket_type_id, price_cents, max_units, on_sale
        ) values (v_id, v_type_id, v_price_cents, v_max, v_on_sale)
        on conflict (session_id, ticket_type_id) do update
          set price_cents = excluded.price_cents,
              max_units = excluded.max_units,
              on_sale = excluded.on_sale,
              updated_at = now();
      end if;
    end loop;

    -- Tipo do evento que não veio na lista desta sessão: fora da venda nela.
    update public.session_ticket_types stt
    set on_sale = false, updated_at = now()
    where stt.session_id = v_id
      and stt.on_sale
      and stt.ticket_type_id = any(v_type_ids)
      and not exists (
        select 1 from jsonb_array_elements(v_item -> 'prices') as e(item)
        where v_type_ids[(e.item ->> 'type_index')::integer + 1] = stt.ticket_type_id
      );
  end loop;
end;
$$;

-- Evento, tipos e sessões mudam juntos ou não mudam. Dono: nada em análise, lotação
-- até organizer_max_capacity() e, depois de aprovado, só o que a seção 6.4 do spec
-- deixa mudar na hora (o resto é ORG_ESTADO:mudanca:<campos>). O dono nunca mexe em
-- sales_open por aqui.
create or replace function public.save_event_with_sessions(
  p_event_id uuid,
  p_name text,
  p_venue text,
  p_description text,
  p_cover_image_url text,
  p_ticket_types jsonb,
  p_sessions jsonb,
  p_staff_user_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_first public.event_sessions%rowtype;
  v_access text;
  v_event public.events%rowtype;
  v_violations text[];
  v_sessions_before jsonb;
  v_sessions_after jsonb;
  v_fields text[] := '{}';
begin
  v_access := public.actor_event_access(p_staff_user_id, p_event_id);
  if v_access is null then
    if p_staff_user_id is not null
      and exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id) then
      raise exception 'SESSAO_EVENTO: Evento não encontrado.';
    end if;
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  perform 1 from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'SESSAO_EVENTO: Evento não encontrado.';
  end if;

  if v_access = 'dono' then
    select * into v_event from public.events e where e.id = p_event_id;
    if v_event.approval_status = 'em_analise' then
      raise exception 'ORG_ESTADO:em_analise';
    end if;
    if jsonb_typeof(p_sessions) = 'array' and exists (
      select 1 from jsonb_array_elements(p_sessions) as e(item)
      where case
        when jsonb_typeof(e.item -> 'capacity') = 'number' and (e.item ->> 'capacity') ~ '^[0-9]{1,6}$'
          then (e.item ->> 'capacity')::integer
      end > public.organizer_max_capacity()
    ) then
      raise exception 'ORG_LOTACAO:%', public.organizer_max_capacity();
    end if;
    if v_event.approval_status = 'aprovado' then
      select coalesce(jsonb_agg(jsonb_build_array(
        s.id, s.name, s.starts_at, s.ends_at, s.capacity, s.inteira_quota, s.meia_quota,
        s.status, s.archived_at,
        (select coalesce(jsonb_agg(jsonb_build_array(stt.ticket_type_id, stt.price_cents, stt.max_units, stt.on_sale)
                order by stt.ticket_type_id), '[]'::jsonb)
         from public.session_ticket_types stt where stt.session_id = s.id)
      ) order by s.id), '[]'::jsonb)
      into v_sessions_before
      from public.event_sessions s
      where s.event_id = p_event_id;
    end if;
  end if;

  perform set_config('byla.session_editor', 'on', true);

  perform public.save_event_ticket_types(p_event_id, p_ticket_types);
  if v_access = 'dono' and v_event.approval_status = 'aprovado' then
    v_violations := public.organizer_change_violations(p_event_id, p_name, p_venue, p_sessions);
    if cardinality(v_violations) > 0 then
      raise exception 'ORG_ESTADO:mudanca:%', array_to_string(v_violations, ',');
    end if;
  end if;
  perform public.save_event_sessions(p_event_id, p_sessions, p_staff_user_id);

  select * into v_first
  from public.event_sessions s
  where s.event_id = p_event_id and s.archived_at is null and s.status = 'ativa'
  order by s.starts_at, s.id
  limit 1;

  update public.events e
  set name = case when v_access = 'dono' then btrim(p_name) else p_name end,
      venue = case when v_access = 'dono' then btrim(p_venue) else p_venue end,
      description = p_description,
      cover_image_url = p_cover_image_url,
      starts_at = v_first.starts_at,
      capacity = v_first.capacity,
      inteira_quota = v_first.inteira_quota,
      meia_quota = v_first.meia_quota,
      updated_at = now()
  where e.id = p_event_id;

  perform set_config('byla.session_editor', '', true);

  if v_access = 'dono' and v_event.approval_status = 'aprovado' then
    if p_description is distinct from v_event.description then
      v_fields := array_append(v_fields, 'descricao');
    end if;
    if p_cover_image_url is distinct from v_event.cover_image_url then
      v_fields := array_append(v_fields, 'capa');
    end if;
    select coalesce(jsonb_agg(jsonb_build_array(
      s.id, s.name, s.starts_at, s.ends_at, s.capacity, s.inteira_quota, s.meia_quota,
      s.status, s.archived_at,
      (select coalesce(jsonb_agg(jsonb_build_array(stt.ticket_type_id, stt.price_cents, stt.max_units, stt.on_sale)
              order by stt.ticket_type_id), '[]'::jsonb)
       from public.session_ticket_types stt where stt.session_id = s.id)
    ) order by s.id), '[]'::jsonb)
    into v_sessions_after
    from public.event_sessions s
    where s.event_id = p_event_id;
    if v_sessions_after is distinct from v_sessions_before then
      v_fields := array_append(v_fields, 'sessoes');
    end if;
    if cardinality(v_fields) > 0 then
      perform public.log_audit(
        p_staff_user_id, 'evento_alterado_pos_aprovacao', p_event_id, null, p_staff_user_id,
        jsonb_build_object('campos', to_jsonb(v_fields))
      );
    end if;
  end if;
end;
$$;

-- Reabrir depois do horário não faz voltar a vender (session_is_selling manda).
-- Trava na ordem evento → sessão. Devolve o novo valor. Dono: só evento aprovado e,
-- para abrir, sem pedido de exclusão pendente.
create or replace function public.set_session_sales_open(
  p_session_id uuid,
  p_open boolean,
  p_staff_user_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_session public.event_sessions%rowtype;
  v_access text;
  v_approval text;
  v_changed integer;
begin
  select s.event_id into v_event_id from public.event_sessions s where s.id = p_session_id;
  v_access := public.actor_event_access(p_staff_user_id, v_event_id);
  if v_access is null and (
    p_staff_user_id is null
    or not exists (select 1 from public.staff_profiles sp where sp.user_id = p_staff_user_id)
  ) then
    raise exception 'SESSAO_EQUIPE: Acesso negado.';
  end if;
  if p_open is null then
    raise exception 'SESSAO_INVALIDA: Valor inválido.';
  end if;
  if v_event_id is null then
    raise exception 'SESSAO_INDISPONIVEL: Sessão não encontrada.';
  end if;
  select e.approval_status into v_approval from public.events e where e.id = v_event_id for share;
  select * into v_session from public.event_sessions s where s.id = p_session_id for update;
  if v_session.archived_at is not null or v_session.status <> 'ativa' then
    raise exception 'SESSAO_INDISPONIVEL: Sessão não encontrada.';
  end if;
  if v_access = 'dono' then
    if v_approval <> 'aprovado' then
      raise exception 'ORG_ESTADO:nao_aprovado';
    end if;
    if p_open and public.event_deletion_pending(v_event_id) then
      raise exception 'ORG_ESTADO:exclusao_pendente';
    end if;
  end if;
  update public.event_sessions s
  set sales_open = p_open, updated_at = now()
  where s.id = p_session_id and s.sales_open is distinct from p_open;
  get diagnostics v_changed = row_count;
  if v_access = 'dono' and v_changed > 0 then
    perform public.log_audit(
      p_staff_user_id,
      case when p_open then 'vendas_abertas' else 'vendas_pausadas' end,
      v_event_id, null, p_staff_user_id,
      jsonb_build_object('session_id', p_session_id)
    );
  end if;
  return p_open;
end;
$$;

-- Passado = publicado, não escondido, não excluído, com sessão ativa, a partir do dia
-- seguinte (Brasília) ao fim da última sessão. public_past_events herda.
create or replace function public.event_is_past(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.deleted_at is null
      and e.published_at is not null
      and not e.hidden_from_past
      and exists (
        select 1 from public.event_sessions s
        where s.event_id = e.id and s.status = 'ativa' and s.archived_at is null
      )
      and (now() at time zone 'America/Sao_Paulo')::date >= public.event_fee_due_date(e.id)
  );
$$;

-- Mesma sequência do createEvent da equipe (inserir o evento, depois
-- save_event_with_sessions), para os gatilhos de sessão se comportarem igual. O resumo
-- gravado aqui é provisório: save_event_with_sessions grava o da primeira sessão ativa.
create function public.create_organizer_event(
  p_actor uuid,
  p_slug text,
  p_name text,
  p_venue text,
  p_description text,
  p_cover_image_url text,
  p_ticket_types jsonb,
  p_sessions jsonb
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_starts timestamptz;
  v_capacity integer;
begin
  if not public.organizer_is_active(p_actor) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_slug is null or char_length(p_slug) > 200 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_venue, '')) = '' then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array'
     or jsonb_array_length(p_sessions) not between 1 and 20 then
    raise exception 'SESSAO_QUANTIDADE: Cadastre de 1 a 20 sessões.';
  end if;

  begin
    select (e.item ->> 'starts_at')::timestamptz, (e.item ->> 'capacity')::integer
    into v_starts, v_capacity
    from jsonb_array_elements(p_sessions) as e(item)
    order by (e.item ->> 'starts_at')::timestamptz
    limit 1;
  exception when data_exception then
    v_starts := null;
  end;
  -- Sessão malformada: resumo neutro; save_event_with_sessions devolve o erro exato.
  if v_starts is null or v_capacity is null or v_capacity < 1 then
    v_starts := now();
    v_capacity := 1;
  end if;

  perform set_config('byla.organizer_flow', 'on', true);
  begin
    insert into public.events (
      slug, name, venue, description, cover_image_url, starts_at, capacity, sales_open,
      organizer_id, approval_status
    ) values (
      p_slug, btrim(p_name), btrim(p_venue), coalesce(p_description, ''), p_cover_image_url, v_starts, v_capacity, false,
      p_actor, 'rascunho'
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ORG_DADOS:slug';
  end;
  perform set_config('byla.organizer_flow', '', true);

  perform public.save_event_with_sessions(
    v_id, btrim(p_name), btrim(p_venue), p_description, p_cover_image_url, p_ticket_types, p_sessions, p_actor
  );

  perform public.log_audit(p_actor, 'evento_criado', v_id, null, p_actor, '{}'::jsonb);
  return v_id;
end;
$$;

-- Critérios para enviar e para aprovar (o evento pode ter mudado de situação entre um e
-- outro: sessão que já passou, limite de lotação reduzido). Nulo = tudo certo; senão o
-- erro exato (ORG_ESTADO:capa, ORG_ESTADO:sem_sessao_futura, ORG_LOTACAO:<max>,
-- ORG_ESTADO:sem_preco), nesta ordem.
create function public.organizer_submission_problem(p_event_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_cover text;
  v_max integer := public.organizer_max_capacity();
begin
  select e.cover_image_url into v_cover from public.events e where e.id = p_event_id;
  if nullif(btrim(coalesce(v_cover, '')), '') is null then
    return 'ORG_ESTADO:capa';
  end if;
  if not exists (
    select 1 from public.event_sessions s
    where s.event_id = p_event_id and s.status = 'ativa' and s.archived_at is null
      and s.starts_at > now()
  ) then
    return 'ORG_ESTADO:sem_sessao_futura';
  end if;
  if exists (
    select 1 from public.event_sessions s
    where s.event_id = p_event_id and s.status = 'ativa' and s.archived_at is null
      and s.capacity > v_max
  ) then
    return 'ORG_LOTACAO:' || v_max;
  end if;
  if exists (
    select 1 from public.event_sessions s
    where s.event_id = p_event_id and s.status = 'ativa' and s.archived_at is null
      and not exists (
        select 1
        from public.session_ticket_types stt
        join public.ticket_types tt on tt.id = stt.ticket_type_id
        where stt.session_id = s.id and stt.on_sale
          and tt.archived_at is null and tt.active and tt.kind <> 'cortesia'
      )
  ) then
    return 'ORG_ESTADO:sem_preco';
  end if;
  return null;
end;
$$;

create function public.submit_event_for_approval(p_actor uuid, p_event_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_problem text;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento de outro organizador.';
  end if;
  select * into v_event from public.events e where e.id = p_event_id for update;
  if v_event.approval_status not in ('rascunho', 'recusado') then
    raise exception 'ORG_ESTADO:estado';
  end if;
  v_problem := public.organizer_submission_problem(p_event_id);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  perform set_config('byla.organizer_flow', 'on', true);
  update public.events e
  set approval_status = 'em_analise', submitted_at = now(), approval_note = null, updated_at = now()
  where e.id = p_event_id;
  perform set_config('byla.organizer_flow', '', true);

  perform public.log_audit(p_actor, 'evento_enviado', p_event_id, null, p_actor, '{}'::jsonb);
end;
$$;

create function public.withdraw_event_submission(p_actor uuid, p_event_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_status text;
begin
  if public.actor_event_access(p_actor, p_event_id) is distinct from 'dono' then
    raise exception 'ORG_DONO: Evento de outro organizador.';
  end if;
  select e.approval_status into v_status from public.events e where e.id = p_event_id for update;
  if v_status is distinct from 'em_analise' then
    raise exception 'ORG_ESTADO:estado';
  end if;

  perform set_config('byla.organizer_flow', 'on', true);
  update public.events e
  set approval_status = 'rascunho', submitted_at = null, updated_at = now()
  where e.id = p_event_id;
  perform set_config('byla.organizer_flow', '', true);

  perform public.log_audit(p_actor, 'evento_envio_desfeito', p_event_id, null, p_actor, '{}'::jsonb);
end;
$$;

create function public.decide_event_approval(
  p_admin uuid,
  p_event_id uuid,
  p_decision text,
  p_publish boolean,
  p_note text
)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_publish boolean := coalesce(p_publish, false);
  v_problem text;
begin
  if not public.staff_is_admin(p_admin) then
    raise exception 'ORG_ACESSO: Acesso negado.';
  end if;
  if p_decision is null or p_decision not in ('aprovar', 'recusar') then
    raise exception 'ORG_DADOS: Decisão inválida.';
  end if;
  select * into v_event from public.events e where e.id = p_event_id for update;
  if not found or v_event.organizer_id is null or v_event.approval_status <> 'em_analise'
     or v_event.deleted_at is not null then
    raise exception 'ORG_ESTADO:estado';
  end if;

  if p_decision = 'aprovar' then
    if not public.organizer_is_active(v_event.organizer_id) then
      raise exception 'ORG_ESTADO:organizador_inativo';
    end if;
    v_problem := public.organizer_submission_problem(p_event_id);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    perform set_config('byla.organizer_flow', 'on', true);
    update public.events e
    set approval_status = 'aprovado',
        sales_open = v_publish,
        approval_decided_by = p_admin,
        approval_decided_at = now(),
        approval_note = null,
        updated_at = now()
    where e.id = p_event_id;
    perform set_config('byla.organizer_flow', '', true);
    perform public.log_audit(
      p_admin, 'evento_aprovado', p_event_id, null, v_event.organizer_id,
      jsonb_build_object('publicado', v_publish)
    );
  else
    if v_note is null or char_length(v_note) not between 5 and 500 then
      raise exception 'ORG_DADOS: Motivo da recusa obrigatório (5 a 500 caracteres).';
    end if;
    perform set_config('byla.organizer_flow', 'on', true);
    update public.events e
    set approval_status = 'recusado',
        sales_open = false,
        approval_decided_by = p_admin,
        approval_decided_at = now(),
        approval_note = v_note,
        updated_at = now()
    where e.id = p_event_id;
    perform set_config('byla.organizer_flow', '', true);
    perform public.log_audit(p_admin, 'evento_recusado', p_event_id, null, v_event.organizer_id, '{}'::jsonb);
  end if;
end;
$$;

-- "Produção: <nome público>" na página do evento: só de evento visível ao público.
create function public.public_event_producer(p_event_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select op.public_name
  from public.events e
  join public.organizer_profiles op on op.user_id = e.organizer_id
  where e.id = p_event_id
    and e.deleted_at is null
    and (e.sales_open or public.event_is_past(e.id));
$$;

-- Para listas e e-mails do servidor (até 200 eventos por chamada).
create function public.event_producer_names(p_event_ids uuid[])
returns table (event_id uuid, public_name text)
language sql stable security definer set search_path = '' as $$
  select e.id, op.public_name
  from public.events e
  join public.organizer_profiles op on op.user_id = e.organizer_id
  where e.id = any(coalesce(p_event_ids[1:200], '{}'::uuid[]));
$$;

-- Limpeza diária (cron keep-alive): convites vencidos, usados ou revogados há mais de
-- 30 dias e pedidos do site tratados há mais de 180 dias.
create function public.purge_organizer_records()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_total integer := 0;
  v_count integer;
begin
  delete from public.organizer_invites i
  where i.expires_at < now() - interval '30 days'
     or i.used_at < now() - interval '30 days'
     or i.revoked_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  delete from public.organizer_signup_requests r
  where r.status in ('convidada', 'arquivada')
    and r.handled_at < now() - interval '180 days';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

-- 7) Leitura pública e do dono (mantendo o resto igual ao que está no ar) ------------

alter policy events_public_read on public.events
  using (
    (deleted_at is null and (sales_open = true or public.event_is_past(id)))
    or public.is_staff()
    or public.owns_event(id)
  );

alter policy event_images_public_read on public.event_images
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.deleted_at is null and (e.sales_open = true or public.event_is_past(e.id))
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );

alter policy event_sessions_public_read on public.event_sessions
  using (
    (
      archived_at is null
      and exists (
        select 1 from public.events e
        where e.id = event_id and e.deleted_at is null and (e.sales_open = true or public.event_is_past(e.id))
      )
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );

alter policy ticket_types_public_read on public.ticket_types
  using (
    (
      kind <> 'cortesia' and archived_at is null and active
      and exists (select 1 from public.events e where e.id = event_id and e.sales_open = true and e.deleted_at is null)
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );

alter policy session_ticket_types_public_read on public.session_ticket_types
  using (
    (
      on_sale and exists (
        select 1
        from public.event_sessions s
        join public.events e on e.id = s.event_id
        join public.ticket_types tt on tt.id = session_ticket_types.ticket_type_id
        where s.id = session_ticket_types.session_id and s.archived_at is null
          and e.sales_open = true and e.deleted_at is null
          and tt.archived_at is null and tt.kind <> 'cortesia'
      )
    )
    or public.is_staff()
    or exists (
      select 1 from public.event_sessions s
      where s.id = session_ticket_types.session_id and public.owns_event(s.event_id)
    )
  );

-- 8) Permissões ----------------------------------------------------------------------

revoke all on function public.organizer_area_enabled() from public, anon, authenticated;
revoke all on function public.organizer_is_active(uuid) from public, anon, authenticated, service_role;
revoke all on function public.login_code_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function public.my_account_kind() from public, anon, authenticated;
revoke all on function public.is_organizer() from public, anon, authenticated;
revoke all on function public.owns_event(uuid) from public, anon, authenticated;
revoke all on function public.actor_event_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.staff_is_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function public.organizer_max_capacity() from public, anon, authenticated;
revoke all on function public.event_deletion_pending(uuid) from public, anon, authenticated;
revoke all on function public.forbid_staff_and_organizer() from public, anon, authenticated, service_role;
revoke all on function public.log_audit(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.valid_tax_document(text) from public, anon, authenticated;
revoke all on function public.events_guard_organizer() from public, anon, authenticated, service_role;
revoke all on function public.create_organizer_invite(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_organizer_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_organizer_invites(uuid) from public, anon, authenticated;
revoke all on function public.check_organizer_invite(text) from public, anon, authenticated;
revoke all on function public.start_invite_email_code(text, text, text) from public, anon, authenticated;
revoke all on function public.verify_invite_email_code(text, text) from public, anon, authenticated;
revoke all on function public.invite_verified_email(text) from public, anon, authenticated;
revoke all on function public.accept_organizer_invite(text, uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.use_password_reset_invite(text) from public, anon, authenticated;
revoke all on function public.submit_signup_request(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.list_signup_requests(uuid, text) from public, anon, authenticated;
revoke all on function public.archive_signup_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_organizers(uuid) from public, anon, authenticated;
revoke all on function public.set_organizer_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_my_devices(text) from public, anon, authenticated;
revoke all on function public.forget_my_device(uuid) from public, anon, authenticated;
revoke all on function public.admin_forget_devices(uuid, uuid) from public, anon, authenticated;
revoke all on function public.staff_security_overview(uuid) from public, anon, authenticated;
revoke all on function public.organizer_change_violations(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.save_event_sessions(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.save_event_with_sessions(uuid, text, text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.set_session_sales_open(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.event_is_past(uuid) from public, anon, authenticated;
revoke all on function public.create_organizer_event(uuid, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.organizer_submission_problem(uuid) from public, anon, authenticated, service_role;
revoke all on function public.submit_event_for_approval(uuid, uuid) from public, anon, authenticated;
revoke all on function public.withdraw_event_submission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_event_approval(uuid, uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.public_event_producer(uuid) from public, anon, authenticated;
revoke all on function public.event_producer_names(uuid[]) from public, anon, authenticated;
revoke all on function public.purge_organizer_records() from public, anon, authenticated;

-- Usadas em políticas RLS e na página pública (só devolvem verdadeiro/falso ou o nome público).
grant execute on function public.organizer_area_enabled() to anon, authenticated, service_role;
grant execute on function public.is_organizer() to anon, authenticated;
grant execute on function public.owns_event(uuid) to anon, authenticated;
grant execute on function public.public_event_producer(uuid) to anon, authenticated;
grant execute on function public.event_is_past(uuid) to anon, authenticated;

-- Com a sessão do próprio usuário.
grant execute on function public.my_account_kind() to authenticated;
grant execute on function public.list_my_devices(text) to authenticated;
grant execute on function public.forget_my_device(uuid) to authenticated;

-- Só o servidor (inclusive auxiliares chamados por funções security invoker).
grant execute on function public.actor_event_access(uuid, uuid) to service_role;
grant execute on function public.organizer_max_capacity() to service_role;
grant execute on function public.event_deletion_pending(uuid) to service_role;
grant execute on function public.log_audit(uuid, text, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.valid_tax_document(text) to service_role;
grant execute on function public.create_organizer_invite(uuid, text, text, text, uuid, uuid) to service_role;
grant execute on function public.revoke_organizer_invite(uuid, uuid) to service_role;
grant execute on function public.list_organizer_invites(uuid) to service_role;
grant execute on function public.check_organizer_invite(text) to service_role;
grant execute on function public.start_invite_email_code(text, text, text) to service_role;
grant execute on function public.verify_invite_email_code(text, text) to service_role;
grant execute on function public.invite_verified_email(text) to service_role;
grant execute on function public.accept_organizer_invite(text, uuid, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.use_password_reset_invite(text) to service_role;
grant execute on function public.submit_signup_request(text, text, text, text, text) to service_role;
grant execute on function public.list_signup_requests(uuid, text) to service_role;
grant execute on function public.archive_signup_request(uuid, uuid) to service_role;
grant execute on function public.list_organizers(uuid) to service_role;
grant execute on function public.set_organizer_status(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_forget_devices(uuid, uuid) to service_role;
grant execute on function public.staff_security_overview(uuid) to service_role;
grant execute on function public.organizer_change_violations(uuid, text, text, jsonb) to service_role;
grant execute on function public.save_event_sessions(uuid, jsonb, uuid) to service_role;
grant execute on function public.save_event_with_sessions(uuid, text, text, text, text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.set_session_sales_open(uuid, boolean, uuid) to service_role;
grant execute on function public.create_organizer_event(uuid, text, text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.submit_event_for_approval(uuid, uuid) to service_role;
grant execute on function public.withdraw_event_submission(uuid, uuid) to service_role;
grant execute on function public.decide_event_approval(uuid, uuid, text, boolean, text) to service_role;
grant execute on function public.event_producer_names(uuid[]) to service_role;
grant execute on function public.purge_organizer_records() to service_role;
