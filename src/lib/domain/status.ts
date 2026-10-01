export type TicketStatus = "nao_pago" | "pago" | "cancelado" | "check_in" | "estornado";

export type DecisionReason = "sem_vaga" | "pago_apos_cancelamento";

export function canEnter(status: TicketStatus): boolean {
  return status === "pago";
}

export function countsTowardCapacity(status: TicketStatus): boolean {
  return status === "pago" || status === "check_in";
}

const RECENT_PAYMENT_MS = 24 * 60 * 60 * 1000;

export function isRecentlyPaid(paidAt: string | null, now = Date.now()): boolean {
  if (!paidAt) return false;
  const paid = Date.parse(paidAt);
  return !Number.isNaN(paid) && now - paid < RECENT_PAYMENT_MS;
}

const decisionLabels: Record<DecisionReason, string> = {
  sem_vaga: "Pago sem vaga — decidir",
  pago_apos_cancelamento: "Pago após cancelamento — decidir",
};

/** Texto do pedido "aguardando decisão" conforme o motivo; motivo desconhecido cai no caso sem vaga. */
export function decisionLabel(reason: string | null | undefined): string {
  return reason === "pago_apos_cancelamento"
    ? decisionLabels.pago_apos_cancelamento
    : decisionLabels.sem_vaga;
}
