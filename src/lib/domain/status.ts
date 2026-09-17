export type TicketStatus = "nao_pago" | "pago" | "cancelado" | "check_in";

export function canEnter(status: TicketStatus): boolean {
  return status === "pago";
}

export function countsTowardCapacity(status: TicketStatus): boolean {
  return status === "pago" || status === "check_in";
}
