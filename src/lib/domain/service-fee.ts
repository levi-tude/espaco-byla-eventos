/**
 * Taxa de serviço: mesma fórmula da função `service_fee_for_price` do banco, que é
 * a fonte da verdade. Aqui serve só para exibir; o servidor recalcula tudo.
 */

export type ServiceFeePolicy = {
  enabled: boolean;
  /**
   * Taxa usada no checkout / total “base” (cartão quando por forma; senão `rate_bps`).
   * Pontos-base: 100 = 1%.
   */
  rateBps: number;
  minCents: number;
  cardRateBps: number;
  pixRateBps: number;
  /** Quando false, as duas taxas efetivas são iguais a `rateBps` (comportamento antigo). */
  perMethodEnabled: boolean;
};

export const SERVICE_FEE_OFF: ServiceFeePolicy = {
  enabled: false,
  rateBps: 0,
  minCents: 0,
  cardRateBps: 0,
  pixRateBps: 0,
  perMethodEnabled: false,
};

export const SERVICE_FEE_LABEL = "Taxa de serviço";

export const SERVICE_FEE_HELP =
  "Valor cobrado para manter a venda on-line. É devolvido junto em qualquer estorno.";

export const SERVICE_FEE_CHANGED_MESSAGE =
  "Os valores foram atualizados. Confira o total antes de continuar.";

/** Selo curto no checkout (comprador); bate com 10% cartão − taxa Pix. */
export const PIX_OFF_LABEL = "4% de desconto";

/** Linha do resumo / e-mail quando o pagamento foi Pix. */
export const PIX_DISCOUNT_LINE_LABEL = "Desconto Pix";

export type PaymentMethodFee = "pix" | "card";

/** Percentual e mínimo que valem na compra (desligada = 0), enviados ao banco para conferir. */
export function effectiveFeeTerms(policy: ServiceFeePolicy): { rateBps: number; minCents: number } {
  return policy.enabled ? { rateBps: policy.rateBps, minCents: policy.minCents } : { rateBps: 0, minCents: 0 };
}

/** Taxa de uma unidade: max(mínimo, preço × percentual arredondado meio-para-cima). */
export function serviceFeeForPrice(priceCents: number, policy: ServiceFeePolicy): number {
  if (!policy.enabled || !Number.isInteger(priceCents) || priceCents <= 0) return 0;
  return serviceFeeForPriceAtRate(priceCents, policy.rateBps, policy.minCents);
}

/** Mesma fórmula com taxa explícita (Pix ou cartão). */
export function serviceFeeForPriceAtRate(
  priceCents: number,
  rateBps: number,
  minCents: number,
): number {
  if (!Number.isInteger(priceCents) || priceCents <= 0) return 0;
  if (!Number.isInteger(rateBps) || rateBps < 0) return 0;
  const percent = Math.floor((priceCents * rateBps + 5000) / 10000);
  return Math.max(Math.max(0, minCents), percent);
}

export function policyForMethod(
  policy: ServiceFeePolicy,
  method: PaymentMethodFee,
): ServiceFeePolicy {
  if (!policy.enabled) return SERVICE_FEE_OFF;
  const rateBps = method === "pix" ? policy.pixRateBps : policy.cardRateBps;
  return { ...policy, rateBps };
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

/** Totais Pix e cartão para o mesmo carrinho (quando a flag está ligada). */
export function dualMethodTotals(
  lines: readonly FeeLine[],
  policy: ServiceFeePolicy,
): { pix: FeeBreakdown; card: FeeBreakdown; savingsCents: number } {
  const pix = orderFeeBreakdown(lines, policyForMethod(policy, "pix"));
  const card = orderFeeBreakdown(lines, policyForMethod(policy, "card"));
  return { pix, card, savingsCents: Math.max(0, card.totalCents - pix.totalCents) };
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

/** Ex.: 1000 → "10"; 556 → "5,56". */
export function formatFeePercent(bps: number): string {
  const value = bps / 100;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(".", ",");
}

/** "R$ 50,00 + R$ 2,50 de taxa" (ou só o preço, com a taxa desligada). */
export function formatPricePlusFee(priceCents: number, feeCents: number): string {
  return feeCents > 0
    ? `${formatMoney(priceCents)} + ${formatMoney(feeCents)} de taxa`
    : formatMoney(priceCents);
}

/** Linha curta do preço de um tipo (sempre a taxa-base / cartão). */
export function priceWithFeeLabel(priceCents: number, policy: ServiceFeePolicy): string {
  return formatPricePlusFee(priceCents, serviceFeeForPrice(priceCents, policy));
}

/** Selo do Pix no checkout; o valor economizado aparece na linha "Desconto Pix". */
export function pixSavingsLabel(savingsCents: number): string {
  void savingsCents;
  return PIX_OFF_LABEL;
}

/**
 * Recibo / e-mail: taxa cheia (cartão) e, se pagou Pix, o desconto em reais.
 * O comprador nunca vê o percentual 5,56%.
 */
export function receiptFeeDisplay(input: {
  paymentMethod: string | null;
  ticketsSubtotalCents: number;
  totalCents: number;
  serviceFeeCents: number;
  serviceFeeRateBps: number | null;
  serviceFeeMinCents: number | null;
  cardRateBpsSnapshot: number | null;
  items: readonly { unitPriceCents: number; quantity: number }[];
}): { feeCents: number; pixDiscountCents: number } {
  const cardRate = input.cardRateBpsSnapshot ?? input.serviceFeeRateBps ?? 0;
  const minCents = input.serviceFeeMinCents ?? 0;
  let feeCents = input.serviceFeeCents;
  if (cardRate > 0 && input.items.length > 0) {
    feeCents = input.items.reduce(
      (sum, item) =>
        sum + serviceFeeForPriceAtRate(item.unitPriceCents, cardRate, minCents) * item.quantity,
      0,
    );
  }
  const pixDiscountCents =
    input.paymentMethod === "pix"
      ? Math.max(0, input.ticketsSubtotalCents + feeCents - input.totalCents)
      : 0;
  return { feeCents, pixDiscountCents };
}
