-- JÁ APLICADA em produção em 2026-11-13 (versão 20261113165300, aprovada pelo Levi).
-- Tipos com código de liberação deixam de ser visíveis ao público (anon/authenticated
-- que não são staff nem donos do evento). O hash do código só fica legível pelo
-- service_role (checkout), pela equipe e pelo organizador dono do evento.
-- Abordagem por RLS (linha) e não por revoke de coluna: páginas que usam a sessão
-- selecionam/filtram unlock_code_hash e quebrariam com 42501.
alter policy ticket_types_public_read on public.ticket_types
  using (
    (
      kind <> 'cortesia'::ticket_kind
      and archived_at is null
      and active
      and unlock_code_hash is null
      and exists (
        select 1 from public.events e
        where e.id = ticket_types.event_id
          and e.sales_open = true
          and e.deleted_at is null
      )
    )
    or public.is_staff()
    or public.owns_event(event_id)
  );
