-- Novos estados de pagamento (fase 2 da spec 2026-10-01-estorno-tipos-carrinho).
-- Fica separada porque o Postgres não deixa usar um valor novo de enum na mesma
-- transação em que ele foi criado; a migration seguinte já usa esses valores.

alter type public.order_status add value if not exists 'estornado';
alter type public.order_status add value if not exists 'aguardando_decisao';

alter type public.ticket_status add value if not exists 'estornado';

create type public.refund_status as enum ('solicitado', 'concluido', 'falhou');
