-- LGPD: organizer_profiles guarda chave PIX, documento do titular e contato.
-- A migração 20261022150305 deu `grant select` (todas as colunas) ao service_role para
-- o aviso/checagem de termos. O código agora lê o próprio perfil com a sessão do
-- organizador (política organizer_profiles_self_read), então o service_role volta a
-- não ter acesso direto à tabela, como diz 20261018100000_organizer_accounts.sql.
-- As funções SECURITY DEFINER (dono postgres) continuam lendo normalmente.
revoke all on table public.organizer_profiles from service_role;

comment on table public.organizer_profiles is
  'Perfil do organizador (PIX, documento, contato: LGPD). Sem acesso direto do service_role nem de anon; authenticated só lê a própria linha (organizer_profiles_self_read). Demais acessos só por funções SECURITY DEFINER.';
