# Plano: taxa por forma de pagamento ("4% off no Pix")

Data: 19/10/2026 · Status: em implementação · Repo: levi-tude/espaco-byla-eventos · Branch: `feat/taxa-por-forma-pagamento`

## Decisão
- Taxa de serviço base (cartão): **10%** (`card_rate_bps` 1000) do preço de cada ingresso; Pix: **5,56%** (`pix_rate_bps` 556). Mínimo **R$ 1,00** nos dois.
- Comunicação: **"4% off no Pix"** sobre o total (mesmo ganho da plataforma nos dois métodos).
- Juros de parcelamento pagos pelo comprador (confirmado no painel do Mercado Pago).
- Preço do ingresso não muda; meia-entrada continua metade do preço da inteira (a taxa incide sobre o preço da meia).
- Rollout: colunas + `per_method_enabled = false` (cobrança idêntica à atual via `rate_bps`); ligar a flag só depois dos Termos novos e do aceite dos organizadores.

## Estado atual (lido no código)
- `service_fee_for_price(price, rate_bps, min)` em `supabase/migrations/20261013100000_service_fee.sql`: `greatest(min, (price*bps+5000)/10000)`, por ingresso × quantidade; base = preço do ingresso.
- Espelho para exibição: `src/lib/domain/service-fee.ts` (`serviceFeeForPrice`, `orderFeeBreakdown`, `priceWithFeeLabel`).
- Política única: `service_fee_settings (enabled, rate_bps, min_cents)`; RPC `service_fee_policy`; leitura em `src/lib/payments/service-fee-policy.ts`.
- Pedido guarda `service_fee_rate_bps`, `service_fee_min_cents`, `service_fee_cents`, `total_cents`; itens guardam `service_fee_unit_cents/total_cents`. Há trigger que impede mudar a taxa do pedido.
- O checkout cria o pedido com total fechado (`TAXA_MUDOU` se divergir) **antes** da escolha Pix/cartão, que ocorre em `src/components/public/OrderPayment.tsx`.
- Cobrança: `src/lib/payments/mercadopago.ts` `createPayment` envia `amount = total` em `POST /v1/orders`.
- Termos: `src/lib/legal/terms.ts`, `src/lib/legal/organizer-terms.ts`.

## 1. Modelo de dados (nova migração)
- `service_fee_settings`: `card_rate_bps` (default 1000), `pix_rate_bps` (default 556), `per_method_enabled` (default false). Manter `rate_bps` na transição. **Não alterar** `rate_bps` nem ligar a flag nesta migração.
- RPC `service_fee_policy` devolve `card_rate_bps, pix_rate_bps, min_cents, per_method_enabled` (e `rate_bps` / `enabled` para compatibilidade).
- `orders`: `payment_method` (`pix`/`card`/null), `fee_priced_at`, `card_rate_bps_snapshot`, `pix_rate_bps_snapshot`.
- Trigger de imutabilidade: permitir mudar taxa/total **somente** pela RPC `set_order_payment_method` (GUC `app.allow_fee_reprice`).

## 2. Fluxo
1. Checkout precifica como **cartão** quando `per_method_enabled` (taxa mais alta); com a flag desligada, usa `rate_bps` e grava as duas snapshots iguais a `rate_bps`.
2. `OrderPayment` chama `POST /api/pedidos/[publicToken]/forma` com `{method}` apenas.
3. RPC `set_order_payment_method` (lock, só `pendente`, recalcula no servidor com as snapshots).
4. `payOrder` / `createPayment`: método do pedido deve bater com o pagamento → senão `FORMA_MUDOU`.
5. Troca depois de cobrança ativa: só se Pix expirou/cancelado; `X-Idempotency-Key` inclui método + total.

## 3. Interface
- Dois totais + "economize R$ X" / "4% off no Pix".
- `FeeNote` e rótulos de preço mostram as duas taxas quando a flag estiver ligada.

## 4. Termos (N16)
- Nova `TERMS_VERSION` / `ORGANIZER_TERMS_VERSION` (`2026-10-19`).
- `TERMS_SERVICE_FEE = { cardRateBps: 1000, pixRateBps: 556, minCents: 100 }`.
- Reaceite obrigatório do organizador antes de criar/editar/enviar evento.

## 5. Testes
- Unitários, banco (RPC + flag + lock) e integração mock MP (`FORMA_MUDOU`).

## 6. Ordem de publicação
1. Migração com flag **desligada** (cobrança = `rate_bps` atual).
2. Código no ar com flag desligada; conferir que nada mudou.
3. Publicar Termos novos; coletar aceite dos organizadores.
4. Na vigência: `update service_fee_settings set card_rate_bps=1000, pix_rate_bps=556, per_method_enabled=true` (dono).
5. Monitorar 48 h. Rollback = `per_method_enabled=false`.

## 7. Casos de borda
- Mínimo R$ 1 pode reduzir o desconto percentual em preços baixos → preferir "economize R$ X".
- Pedidos pendentes na virada mantêm o snapshot com que foram criados.
- Cortesia / total zero: sem escolha de método.

## 8. Exemplos (1 ingresso; MP: Pix 0,99%, cartão à vista 4,98% sobre o total; ganho = taxa − tarifa MP)

Fórmula: `greatest(100, (preço_centavos × bps + 5000) / 10000)`.

| Ingresso | Cartão: taxa / total / tarifa MP / ganho | Pix: taxa / total / tarifa MP / ganho | Desconto real |
|---|---|---|---|
| R$ 25 (ex.: meia de R$ 50) | 2,50 / 27,50 / 1,37 / **1,13** | 1,39 / 26,39 / 0,26 / **1,13** | 1,11 (4,04%) |
| R$ 50 | 5,00 / 55,00 / 2,74 / **2,26** | 2,78 / 52,78 / 0,52 / **2,26** | 2,22 (4,04%) |
| R$ 100 | 10,00 / 110,00 / 5,48 / **4,52** | 5,56 / 105,56 / 1,05 / **4,51** | 4,44 (4,04%) |

Com cartão 10% e Pix 5,56%, o ganho da plataforma (taxa − tarifa MP) fica alinhado nos dois métodos. Anunciar **"4% off no Pix"**.
