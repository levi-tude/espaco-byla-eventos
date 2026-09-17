# Task 7 — Checkout, pedido e confirmação de pagamento

## Status

DONE_WITH_CONCERNS em 2026-09-17 na branch `feat/mvp`.

## Implementação

- Checkout público em português para inteira/meia, dados do comprador e total.
- Server Action valida venda, tipos, capacidade e valores antes de criar pedido
  e ingressos com o cliente administrativo.
- Pagamento iniciado pelo adapter configurado e redirecionado ao checkout
  hospedado; retorno aponta para o token público do pedido.
- Webhook interpreta pagamento/cancelamento e atualiza pedido e ingressos.
- `markOrderPaidIfPending` usa atualização condicional do pedido e torna
  confirmações duplicadas no-op.
- Teste com mock comprova que duas confirmações atualizam os ingressos uma vez.

## Verificação

- `npm test`: 7 arquivos e 17 testes aprovados.
- `npm run build`: aprovado, incluindo TypeScript e a rota do webhook.
- `git diff --check`: aprovado.
- Sandbox PagBank não executado; conforme o brief, esta é a única ressalva.
- Avisos preexistentes: configuração futura do Vite e migração de `middleware`
  para `proxy`.

Task 8 não foi iniciada.
