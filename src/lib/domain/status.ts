export type TicketStatus = "nao_pago" | "pago" | "cancelado" | "check_in";

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
