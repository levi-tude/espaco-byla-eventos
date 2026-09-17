# Task 10 — Lista auditável + cortesia + cancelar + totais

Status: DONE_WITH_CONCERNS

## Entregue

- Lista pesquisável por nome, sem UUID visível, com tipo, status em português, valor e horários de pagamento/check-in.
- Totais ativos por inteira, meia e cortesia, além da receita em reais.
- Emissão de cortesia como pedido interno pago de R$ 0, com validação de capacidade no servidor.
- Cancelamento confirmado de ingresso pago ainda sem check-in, registrando `cancelled_at` e liberando capacidade.

## Verificação

- `npm test`: 7 arquivos e 21 testes aprovados.
- `npm run lint`: aprovado.
- `npm run build`: aprovado.

## Ressalva

- O fluxo integrado com venda sandbox, Supabase remoto e check-in não foi executado neste ambiente. As verificações locais de teste, lint, tipos e build passaram.
