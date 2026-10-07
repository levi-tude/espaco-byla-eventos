-- Saída da Vercel: o banco passa a chamar GET /api/cron/keep-alive 1x/dia
-- (pg_cron + pg_net), no lugar do agendador da Vercel (vercel.json).
-- Inerte até o dono cadastrar no Vault:
--   keep_alive_cron_secret = o mesmo valor de CRON_SECRET no site (32+ caracteres)
--   keep_alive_cron_url    = https://<domínio-novo>/api/cron/keep-alive
-- Guia: docs/superpowers/plans/2026-10-07-sair-da-vercel.md

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_keep_alive()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
begin
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'keep_alive_cron_secret'
  limit 1;

  if v_secret is null or char_length(v_secret) < 32 then
    return null;
  end if;

  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s
  where s.name = 'keep_alive_cron_url'
  limit 1;

  v_url := btrim(coalesce(v_url, ''));
  if v_url !~ '^https://[A-Za-z0-9.-]+/api/cron/keep-alive$' then
    return null;
  end if;

  return net.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

-- Só o dono do banco (que roda o job no pg_cron) executa.
revoke all on function public.invoke_keep_alive() from public, anon, authenticated, service_role;

-- 00:00 UTC (21h em Brasília), logo depois de o limite diário de e-mails renovar.
-- Reaplicar só atualiza o job de mesmo nome.
select cron.schedule(
  'keep-alive-diario',
  '0 0 * * *',
  $$select public.invoke_keep_alive()$$
);
