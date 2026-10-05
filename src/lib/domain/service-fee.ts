/**
 * Taxa de serviço: mesma fórmula da função `service_fee_for_price` do banco, que é
 * a fonte da verdade. Aqui serve só para exibir; o servidor recalcula tudo.
 */

export type ServiceFeePolicy = {
  enabled: boolean;
  /** Pontos-base: 500 = 5%. */
  rateBps: number;
  minCents: number;
};

export const SERVICE_FEE_OFF: ServiceFeePolicy = { enabled: false, rateBps: 0, minCents: 0 };

export const SERVICE_FEE_LABEL = "Taxa de serviço";

export const SERVICE_FEE_HELP =
  "Valor cobrado por ingresso para manter a venda on-line. É devolvido junto em qualquer estorno.";

export const SERVICE_FEE_CHANGED_MESSAGE =
  "Os valores foram atualizados. Confira o total antes de continuar.";

/** Percentual e mínimo que valem na compra (desligada = 0), enviados ao banco para conferir. */
export function effectiveFeeTerms(policy: ServiceFeePolicy): { rateBps: number; minCents: number } {
  return policy.enabled ? { rateBps: policy.rateBps, minCents: policy.minCents } : { rateBps: 0, minCents: 0 };
}

/** Taxa de uma unidade: max(mínimo, preço × percentual arredondado meio-para-cima). */
export function serviceFeeForPrice(priceCents: number, policy: ServiceFeePolicy): number {
  if (!policy.enabled || !Number.isInteger(priceCents) || priceCents <= 0) return 0;
  const percent = Math.floor((priceCents * policy.rateBps + 5000) / 10000);
  return Math.max(policy.minCents, percent);
}

export type FeeLine = { unitPriceCents: number; quantity: number };

export type FeeBreakdown = {
  ticketsCents: number;
  feeCents: number;
  totalCents: number;
};

export function orderFeeBreakdown(lines: readonly FeeLine[], policy: ServiceFeePolicy): FeeBreakdown {
  let ticketsCents = 0;
  let feeCents = 0;
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    ticketsCents += line.unitPriceCents * line.quantity;
    feeCents += serviceFeeForPrice(line.unitPriceCents, policy) * line.quantity;
  }
  return { ticketsCents, feeCents, totalCents: ticketsCents + feeCents };
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

/** "R$ 50,00 + R$ 2,50 de taxa" (ou só o preço, com a taxa desligada). */
export function formatPricePlusFee(priceCents: number, feeCents: number): string {
  return feeCents > 0
    ? `${formatMoney(priceCents)} + ${formatMoney(feeCents)} de taxa`
    : formatMoney(priceCents);
}

/** Linha curta do preço de um tipo, já com a taxa da política vigente. */
export function priceWithFeeLabel(priceCents: number, policy: ServiceFeePolicy): string {
  return formatPricePlusFee(priceCents, serviceFeeForPrice(priceCents, policy));
}
