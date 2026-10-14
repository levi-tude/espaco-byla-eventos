-- Ensaio de eventos passados. Roda tudo dentro de uma transação e desfaz no fim.
-- Uso: substituir a linha marcada pelo conteúdo de
-- supabase/migrations/20261016100000_past_events.sql e executar o arquivo inteiro.
begin;

-- >>> conteúdo da migração 20261016100000_past_events.sql aqui <<<

insert into public.events (id, name, slug, venue, capacity, starts_at, sales_open) values
  ('00000000-0000-4000-8000-0000000000a1', 'Ensaio publicado', 'ensaio-publicado', 'Espaço Byla', 10, now() - interval '3 days', true),
  ('00000000-0000-4000-8000-0000000000a2', 'Ensaio rascunho', 'ensaio-rascunho', 'Espaço Byla', 10, now() - interval '3 days', false),
  ('00000000-0000-4000-8000-0000000000a3', 'Ensaio escondido', 'ensaio-escondido', 'Espaço Byla', 10, now() - interval '3 days', true),
  ('00000000-0000-4000-8000-0000000000a4', 'Ensaio cancelado', 'ensaio-cancelado', 'Espaço Byla', 10, now() - interval '3 days', true),
  ('00000000-0000-4000-8000-0000000000a5', 'Ensaio futuro', 'ensaio-futuro', 'Espaço Byla', 10, now() + interval '3 days', true);

insert into public.ticket_types (event_id, name, kind, price_cents)
values ('00000000-0000-4000-8000-0000000000a1', 'Inteira', 'inteira', 5000);

-- Depois do evento as vendas costumam estar fechadas.
update public.events set sales_open = false
where id in ('00000000-0000-4000-8000-0000000000a1',
             '00000000-0000-4000-8000-0000000000a3',
             '00000000-0000-4000-8000-0000000000a4');
update public.events set hidden_from_past = true
where id = '00000000-0000-4000-8000-0000000000a3';
update public.event_sessions
set status = 'cancelada', cancelled_at = now(), cancelled_by_name = 'Ensaio',
    cancel_reason = 'ensaio de eventos passados'
where event_id = '00000000-0000-4000-8000-0000000000a4';

-- Gatilho: nunca volta a null e não aceita data à mão.
update public.events set published_at = null where id = '00000000-0000-4000-8000-0000000000a1';
update public.events set published_at = now() where id = '00000000-0000-4000-8000-0000000000a2';

select
  (select published_at is not null from public.events where id = '00000000-0000-4000-8000-0000000000a1') as publicado_mantem_data,
  (select published_at is null from public.events where id = '00000000-0000-4000-8000-0000000000a2') as rascunho_sem_data;

set local role anon;

select
  exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a1') as publicado_visivel,
  not exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a2') as rascunho_oculto,
  not exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a3') as escondido_oculto,
  not exists (select 1 from public.events where id = '00000000-0000-4000-8000-0000000000a4') as cancelado_oculto,
  exists (select 1 from public.event_sessions where event_id = '00000000-0000-4000-8000-0000000000a1') as sessoes_visiveis,
  not exists (select 1 from public.ticket_types where event_id = '00000000-0000-4000-8000-0000000000a1') as tipos_fechados,
  not exists (
    select 1 from public.session_ticket_types stt
    join public.event_sessions s on s.id = stt.session_id
    where s.event_id = '00000000-0000-4000-8000-0000000000a1'
  ) as precos_fechados,
  (select count(*) from public.public_past_events(12) where id = '00000000-0000-4000-8000-0000000000a1') = 1 as lista_tem_publicado,
  (select count(*) from public.public_past_events(12) where id in (
    '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3',
    '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5'
  )) = 0 as lista_filtra_os_outros;

reset role;
rollback;
