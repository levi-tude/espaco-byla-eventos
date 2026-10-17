-- Formato canônico da chave PIX (DICT) e CNPJ alfanumérico (IN RFB 2.229/2024).
-- Não altera linhas existentes. A constraint nova é NOT VALID: a migração não
-- varre a tabela. Insert e update seguintes exigem a regra. Rode a consulta
-- comentada no fim antes de VALIDATE CONSTRAINT, se for validar à mão.
-- Não aplicar sem conferir o projeto Espaço Byla Eventos.

-- 1) Documento do titular: CPF numérico ou CNPJ numérico/alfanumérico. ---------
-- Valor de cada caractere do CNPJ = ascii − 48 ('0'=0 … '9'=9, 'A'=17 … 'Z'=42).
-- Pesos iguais ao CNPJ numérico, então um CNPJ só de dígitos continua válido.

create or replace function public.valid_tax_document(p_doc text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d integer[];
  s integer;
  r integer;
  i integer;
  w1 integer[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  w2 integer[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
begin
  if p_doc is null or p_doc ~ '^(.)\1*$' then
    return false;
  end if;

  if p_doc ~ '^[0-9]{11}$' then
    d := array(select ascii(substr(p_doc, g, 1)) - 48 from generate_series(1, 11) g);
    s := 0;
    for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> d[10] then return false; end if;
    s := 0;
    for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = d[11];
  end if;

  if p_doc !~ '^[0-9A-Z]{12}[0-9]{2}$' then
    return false;
  end if;
  d := array(select ascii(substr(p_doc, g, 1)) - 48 from generate_series(1, 14) g);
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

-- 2) Chave já normalizada. O aplicativo apara, põe em minúsculas e coloca os traços.
-- Telefone: +55, DDD em uso e celular (9 + 8 dígitos). EVP não exige UUID versão 4.
-- E-mail: minúsculas, no máximo 77. CNPJ da chave = documento do titular.

create or replace function public.pix_details_problem(p_type text, p_key text, p_holder text, p_doc text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_holder is null or char_length(btrim(p_holder)) not between 2 and 120 then 'titular'
    when not public.valid_tax_document(p_doc) then 'documento'
    when p_type is null or p_type not in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') then 'tipo'
    when p_key is null or p_key <> btrim(p_key) or char_length(p_key) not between 1 and 77 then 'chave'
    when p_type = 'cpf' and (p_key !~ '^[0-9]{11}$' or p_key <> p_doc) then 'chave'
    when p_type = 'cnpj' and (p_key !~ '^[0-9A-Z]{12}[0-9]{2}$' or p_key <> p_doc) then 'chave'
    when p_type = 'email' and (
      char_length(p_key) > 77
      or p_key <> lower(p_key)
      or p_key !~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,189}\.[^@[:space:]]{2,}$'
    ) then 'chave'
    when p_type = 'telefone'
      and p_key !~ '^\+55(11|12|13|14|15|16|17|18|19|21|22|24|27|28|31|32|33|34|35|37|38|41|42|43|44|45|46|47|48|49|51|53|54|55|61|62|63|64|65|66|67|68|69|71|73|74|75|77|79|81|82|83|84|85|86|87|88|89|91|92|93|94|95|96|97|98|99)9[0-9]{8}$'
      then 'chave'
    when p_type = 'aleatoria'
      and p_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then 'chave'
  end;
$$;

-- 3) CHECKs do documento: o padrão novo aceita o que o antigo aceitava (11 dígitos
-- ou 14 dígitos) e também CNPJ com letras. Dá para validar na hora.

do $drop_doc$
declare
  r record;
begin
  for r in
    select c.relname, con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('organizer_profiles', 'organizer_pix_change_requests', 'organizer_payouts')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ 'pix_holder_document'
      and pg_get_constraintdef(con.oid) ~ '\[0-9\]\{14\}'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end
$drop_doc$;

alter table public.organizer_profiles
  add constraint organizer_profiles_pix_holder_document_check
  check (pix_holder_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');

alter table public.organizer_pix_change_requests
  add constraint organizer_pix_change_requests_pix_holder_document_check
  check (pix_holder_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');

alter table public.organizer_payouts
  add constraint organizer_payouts_pix_holder_document_snapshot_check
  check (
    pix_holder_document_snapshot is null
    or pix_holder_document_snapshot ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'
  );

-- 4) Formato da chave nas tabelas vivas. NOT VALID: não recusa a migração se já
-- houver celular antigo (sem o 9) ou chave fora do formato novo. Um update dessa
-- linha passa a exigir a regra. Histórico de repasse não ganha esta checagem.

alter table public.organizer_profiles
  add constraint organizer_profiles_pix_details_check
  check (public.pix_details_problem(pix_key_type, pix_key, pix_holder_name, pix_holder_document) is null)
  not valid;

alter table public.organizer_pix_change_requests
  add constraint organizer_pix_change_requests_pix_details_check
  check (public.pix_details_problem(pix_key_type, pix_key, pix_holder_name, pix_holder_document) is null)
  not valid;

-- Linhas que a regra nova recusaria (não altera dados; não imprime a chave):
-- select 'perfil' as origem, user_id::text as id, pix_key_type
-- from public.organizer_profiles
-- where public.pix_details_problem(pix_key_type, pix_key, pix_holder_name, pix_holder_document) is not null
-- union all
-- select 'troca', id::text, pix_key_type
-- from public.organizer_pix_change_requests
-- where public.pix_details_problem(pix_key_type, pix_key, pix_holder_name, pix_holder_document) is not null;
