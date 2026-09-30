-- Limite de tentativas por chave (IP, e-mail ou pedido, sempre em hash) para
-- checkout e pagamento. Só o servidor (service_role) usa; sem acesso público.
create table public.rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_hits_lookup_idx
  on public.rate_limit_hits (bucket, key_hash, created_at);

alter table public.rate_limit_hits enable row level security;
revoke all on table public.rate_limit_hits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serializa chamadas da mesma chave para a contagem não estourar o limite.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_key_hash, 0));

  select count(*) into v_count
  from public.rate_limit_hits
  where bucket = p_bucket
    and key_hash = p_key_hash
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_hits (bucket, key_hash)
  values (p_bucket, p_key_hash);
  return true;
end;
$$;

create or replace function public.purge_rate_limit_hits()
returns integer
language sql
set search_path = ''
as $$
  with deleted as (
    delete from public.rate_limit_hits
    where created_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_rate_limit_hits() from public, anon, authenticated;

grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.purge_rate_limit_hits() to service_role;
