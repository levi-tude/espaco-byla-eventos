# Task 6 — Adapter de pagamento + escolha do provedor

## Status

Concluída em 2026-09-17 na branch `feat/mvp`.

## Decisão

PagBank escolhido para o MVP, usando Checkout hospedado restrito a PIX. Ele
atende checkout por redirecionamento, sandbox, confirmação automática por
webhook e validação de autenticidade. Mercado Pago foi mantido como alternativa
caso a homologação real do PagBank revele algum bloqueio.

A avaliação e as referências oficiais estão em
`docs/superpowers/plans/payment-provider-decision.md`.

## Implementação

- Tipos e interface `PaymentProvider` conforme o brief.
- Factory por `PAYMENT_PROVIDER`, com erro explícito para valor não suportado.
- Adapter PagBank via `POST /checkouts`, sem SDK adicional.
- Configuração sandbox por variáveis de ambiente, sem segredos versionados.
- Correlação idempotente pelo `reference_id` do pedido.
- Parser de webhook para `PAID`, `CANCELED`, `DECLINED` e `EXPIRED`.
- Verificação SHA-256 do corpo bruto pelo header `x-authenticity-token`.
- Fixture totalmente fictícia e testes do pagamento PIX pago e de assinatura
  inválida.
- `.env.example` e seção de pagamentos do README atualizados.

## Verificação

- `npm test`: 6 arquivos, 16 testes aprovados.
- `npm run build`: aprovado; compilação e TypeScript concluídos.
- `npm run lint`: aprovado, sem erros.
- Aviso preexistente do Next.js: convenção `middleware` está depreciada em
  favor de `proxy`; não pertence ao escopo desta tarefa.

Task 7 não foi iniciada.
