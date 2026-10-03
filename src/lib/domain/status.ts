export type TicketStatus = "nao_pago" | "pago" | "cancelado" | "check_in" | "estornado";

export type DecisionReason =
  | "sem_vaga"
  | "pago_apos_cancelamento"
  | "sessao_encerrada"
  | "sessao_cancelada";

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
  sessao_encerrada: "Pago após o fim das vendas — decidir",
  sessao_cancelada: "Pago em sessão cancelada — estornar",
};

function isDecisionReason(reason: string | null | undefined): reason is DecisionReason {
  return typeof reason === "string" && Object.hasOwn(decisionLabels, reason);
}

/** Texto do pedido "aguardando decisão" conforme o motivo; motivo desconhecido cai no caso sem vaga. */
export function decisionLabel(reason: string | null | undefined): string {
  return isDecisionReason(reason) ? decisionLabels[reason] : decisionLabels.sem_vaga;
}

/** Em sessão cancelada o pedido só pode ser estornado (o banco recusa "Aceitar mesmo assim"). */
export function canAcceptDecision(reason: string | null | undefined): boolean {
  return reason !== "sessao_cancelada";
}
