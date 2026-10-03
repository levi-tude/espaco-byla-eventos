-- Equipe logada passa a só LER ingressos e pedidos; toda escrita vai pelas funções
-- do banco (service_role), que conferem as regras e registram quem fez.
-- Aplicar DEPOIS do deploy que usa check_in_ticket / cancel_courtesy_ticket: o
-- código anterior grava check-in e cancelamento direto com a sessão da equipe.

drop policy tickets_staff on public.tickets;
create policy tickets_staff_read on public.tickets
  for select to authenticated
  using (public.is_staff());

drop policy orders_staff on public.orders;
create policy orders_staff_read on public.orders
  for select to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate on table public.tickets from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.orders from public, anon, authenticated;
