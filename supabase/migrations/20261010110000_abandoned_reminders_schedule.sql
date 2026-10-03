-- Fase 6: peças do agendamento do lembrete. Esta migration NÃO agenda nada.
-- O job é ligado à mão pelo dono (docs/superpowers/plans/2026-10-03-lembrete-ativacao.md)
-- e, mesmo agendado, não chama o site enquanto o segredo `reminder_cron_secret`
-- não existir no Vault.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Chama POST /api/cron/abandoned-reminders com o segredo guardado no Vault.
-- `reminder_cron_url` (opcional, no Vault) troca o endereço se o domínio mudar.
create or replace function public.invoke_abandoned_reminders()
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
  where s.name = 'reminder_cron_secret'
  limit 1;

  if v_secret is null or char_length(v_secret) < 32 then
    return null;
  end if;

  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s
  where s.name = 'reminder_cron_url'
  limit 1;

  v_url := coalesce(
    nullif(btrim(v_url), ''),
    'https://espaco-byla-eventos.vercel.app/api/cron/abandoned-reminders'
  );
  if v_url !~ '^https://[A-Za-z0-9.-]+/api/cron/abandoned-reminders$' then
    return null;
  end if;

  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

-- Só o dono do banco (que agenda o job no pg_cron) executa.
revoke all on function public.invoke_abandoned_reminders() from public, anon, authenticated, service_role;
