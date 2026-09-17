-- Dados exclusivamente fictícios para desenvolvimento local.

insert into public.events (
  id,
  slug,
  name,
  description,
  venue,
  starts_at,
  capacity,
  sales_open
) values (
  '10000000-0000-4000-8000-000000000001',
  'noite-de-teste',
  'Noite de Teste',
  'Evento fictício para testar compra, pagamento e check-in.',
  'Espaço de Teste',
  '2027-01-23 22:00:00-03',
  120,
  true
)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  venue = excluded.venue,
  starts_at = excluded.starts_at,
  capacity = excluded.capacity,
  sales_open = excluded.sales_open;

insert into public.ticket_types (id, event_id, kind, price_cents, active)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'inteira',
    5000,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'meia',
    2500,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'cortesia',
    0,
    true
  )
on conflict (id) do update set
  event_id = excluded.event_id,
  kind = excluded.kind,
  price_cents = excluded.price_cents,
  active = excluded.active;

insert into public.orders (
  id,
  event_id,
  buyer_name,
  buyer_email,
  total_cents,
  status,
  public_token,
  payment_provider,
  payment_external_id,
  paid_at
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Maria Souza',
    'maria.souza@example.com',
    5000,
    'pendente',
    'pedido-teste-nao-pago',
    null,
    null,
    null
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'João Teste',
    'joao.teste@example.com',
    2500,
    'pago',
    'pedido-teste-pago',
    'pagbank',
    'PAGAMENTO-TESTE-PAGO',
    '2027-01-20 12:00:00-03'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'Maria Souza',
    'maria.souza@example.com',
    0,
    'pago',
    'pedido-teste-check-in',
    null,
    null,
    '2027-01-20 12:05:00-03'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'João Teste',
    'joao.teste@example.com',
    5000,
    'cancelado',
    'pedido-teste-cancelado',
    'pagbank',
    'PAGAMENTO-TESTE-CANCELADO',
    null
  )
on conflict (id) do update set
  event_id = excluded.event_id,
  buyer_name = excluded.buyer_name,
  buyer_email = excluded.buyer_email,
  total_cents = excluded.total_cents,
  status = excluded.status,
  public_token = excluded.public_token,
  payment_provider = excluded.payment_provider,
  payment_external_id = excluded.payment_external_id,
  paid_at = excluded.paid_at;

insert into public.tickets (
  id,
  order_id,
  event_id,
  ticket_type_id,
  kind,
  status,
  code,
  buyer_name,
  price_cents,
  checked_in_at,
  cancelled_at
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'inteira',
    'nao_pago',
    'QR-TESTE-NAO-PAGO',
    'Maria Souza',
    5000,
    null,
    null
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    'meia',
    'pago',
    'QR-TESTE-PAGO',
    'João Teste',
    2500,
    null,
    null
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000003',
    'cortesia',
    'check_in',
    'QR-TESTE-CHECK-IN',
    'Maria Souza',
    0,
    '2027-01-23 22:15:00-03',
    null
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'inteira',
    'cancelado',
    'QR-TESTE-CANCELADO',
    'João Teste',
    5000,
    null,
    '2027-01-21 09:00:00-03'
  )
on conflict (id) do update set
  order_id = excluded.order_id,
  event_id = excluded.event_id,
  ticket_type_id = excluded.ticket_type_id,
  kind = excluded.kind,
  status = excluded.status,
  code = excluded.code,
  buyer_name = excluded.buyer_name,
  price_cents = excluded.price_cents,
  checked_in_at = excluded.checked_in_at,
  cancelled_at = excluded.cancelled_at;
