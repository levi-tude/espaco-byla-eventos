# Task 8 — Página do ingresso, QR e e-mail

## Status

DONE em 2026-09-17 na branch `feat/mvp`.

## Implementação

- Página pública por `orders.public_token`, com estados de pagamento em
  português e resposta 404 para tokens inexistentes.
- Pedidos pagos exibem um QR por ingresso pago ou já utilizado; o conteúdo do
  QR é somente `tickets.code`.
- Os cartões mostram evento, tipo, titular e status sem IDs internos na UI.
- Confirmações novas no webhook enviam, em best-effort, o link público dos
  ingressos pelo Resend.
- Sem configuração de e-mail, o envio faz no-op com aviso e não interfere na
  confirmação do pagamento.
- `.env.example` e README documentam `RESEND_API_KEY` e `RESEND_FROM_EMAIL`.

## Verificação

- `npm test`: 7 arquivos e 17 testes aprovados.
- `npm run build`: aprovado, incluindo TypeScript e a rota dinâmica do pedido.
- `git diff --check`: aprovado.
- Avisos preexistentes: configuração futura do Vite e migração de `middleware`
  para `proxy`.

Task 9 não foi iniciada.
