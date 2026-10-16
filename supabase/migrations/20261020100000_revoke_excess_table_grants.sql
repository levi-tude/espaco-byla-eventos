-- Revisão de segurança 2026-10-16 (achado baixo): privilégios de tabela em excesso.
--
-- As tabelas events, ticket_types e staff_profiles nasceram com os privilégios
-- padrão do Supabase para anon/authenticated (inclui TRUNCATE, TRIGGER e
-- REFERENCES; em events e ticket_types também escrita para anon). A RLS já barra
-- a escrita por linha, mas TRUNCATE não passa pela RLS e "só a RLS segura" é uma
-- camada a menos. Esta migration deixa só o mínimo que o app usa.
--
-- Estado lido em 2026-10-16 (projeto Espaço Byla Eventos, só leitura):
--   events          anon e authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ticket_types    anon e authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   staff_profiles  anon e authenticated: REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- Estado depois desta migration:
--   events          anon: SELECT (vitrine pública) | authenticated: SELECT, INSERT, UPDATE, DELETE
--                   (a equipe cria, edita e apaga eventos pela sessão; a RLS events_staff_write
--                   continua exigindo is_staff())
--   ticket_types    anon: SELECT | authenticated: SELECT, INSERT, UPDATE, DELETE
--                   (save_event_ticket_types é SECURITY INVOKER e escreve aqui com a sessão da equipe)
--   staff_profiles  anon: nada | authenticated: SELECT
--                   (escrita já era negada desde service_fee; anon não lê perfis: a política
--                   staff_profiles_self exige auth.uid() ou is_staff())
-- service_role e postgres não são tocados.
--
-- Triggers continuam disparando: o privilégio TRIGGER só serve para CRIAR triggers
-- na tabela. As funções de trigger relevantes são SECURITY DEFINER ou rodam
-- com a sessão da equipe, que mantém INSERT/UPDATE.
--
-- ATENÇÃO: NÃO aplicar sem o "pode" explícito do dono. Antes de aplicar,
-- conferir o fingerprint do projeto Eventos (events, tickets, orders,
-- ticket_types, staff_profiles; sem alunos/transacoes) e depois repetir a leitura
-- de grants para confirmar o estado acima. Reversível com GRANT.

revoke all on table public.events from public, anon, authenticated;
grant select on table public.events to anon;
grant select, insert, update, delete on table public.events to authenticated;

revoke all on table public.ticket_types from public, anon, authenticated;
grant select on table public.ticket_types to anon;
grant select, insert, update, delete on table public.ticket_types to authenticated;

revoke all on table public.staff_profiles from public, anon, authenticated;
grant select on table public.staff_profiles to authenticated;
