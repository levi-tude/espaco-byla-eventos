# Relatório de correções da revisão final

Data: 2026-09-17
Branch: `feat/mvp`

## Correções aplicadas

- C1: criada a migration `20260917130000_capacity_and_paid_rpc.sql` com reserva de capacidade por evento sob `FOR UPDATE`, holds de 30 minutos e criação atômica de pedido/ingressos.
- C1: emissão de cortesia movida para RPC com o mesmo lock e regra de capacidade.
- C2: confirmação de pagamento movida para RPC transacional e idempotente, incluindo recuperação de ingressos `nao_pago` de um pedido já pago.
- C2: cancelamento de pedido pendente e ingressos movido para RPC transacional.
- I1: a referência local `order.id` é persistida como `payment_external_id` antes da chamada ao PagBank; a RPC também resolve diretamente por `order.id`.
- I2: edição de evento e preços movida para RPC atômica, impedindo capacidade abaixo de ingressos pagos, usados ou holds ativos.
- I3: após check-in bem-sucedido, o scanner pausa e exige “Próximo ingresso”.
- I4: o código completo do ingresso passou a ser exibido e selecionável abaixo do QR.
- Opcional: checkout limitado a 10 ingressos.
- Testes: wrappers de pagamento/cancelamento cobrem `updated`, `repaired`, `noop` e recusa por capacidade.

## Verificação

- `npm test`: passou — 7 arquivos, 25 testes.
- `npm run lint`: passou.
- `npm run build`: passou com Next.js 16.3.5.
- `git diff --check`: passou.

## Lacunas restantes

- A migration não foi aplicada a um Supabase local/remoto nesta rodada; o CLI local não está instalado. A concorrência real, RLS e as funções SQL ainda precisam de homologação no Supabase.
- Permanecem os gates externos já conhecidos: PagBank sandbox ponta a ponta, câmera em celular real e implantação/homologação na Vercel.
- O aviso existente de depreciação de `middleware.ts` no Next.js continua fora deste escopo.
