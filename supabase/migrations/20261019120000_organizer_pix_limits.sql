-- Fase 3 (C): troca de chave PIX protegida, cota de códigos dos organizadores e
-- aviso de estorno ao organizador uma vez só.
-- Tudo só por função security definer; nenhuma tabela é lida direto pelo app.

-- 1) Tabelas ------------------------------------------------------------------------

create table public.organizer_action_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('pix_change')),
  code_salt text not null,
  code_hash text not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index organizer_action_codes_user_idx on public.organizer_action_codes (user_id, purpose, created_at desc);
alter table public.organizer_action_codes enable row level security;
revoke all on table public.organizer_action_codes from public, anon, authenticated, service_role;

create table public.organizer_pix_change_requests (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizer_profiles (user_id),
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_key text not null check (char_length(pix_key) between 1 and 77),
  pix_holder_name text not null check (char_length(btrim(pix_holder_name)) between 2 and 120),
  pix_holder_document text not null check (pix_holder_document ~ '^([0-9]{11}|[0-9]{14})$'),
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'recusada', 'cancelada')),
  confirm_after timestamptz not null,
  decided_by uuid,
  decided_by_name text,
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 5 and 500),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organizer_pix_change_one_pending
  on public.organizer_pix_change_requests (organizer_id) where status = 'pendente';
create index organizer_pix_change_recent_idx on public.organizer_pix_change_requests (created_at desc);
alter table public.organizer_pix_change_requests enable row level security;
revoke all on table public.organizer_pix_change_requests from public, anon, authenticated, service_role;

-- Um aviso de estorno por pedido, venha de pedido do organizador ou da equipe.
create table public.organizer_refund_notices (
  order_id uuid primary key references public.orders (id) on delete cascade,
  notified_at timestamptz not null default now()
);
alter table public.organizer_refund_notices enable row level security;
revoke all on table public.organizer_refund_notices from public, anon, authenticated, service_role;

alter table public.organizer_ops_requests add column organizer_notified_at timestamptz;

-- 2) Regras dos dados do PIX (cadastro e troca) ------------------------------------------

-- Devolve null quando está tudo certo, senão o campo com problema (sem o valor).
-- Formatos iguais aos do app (src/lib/organizer/validation.ts).
create function public.pix_details_problem(p_type text, p_key text, p_holder text, p_doc text)
returns text language sql immutable security definer set search_path = '' as $$
  select case
    when p_holder is null or char_length(btrim(p_holder)) not between 2 and 120 then 'titular'
    when not public.valid_tax_document(p_doc) then 'documento'
    when p_type is null or p_type not in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') then 'tipo'
    when p_key is null or char_length(p_key) not between 1 and 77 then 'chave'
    when p_type = 'cpf' and (char_length(p_doc) <> 11 or p_key <> p_doc) then 'chave'
    when p_type = 'cnpj' and (char_length(p_doc) <> 14 or p_key <> p_doc) then 'chave'
    when p_type = 'email' and p_key !~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,189}\.[^@[:space:]]{2,}$' then 'chave'
    when p_type = 'email' and p_key <> lower(p_key) then 'chave'
    when p_type = 'telefone' and p_key !~ '^\+55[0-9]{10,11}$' then 'chave'
    when p_type = 'aleatoria'
      and p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'chave'
  end;
$$;

-- Mesmo corpo da fase 2, com as checagens do PIX vindas de pix_details_problem.
create or replace function public.accept_organizer_invite(
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
     or public.pix_details_problem(p_pix_key_type, btrim(p_pix_key), p_pix_holder_name, p_pix_holder_document) is not null then
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

-- 3) Código por e-mail para ações sensíveis do organizador -------------------------------

-- O servidor gera o código (gerador criptográfico) e manda por e-mail só se vier 'ok'.
-- 'ok' | 'aguarde' (60 s) | 'limite' (3 por conta e 10 no site por dia).
create function public.issue_organizer_action_code(p_actor uuid, p_purpose text, p_code text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_key text;
  v_salt text;
begin
  if not public.organizer_is_active(p_actor) then
    raise exception 'ORG_ACESSO: Conta sem acesso.';
  end if;
  if p_purpose is distinct from 'pix_change' or p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('org-action-code:' || p_actor::text, 0));

  if exists (
    select 1 from public.organizer_action_codes c
    where c.user_id = p_actor and c.purpose = p_purpose and c.created_at > now() - interval '60 seconds'
  ) then
    return 'aguarde';
  end if;

  v_key := encode(sha256(convert_to('byla-rate-limit:' || p_actor::text, 'UTF8')), 'hex');
  if not public.consume_rate_limit('pix-code:user-day', v_key, 3, 86400) then
    return 'limite';
  end if;
  if not public.consume_rate_limit('pix-code:all-day', 'site', 10, 86400) then
    return 'limite';
  end if;

  update public.organizer_action_codes c
  set used_at = now()
  where c.user_id = p_actor and c.purpose = p_purpose and c.used_at is null;

  v_salt := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.organizer_action_codes (user_id, purpose, code_salt, code_hash, expires_at)
  values (
    p_actor, p_purpose, v_salt,
    encode(sha256(convert_to(v_salt || ':' || p_code, 'UTF8')), 'hex'),
    now() + interval '10 minutes'
  );
  return 'ok';
end;
$$;

-- 4) Troca de chave PIX -------------------------------------------------------------------

create or replace function public.organizer_pix_change_pending(p_organizer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizer_pix_change_requests r
    where r.organizer_id = p_organizer_id and r.status = 'pendente'
  );
$$;

-- Erros de dados levantam exceção (nada é gravado). Erros do código voltam como status
-- para que a tentativa errada fique gravada:
-- {status:'ok', request_id, confirm_after} | {status:'invalido'|'bloqueado'|'expirado'}.
create function public.request_pix_change(
  p_actor uuid, p_code text, p_pix_key_type text, p_pix_key text, p_holder_name text, p_holder_document text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_profile public.organizer_profiles%rowtype;
  v_code public.organizer_action_codes%rowtype;
  v_key text := btrim(coalesce(p_pix_key, ''));
  v_holder text := btrim(coalesce(p_holder_name, ''));
  v_id uuid;
  v_after timestamptz;
begin
  if not public.organizer_is_active(p_actor) then
    raise exception 'ORG_ACESSO: Conta sem acesso.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('org-action-code:' || p_actor::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || p_actor::text, 0));

  if public.pix_details_problem(p_pix_key_type, v_key, v_holder, p_holder_document) is not null then
    raise exception 'ORG_DADOS: Dados inválidos.';
  end if;
  select * into v_profile from public.organizer_profiles op where op.user_id = p_actor;
  if (v_profile.pix_key_type, v_profile.pix_key, lower(v_profile.pix_holder_name), v_profile.pix_holder_document)
     is not distinct from (p_pix_key_type, v_key, lower(v_holder), p_holder_document) then
    raise exception 'ORG_PIX_IGUAL: A chave informada é a atual.';
  end if;
  if public.organizer_pix_change_pending(p_actor) then
    raise exception 'ORG_PIX_PENDENTE: Já existe uma troca de chave em análise.';
  end if;

  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('status', 'invalido');
  end if;
  select * into v_code from public.organizer_action_codes c
  where c.user_id = p_actor and c.purpose = 'pix_change' and c.used_at is null
  order by c.created_at desc limit 1
  for update;
  if v_code.id is null or v_code.expires_at <= now() then
    return jsonb_build_object('status', 'expirado');
  end if;
  if v_code.code_hash <> encode(sha256(convert_to(v_code.code_salt || ':' || p_code, 'UTF8')), 'hex') then
    update public.organizer_action_codes c
    set attempts = c.attempts + 1,
        used_at = case when c.attempts + 1 >= 5 then now() end
    where c.id = v_code.id;
    return jsonb_build_object('status', case when v_code.attempts + 1 >= 5 then 'bloqueado' else 'invalido' end);
  end if;
  update public.organizer_action_codes c set used_at = now() where c.id = v_code.id;

  insert into public.organizer_pix_change_requests (
    organizer_id, pix_key_type, pix_key, pix_holder_name, pix_holder_document, confirm_after
  ) values (
    p_actor, p_pix_key_type, v_key, v_holder, p_holder_document, now() + interval '24 hours'
  ) returning id, confirm_after into v_id, v_after;

  perform public.log_audit(p_actor, 'pix_troca_pedida', null, null, p_actor, '{}'::jsonb);
  return jsonb_build_object('status', 'ok', 'request_id', v_id, 'confirm_after', v_after);
end;
$$;

create function public.cancel_pix_change(p_actor uuid, p_request_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.organizer_pix_change_requests%rowtype;
begin
  if not public.organizer_is_active(p_actor) then
    raise exception 'ORG_ACESSO: Conta sem acesso.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || p_actor::text, 0));
  select * into v_req from public.organizer_pix_change_requests r where r.id = p_request_id for update;
  if v_req.id is null or v_req.organizer_id <> p_actor then
    raise exception 'ORG_ACESSO: Pedido não encontrado.';
  end if;
  if v_req.status <> 'pendente' then
    raise exception 'ORG_ESTADO: Pedido já decidido.';
  end if;
  update public.organizer_pix_change_requests r
  set status = 'cancelada', decided_at = now()
  where r.id = v_req.id;
  perform public.log_audit(p_actor, 'pix_troca_cancelada', null, null, p_actor,
    jsonb_build_object('request_id', v_req.id));
end;
$$;

create function public.decide_pix_change(p_admin uuid, p_request_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.organizer_pix_change_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_organizer uuid;
begin
  perform public.assert_finance_admin(p_admin, true);
  select r.organizer_id into v_organizer from public.organizer_pix_change_requests r where r.id = p_request_id;
  if v_organizer is null then
    raise exception 'ORG_ESTADO: Pedido não encontrado.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0));
  select * into v_req from public.organizer_pix_change_requests r where r.id = p_request_id for update;
  if v_req.status <> 'pendente' or p_approve is null then
    raise exception 'ORG_ESTADO: Pedido já decidido.';
  end if;
  if v_note is not null and char_length(v_note) not between 5 and 500 then
    raise exception 'ORG_MOTIVO: Nota inválida (5 a 500 caracteres).';
  end if;

  if p_approve then
    if now() < v_req.confirm_after then
      raise exception 'ORG_ESPERA:%', to_char(v_req.confirm_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
    if public.pix_details_problem(v_req.pix_key_type, v_req.pix_key, v_req.pix_holder_name, v_req.pix_holder_document) is not null then
      raise exception 'ORG_DADOS: Dados inválidos.';
    end if;
    update public.organizer_profiles op
    set pix_key_type = v_req.pix_key_type,
        pix_key = v_req.pix_key,
        pix_holder_name = v_req.pix_holder_name,
        pix_holder_document = v_req.pix_holder_document,
        pix_key_changed_at = now(),
        updated_at = now()
    where op.user_id = v_req.organizer_id;
  elsif v_note is null then
    raise exception 'ORG_MOTIVO: Informe o motivo da recusa (5 a 500 caracteres).';
  end if;

  update public.organizer_pix_change_requests r
  set status = case when p_approve then 'confirmada' else 'recusada' end,
      decided_by = p_admin,
      decided_by_name = public.staff_display_name(p_admin),
      decision_note = v_note,
      decided_at = now()
  where r.id = v_req.id;

  perform public.log_audit(p_admin, case when p_approve then 'pix_troca_confirmada' else 'pix_troca_recusada' end,
    null, null, v_req.organizer_id, jsonb_build_object('request_id', v_req.id));
  return jsonb_build_object('organizer_id', v_req.organizer_id,
    'status', case when p_approve then 'confirmada' else 'recusada' end);
end;
$$;

-- Lista da equipe: pendentes e as últimas 20 decididas, sempre mascaradas.
create function public.list_pix_change_requests(p_admin uuid)
returns table (
  request_id uuid, organizer_id uuid, public_name text, status text,
  current_key_masked text, new_key_type text, new_key_masked text, new_document_masked text,
  confirm_after timestamptz, can_confirm boolean, created_at timestamptz,
  decided_at timestamptz, decided_by_name text, decision_note text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_finance_admin(p_admin, false);
  return query
  select r.id, r.organizer_id, op.public_name, r.status,
         public.mask_pix_key(op.pix_key_type, op.pix_key),
         r.pix_key_type, public.mask_pix_key(r.pix_key_type, r.pix_key), public.mask_tax_document(r.pix_holder_document),
         r.confirm_after, r.status = 'pendente' and now() >= r.confirm_after, r.created_at,
         r.decided_at, r.decided_by_name, r.decision_note
  from (
    (select * from public.organizer_pix_change_requests p where p.status = 'pendente')
    union all
    (select * from public.organizer_pix_change_requests d where d.status <> 'pendente'
     order by d.created_at desc limit 20)
  ) r
  join public.organizer_profiles op on op.user_id = r.organizer_id
  order by (r.status = 'pendente') desc, r.created_at desc;
end;
$$;

-- Completo, só para o diálogo de decisão (Admin que grava).
create function public.pix_change_details(p_admin uuid, p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_req public.organizer_pix_change_requests%rowtype;
  v_profile public.organizer_profiles%rowtype;
begin
  perform public.assert_finance_admin(p_admin, true);
  select * into v_req from public.organizer_pix_change_requests r where r.id = p_request_id;
  if v_req.id is null then
    raise exception 'ORG_ESTADO: Pedido não encontrado.';
  end if;
  select * into v_profile from public.organizer_profiles op where op.user_id = v_req.organizer_id;
  return jsonb_build_object(
    'request_id', v_req.id, 'organizer_id', v_req.organizer_id, 'public_name', v_profile.public_name,
    'status', v_req.status, 'confirm_after', v_req.confirm_after, 'created_at', v_req.created_at,
    'current', jsonb_build_object('pix_key_type', v_profile.pix_key_type, 'pix_key', v_profile.pix_key,
      'holder_name', v_profile.pix_holder_name, 'holder_document', v_profile.pix_holder_document,
      'changed_at', v_profile.pix_key_changed_at),
    'new', jsonb_build_object('pix_key_type', v_req.pix_key_type, 'pix_key', v_req.pix_key,
      'holder_name', v_req.pix_holder_name, 'holder_document', v_req.pix_holder_document));
end;
$$;

-- Tela do organizador: troca pendente (mascarada) e a última decisão.
create function public.organizer_pix_change_state(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pending public.organizer_pix_change_requests%rowtype;
  v_last public.organizer_pix_change_requests%rowtype;
begin
  if not public.organizer_is_active(p_actor) then
    raise exception 'ORG_ACESSO: Conta sem acesso.';
  end if;
  select * into v_pending from public.organizer_pix_change_requests r
  where r.organizer_id = p_actor and r.status = 'pendente';
  select * into v_last from public.organizer_pix_change_requests r
  where r.organizer_id = p_actor and r.status in ('confirmada', 'recusada')
  order by r.decided_at desc limit 1;
  return jsonb_build_object(
    'pending', v_pending.id is not null,
    'request_id', v_pending.id,
    'new_masked', case when v_pending.id is not null then public.mask_pix_key(v_pending.pix_key_type, v_pending.pix_key) end,
    'confirm_after', v_pending.confirm_after,
    'last_decision', case when v_last.id is not null then jsonb_build_object(
      'status', v_last.status, 'note', v_last.decision_note, 'decided_at', v_last.decided_at) end);
end;
$$;

-- 5) Repasse bloqueado com troca de chave pendente ------------------------------------------

create or replace function public.record_organizer_payout(
  p_admin uuid, p_event_id uuid, p_expected_amount_cents integer, p_pix_date date, p_note text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_event public.events%rowtype;
  v_profile public.organizer_profiles%rowtype;
  v_start date;
  v_preview jsonb;
  v_balance bigint;
  v_left bigint;
  v_kind text;
  v_payout_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_finance_admin(p_admin, true);
  select * into v_event from public.events e where e.id = p_event_id;
  if v_event.id is null or v_event.organizer_id is null then
    raise exception 'ORG_ACESSO: Evento sem organizador.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_event.organizer_id::text, 0));

  v_start := public.event_fee_due_date(p_event_id);
  if v_start is null or v_today < v_start then
    raise exception 'ORG_PRAZO: O repasse só pode ser registrado depois da última sessão.';
  end if;
  if v_note is not null and (char_length(v_note) > 140 or v_note ~ '[\r\n]') then
    raise exception 'ORG_NOTA: Nota inválida.';
  end if;

  v_preview := public.organizer_payout_preview(p_event_id);
  v_balance := (v_preview ->> 'balance_cents')::bigint;
  if v_balance <= 0 then
    if (v_preview ->> 'pending_fee_orders')::integer > 0 then
      raise exception 'ORG_TARIFA_PENDENTE:%', (v_preview ->> 'pending_fee_orders')::integer;
    end if;
    raise exception 'ORG_NADA: Nada a repassar neste evento.';
  end if;

  v_left := (v_preview ->> 'amount_cents')::bigint;
  if v_left is distinct from p_expected_amount_cents::bigint then
    raise exception 'ORG_MUDOU:%', v_left;
  end if;
  v_kind := v_preview ->> 'kind';
  -- Compensação não usa PIX; repasse espera a decisão da troca de chave.
  if v_kind = 'repasse' and public.organizer_pix_change_pending(v_event.organizer_id) then
    raise exception 'ORG_PIX_PENDENTE: Troca de chave PIX aguardando decisão.';
  end if;
  if v_kind = 'repasse' and (p_pix_date is null or p_pix_date > v_today or p_pix_date < v_start) then
    raise exception 'ORG_DATA: Data do PIX inválida.';
  end if;

  select * into v_profile from public.organizer_profiles op where op.user_id = v_event.organizer_id;
  insert into public.organizer_payouts (
    organizer_id, kind, amount_cents, pix_date, pix_key_type, pix_key_snapshot,
    pix_holder_name_snapshot, pix_holder_document_snapshot, pix_key_changed_at_snapshot,
    note, created_by, created_by_name
  ) values (
    v_event.organizer_id, v_kind, v_left::integer,
    case when v_kind = 'repasse' then p_pix_date end,
    case when v_kind = 'repasse' then v_profile.pix_key_type end,
    case when v_kind = 'repasse' then v_profile.pix_key end,
    case when v_kind = 'repasse' then v_profile.pix_holder_name end,
    case when v_kind = 'repasse' then v_profile.pix_holder_document end,
    case when v_kind = 'repasse' then v_profile.pix_key_changed_at end,
    v_note, p_admin, public.staff_display_name(p_admin)
  ) returning id into v_payout_id;

  insert into public.organizer_payout_items (payout_id, event_id, amount_cents)
  select v_payout_id, (i ->> 'event_id')::uuid, (i ->> 'amount_cents')::integer
  from jsonb_array_elements(v_preview -> 'items') i;

  perform public.resolve_balance_flags(v_event.organizer_id);
  perform public.log_audit(p_admin, case when v_kind = 'repasse' then 'repasse_registrado' else 'repasse_compensado' end,
    p_event_id, null, v_event.organizer_id,
    jsonb_build_object('amount_cents', v_left, 'discount_cents', v_balance - v_left));
  return jsonb_build_object('payout_id', v_payout_id, 'kind', v_kind, 'amount_cents', v_left,
    'discount_cents', v_balance - v_left, 'organizer_id', v_event.organizer_id);
end;
$$;

-- 6) Cota de códigos de login: equipe e organizadores separados ------------------------------

-- Mesmo corpo de 20261017100000; só a cota geral muda (equipe 40/dia, organizadores 20/dia).
create or replace function public.issue_login_code(p_user_id uuid, p_session_id uuid, p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_salt text;
begin
  if p_user_id is null or p_session_id is null or p_code is null or p_code !~ '^[0-9]{6}$'
     or not public.login_code_eligible(p_user_id)
     or not exists (
       select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id
     ) then
    return 'recusado';
  end if;

  -- Serializa pedidos da mesma conta (espera de 60 s e "código novo invalida o anterior").
  perform pg_advisory_xact_lock(hashtextextended('login-code:' || p_user_id::text, 0));

  if exists (
    select 1 from public.verified_sessions v
    where v.session_id = p_session_id and v.user_id = p_user_id and v.expires_at > now()
  ) then
    return 'verificado';
  end if;

  if exists (
    select 1 from public.login_email_codes c
    where c.user_id = p_user_id and c.created_at > now() - interval '60 seconds'
  ) then
    return 'aguarde';
  end if;

  v_key := encode(sha256(convert_to('byla-rate-limit:' || p_user_id::text, 'UTF8')), 'hex');
  if not public.consume_rate_limit('login-code:user-hour', v_key, 5, 3600) then
    return 'limite';
  end if;
  if not public.consume_rate_limit('login-code:user-day', v_key, 10, 86400) then
    return 'limite';
  end if;
  if exists (select 1 from public.staff_profiles sp where sp.user_id = p_user_id) then
    if not public.consume_rate_limit('login-code:all-day', 'site', 40, 86400) then
      return 'limite';
    end if;
  elsif not public.consume_rate_limit('login-code:org-day', 'site', 20, 86400) then
    return 'limite';
  end if;

  update public.login_email_codes c
  set invalidated_at = now()
  where c.user_id = p_user_id and c.used_at is null and c.invalidated_at is null;

  v_salt := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.login_email_codes (user_id, session_id, code_salt, code_hash, expires_at)
  values (
    p_user_id,
    p_session_id,
    v_salt,
    encode(sha256(convert_to(v_salt || ':' || p_code, 'UTF8')), 'hex'),
    now() + interval '10 minutes'
  );
  return 'ok';
end;
$$;

-- 7) Aviso de estorno ao organizador uma vez só -----------------------------------------------

-- Estorno pedido pelo organizador (pedido já atendido pelo gatilho do estorno).
create function public.claim_refund_request_notice(p_order_id uuid)
returns table (request_id uuid, requested_by uuid, event_id uuid, event_name text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organizer_ops_requests r
    where r.order_id = p_order_id and r.kind = 'estorno' and r.status = 'atendido'
      and r.organizer_notified_at is null
  ) then
    return;
  end if;
  insert into public.organizer_refund_notices (order_id) values (p_order_id) on conflict do nothing;
  if not found then
    return;
  end if;
  return query
  update public.organizer_ops_requests r set organizer_notified_at = now()
  from public.events e
  where r.order_id = p_order_id and r.kind = 'estorno' and r.status = 'atendido'
    and r.organizer_notified_at is null and e.id = r.event_id
  returning r.id, r.requested_by, r.event_id, e.name;
end;
$$;

-- Estorno feito pela equipe (um pedido ou "Estornar todos") num evento de organizador.
create function public.claim_event_refund_notice(p_order_id uuid)
returns table (organizer_id uuid, event_id uuid, event_name text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.organizer_refund_notices (order_id)
  select o.id from public.orders o
  join public.events e on e.id = o.event_id
  where o.id = p_order_id and o.status = 'estornado' and e.organizer_id is not null
  on conflict do nothing;
  if not found then
    return;
  end if;
  return query
  select e.organizer_id, e.id, e.name
  from public.orders o join public.events e on e.id = o.event_id
  where o.id = p_order_id;
end;
$$;

-- 8) Permissões ---------------------------------------------------------------------------

revoke execute on function public.pix_details_problem(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.accept_organizer_invite(text, uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.issue_organizer_action_code(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.organizer_pix_change_pending(uuid) from public, anon, authenticated;
revoke execute on function public.request_pix_change(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_pix_change(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.decide_pix_change(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.list_pix_change_requests(uuid) from public, anon, authenticated;
revoke execute on function public.pix_change_details(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.organizer_pix_change_state(uuid) from public, anon, authenticated;
revoke execute on function public.record_organizer_payout(uuid, uuid, integer, date, text) from public, anon, authenticated;
revoke execute on function public.issue_login_code(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_refund_request_notice(uuid) from public, anon, authenticated;
revoke execute on function public.claim_event_refund_notice(uuid) from public, anon, authenticated;

grant execute on function public.pix_details_problem(text, text, text, text) to service_role;
grant execute on function public.accept_organizer_invite(text, uuid, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.issue_organizer_action_code(uuid, text, text) to service_role;
grant execute on function public.organizer_pix_change_pending(uuid) to service_role;
grant execute on function public.request_pix_change(uuid, text, text, text, text, text) to service_role;
grant execute on function public.cancel_pix_change(uuid, uuid) to service_role;
grant execute on function public.decide_pix_change(uuid, uuid, boolean, text) to service_role;
grant execute on function public.list_pix_change_requests(uuid) to service_role;
grant execute on function public.pix_change_details(uuid, uuid) to service_role;
grant execute on function public.organizer_pix_change_state(uuid) to service_role;
grant execute on function public.record_organizer_payout(uuid, uuid, integer, date, text) to service_role;
grant execute on function public.issue_login_code(uuid, uuid, text) to service_role;
grant execute on function public.claim_refund_request_notice(uuid) to service_role;
grant execute on function public.claim_event_refund_notice(uuid) to service_role;
