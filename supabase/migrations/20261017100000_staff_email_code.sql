-- Verificação em duas etapas por código no e-mail (spec 2026-10-13-contas-organizador,
-- decisão 9 revista em 2026-10-14; plano 2026-10-14-codigo-email-equipe).
--
-- ADITIVA: só cria tabelas e funções; o site no ar não percebe. A trava em
-- is_staff()/is_admin() fica na migration seguinte (staff_email_code_enforce), aplicada
-- depois do deploy do código novo.
--
-- A verificação vale para a SESSÃO do Supabase (claim session_id do token), nunca para o
-- usuário inteiro: outro aparelho ou outro login não herda nada.
--
-- Tabelas: RLS ligada, sem políticas e sem acesso direto (nem service_role); tudo passa
-- pelas funções abaixo. Só hashes: código = sha256(sal || ':' || código), com sal por
-- linha que nunca sai do banco; aparelho = sha256(token aleatório de 32 bytes).
-- Genéricas por usuário: a fase 2 (organizador) só amplia login_code_eligible().

-- 1) Tabelas -------------------------------------------------------------------------

create table public.login_email_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  code_salt text not null,
  code_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  invalidated_at timestamptz
);
create index login_email_codes_user_idx on public.login_email_codes (user_id, created_at desc);

create table public.verified_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null check (method in ('codigo', 'aparelho', 'emergencia')),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index verified_sessions_user_idx on public.verified_sessions (user_id);

create table public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Navegador' check (char_length(label) between 1 and 60),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index trusted_devices_user_idx on public.trusted_devices (user_id);

alter table public.login_email_codes enable row level security;
alter table public.verified_sessions enable row level security;
alter table public.trusted_devices enable row level security;

revoke all on table public.login_email_codes from public, anon, authenticated, service_role;
revoke all on table public.verified_sessions from public, anon, authenticated, service_role;
revoke all on table public.trusted_devices from public, anon, authenticated, service_role;

-- 2) Funções internas ----------------------------------------------------------------

-- Sessão do token atual; nula sem token (service_role) ou com valor fora do formato.
create function public.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when j.sid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then j.sid::uuid
  end
  from (select lower(auth.jwt() ->> 'session_id') as sid) j;
$$;

-- Quem usa o código para entrar. Fase 2: "ou organizador ativo".
create function public.login_code_eligible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (select 1 from public.staff_profiles sp where sp.user_id = p_user_id);
$$;

-- A sessão do token atual foi verificada, não venceu e ainda existe no Supabase Auth
-- (sair, trocar a senha ou derrubar sessões no painel invalida na hora).
create function public.session_is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.verified_sessions v
    join auth.sessions s on s.id = v.session_id and s.user_id = v.user_id
    where v.session_id = public.current_session_id()
      and v.user_id = (select auth.uid())
      and v.expires_at > now()
  );
$$;

-- 3) Estado do login (proxy, layout e tela do código; com a sessão do usuário) -----------

-- 'fora' (sem login, sem sessão válida ou sem direito ao painel), 'pendente' ou
-- 'verificado'. Em 'pendente' devolve a validade do código em aberto desta sessão e
-- quando um novo código pode ser pedido.
create function public.login_session_state()
returns table (
  status text,
  user_id uuid,
  session_id uuid,
  code_expires_at timestamptz,
  resend_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.current_session_id();
begin
  if v_uid is null or v_sid is null or not public.login_code_eligible(v_uid)
     or not exists (select 1 from auth.sessions s where s.id = v_sid and s.user_id = v_uid) then
    return query select 'fora'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  if public.session_is_verified() then
    return query select 'verificado'::text, v_uid, v_sid, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query
  select
    'pendente'::text,
    v_uid,
    v_sid,
    (select c.expires_at
     from public.login_email_codes c
     where c.user_id = v_uid and c.session_id = v_sid
       and c.used_at is null and c.invalidated_at is null and c.expires_at > now()
     order by c.created_at desc
     limit 1),
    (select max(c.created_at) + interval '60 seconds'
     from public.login_email_codes c
     where c.user_id = v_uid);
end;
$$;

-- 4) Emitir código (só service_role) -------------------------------------------------

-- O servidor gera o código (gerador criptográfico), lê usuário e sessão de
-- login_session_state() com a sessão do usuário e só então chama esta função. Ela não
-- pode ser chamável pelo usuário: quem tem só a senha escolheria o próprio código.
-- 'ok' | 'aguarde' (60 s) | 'limite' | 'verificado' | 'recusado'.
create function public.issue_login_code(p_user_id uuid, p_session_id uuid, p_code text)
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
  if not public.consume_rate_limit('login-code:all-day', 'site', 40, 86400) then
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

-- 5) Conferir código e aparelho lembrado (com a sessão do usuário) -------------------

-- Usuário e sessão vêm do token, nunca de parâmetros. Compara hashes com sal secreto
-- (o tempo da comparação não revela nada sobre o código); tentativa contada na mesma
-- transação, com trava na linha. 5 erros invalidam o código.
-- Com p_device_token (32 bytes em base64url, gerado pelo servidor), lembra o aparelho
-- por 30 dias e a sessão vale 30 dias; sem, a sessão vale 12 horas.
-- 'ok' | 'invalido' | 'expirado' | 'bloqueado' | 'verificado' | 'fora'.
create function public.verify_login_code(
  p_code text,
  p_device_token text default null,
  p_device_label text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.current_session_id();
  v_code public.login_email_codes%rowtype;
  v_expires timestamptz := now() + interval '12 hours';
begin
  if v_uid is null or v_sid is null or not public.login_code_eligible(v_uid)
     or not exists (select 1 from auth.sessions s where s.id = v_sid and s.user_id = v_uid) then
    return 'fora';
  end if;

  if public.session_is_verified() then
    return 'verificado';
  end if;

  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return 'invalido';
  end if;

  select c.* into v_code
  from public.login_email_codes c
  where c.user_id = v_uid and c.session_id = v_sid
    and c.used_at is null and c.invalidated_at is null
  order by c.created_at desc
  limit 1
  for update;

  if not found or v_code.expires_at <= now() then
    return 'expirado';
  end if;
  if v_code.attempts >= 5 then
    return 'bloqueado';
  end if;

  if encode(sha256(convert_to(v_code.code_salt || ':' || p_code, 'UTF8')), 'hex') <> v_code.code_hash then
    update public.login_email_codes c
    set attempts = c.attempts + 1,
        invalidated_at = case when c.attempts + 1 >= 5 then now() end
    where c.id = v_code.id;
    return case when v_code.attempts + 1 >= 5 then 'bloqueado' else 'invalido' end;
  end if;

  update public.login_email_codes c set used_at = now() where c.id = v_code.id;

  if p_device_token is not null and p_device_token ~ '^[A-Za-z0-9_-]{43,128}$' then
    insert into public.trusted_devices (user_id, token_hash, label, expires_at)
    values (
      v_uid,
      encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex'),
      coalesce(nullif(left(btrim(coalesce(p_device_label, '')), 60), ''), 'Navegador'),
      now() + interval '30 days'
    );

    -- Até 10 aparelhos ativos por conta: esquece os mais antigos.
    update public.trusted_devices d
    set revoked_at = now()
    where d.id in (
      select d2.id
      from public.trusted_devices d2
      where d2.user_id = v_uid and d2.revoked_at is null and d2.expires_at > now()
      order by d2.created_at desc
      offset 10
    );

    v_expires := now() + interval '30 days';
  end if;

  insert into public.verified_sessions (session_id, user_id, method, expires_at)
  values (v_sid, v_uid, 'codigo', v_expires)
  on conflict (session_id) do update
    set user_id = excluded.user_id,
        method = excluded.method,
        verified_at = now(),
        expires_at = excluded.expires_at;
  return 'ok';
end;
$$;

-- Aparelho lembrado (cookie httpOnly) verifica a sessão nova sem e-mail. Só aparelho da
-- mesma conta, não esquecido e dentro dos 30 dias.
create function public.verify_session_with_device(p_device_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.current_session_id();
  v_device public.trusted_devices%rowtype;
begin
  if v_uid is null or v_sid is null or p_device_token is null
     or p_device_token !~ '^[A-Za-z0-9_-]{43,128}$'
     or not public.login_code_eligible(v_uid)
     or not exists (select 1 from auth.sessions s where s.id = v_sid and s.user_id = v_uid) then
    return false;
  end if;

  select d.* into v_device
  from public.trusted_devices d
  where d.token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex')
    and d.user_id = v_uid and d.revoked_at is null and d.expires_at > now()
  for update;

  if not found then
    return false;
  end if;

  update public.trusted_devices d set last_used_at = now() where d.id = v_device.id;

  insert into public.verified_sessions (session_id, user_id, method, expires_at)
  values (v_sid, v_uid, 'aparelho', least(v_device.expires_at, now() + interval '30 days'))
  on conflict (session_id) do update
    set user_id = excluded.user_id,
        method = excluded.method,
        verified_at = now(),
        expires_at = excluded.expires_at;
  return true;
end;
$$;

-- Sair: o Supabase encerra todas as sessões da conta (signOut global), então todas as
-- verificações dela saem junto. O aparelho continua lembrado.
create function public.end_login_verification()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.verified_sessions v where v.user_id = (select auth.uid());
  update public.login_email_codes c
  set invalidated_at = now()
  where c.user_id = (select auth.uid()) and c.used_at is null and c.invalidated_at is null;
$$;

-- 6) Limpeza diária (cron keep-alive, service_role) ----------------------------------

create function public.purge_login_verification()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_count integer;
begin
  delete from public.login_email_codes c where c.created_at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  delete from public.verified_sessions v
  where v.expires_at <= now()
     or not exists (select 1 from auth.sessions s where s.id = v.session_id);
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  delete from public.trusted_devices d
  where d.expires_at <= now() or d.revoked_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

-- 7) Permissões ----------------------------------------------------------------------

revoke all on function public.current_session_id() from public, anon, authenticated, service_role;
revoke all on function public.login_code_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function public.session_is_verified() from public, anon, authenticated;
revoke all on function public.login_session_state() from public, anon, authenticated;
revoke all on function public.issue_login_code(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.verify_login_code(text, text, text) from public, anon, authenticated;
revoke all on function public.verify_session_with_device(text) from public, anon, authenticated;
revoke all on function public.end_login_verification() from public, anon, authenticated;
revoke all on function public.purge_login_verification() from public, anon, authenticated;

grant execute on function public.session_is_verified() to authenticated, service_role;
grant execute on function public.login_session_state() to authenticated;
grant execute on function public.verify_login_code(text, text, text) to authenticated;
grant execute on function public.verify_session_with_device(text) to authenticated;
grant execute on function public.end_login_verification() to authenticated;
grant execute on function public.issue_login_code(uuid, uuid, text) to service_role;
grant execute on function public.purge_login_verification() to service_role;
