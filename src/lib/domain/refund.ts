export const REFUND_REASON_MIN = 5;
export const REFUND_REASON_MAX = 500;
/** Prazo do provedor para estornar, contado da aprovação do pagamento. */
export const REFUND_WINDOW_DAYS = 180;
export const REFUND_PROVIDER = "mercadopago";
export const COURTESY_PROVIDER = "cortesia_interna";
/** Motivo gravado quando o estorno foi feito direto no provedor, fora do site. */
export const EXTERNAL_REFUND_REASON = "Estornado fora do site";

export type RefundBlock = "check_in" | "prazo" | "provedor";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Por que o pedido não pode ser estornado pelo site (`null` = pode). O banco revalida. */
export function refundBlock(input: {
  paymentProvider: string | null;
  paidAt: string | null;
  hasCheckIn: boolean;
  now?: number;
}): RefundBlock | null {
  if (input.paymentProvider !== REFUND_PROVIDER) return "provedor";
  if (input.hasCheckIn) return "check_in";
  const paid = input.paidAt ? Date.parse(input.paidAt) : Number.NaN;
  if (Number.isFinite(paid) && (input.now ?? Date.now()) - paid > REFUND_WINDOW_DAYS * DAY_MS) {
    return "prazo";
  }
  return null;
}

const blockMessages: Record<RefundBlock, string> = {
  check_in: "Não é possível estornar: há ingresso com entrada registrada.",
  prazo: "Prazo do Mercado Pago encerrado (180 dias). Devolva por outro meio.",
  provedor: "Estorno pelo site indisponível para este pedido.",
};

export function refundBlockMessage(block: RefundBlock): string {
  return blockMessages[block];
}

export function normalizeRefundReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length >= REFUND_REASON_MIN && trimmed.length <= REFUND_REASON_MAX
    ? trimmed
    : null;
}

const INSUFFICIENT_BALANCE =
  "O Mercado Pago recusou: saldo insuficiente na conta para devolver. Adicione saldo e tente de novo.";
const NOT_REFUNDABLE =
  "O Mercado Pago não permite estornar este pagamento. Confira no painel do Mercado Pago.";

const rejectionMessages: Record<string, string> = {
  insufficient_money_for_refund: INSUFFICIENT_BALANCE,
  insufficient_money: INSUFFICIENT_BALANCE,
  insufficient_funds: INSUFFICIENT_BALANCE,
  refund_period_exceeded: blockMessages.prazo,
  refund_amount_exceeds:
    "O Mercado Pago informou que não há valor disponível para devolver neste pedido. Confira no painel do Mercado Pago.",
  payment_not_refundable: NOT_REFUNDABLE,
  amount_not_refundable: NOT_REFUNDABLE,
  max_refunds_exceeded: NOT_REFUNDABLE,
  cannot_refund_order: NOT_REFUNDABLE,
  provider_order_not_found:
    "Não encontramos o pagamento deste pedido no Mercado Pago. Ele pode já ter sido devolvido pelo painel do Mercado Pago; confira lá.",
  provider_amount_mismatch:
    "O valor cobrado no Mercado Pago não confere com o pedido. Estorne pelo painel do Mercado Pago.",
  not_configured: "Estorno indisponível: pagamento não configurado no servidor.",
};

const DEFAULT_REJECTION =
  "O Mercado Pago recusou o estorno. Confira no painel do Mercado Pago e tente de novo mais tarde.";

/** Mensagem para a equipe a partir do código de recusa do provedor. */
export function refundRejectionMessage(code: string | null | undefined): string {
  return (code && rejectionMessages[code]) || DEFAULT_REJECTION;
}

export type RefundStatus = "solicitado" | "concluido" | "falhou";

const refundStatusLabels: Record<RefundStatus, string> = {
  solicitado: "Em processamento",
  concluido: "Concluído",
  falhou: "Falhou",
};

export function refundStatusLabel(status: RefundStatus): string {
  return refundStatusLabels[status];
}
