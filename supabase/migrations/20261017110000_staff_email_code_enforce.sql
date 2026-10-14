-- Trava da verificação por código no e-mail (plano 2026-10-14-codigo-email-equipe).
--
-- Aplicar SÓ DEPOIS do deploy do código com a tela /equipe/verificar e da migration
-- staff_email_code. A partir daqui, is_staff() e is_admin() só valem para sessão
-- verificada: toda política RLS e todo helper do servidor que usa is_staff() passa a
-- exigir o código sem mudar mais nada.
--
-- create or replace mantém assinatura e permissões (is_staff segue executável por anon e
-- authenticated porque aparece em políticas de leitura pública). Chamadas com
-- service_role não têm token: is_staff() dá falso, mas a service_role ignora RLS e
-- nenhuma função service_role chama is_staff().
--
-- Voltar atrás: reaplicar as definições de 20260917120000_init.sql (is_staff) e
-- 20261013100000_service_fee.sql (is_admin).

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid())
  ) and public.session_is_verified();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles sp
    where sp.user_id = (select auth.uid()) and sp.role = 'admin'
  ) and public.session_is_verified();
$$;
