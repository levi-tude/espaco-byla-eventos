import type { TicketStatus } from "./status";

export type CheckInRejectionReason =
  | "evento_errado"
  | "nao_pago"
  | "cancelado"
  | "ja_usado";

export function checkInMessage(reason: CheckInRejectionReason): string {
  const messages: Record<CheckInRejectionReason, string> = {
    evento_errado: "Evento errado",
    nao_pago: "Ingresso não pago",
    cancelado: "Cancelado",
    ja_usado: "Já utilizado",
  };

  return messages[reason];
}

export function evaluateCheckIn(input: {
  ticketEventId: string;
  eventId: string;
  status: TicketStatus;
}): { ok: true } | { ok: false; reason: CheckInRejectionReason } {
  if (input.ticketEventId !== input.eventId) return { ok: false, reason: "evento_errado" };
  if (input.status === "check_in") return { ok: false, reason: "ja_usado" };
  if (input.status === "cancelado") return { ok: false, reason: "cancelado" };
  if (input.status === "nao_pago") return { ok: false, reason: "nao_pago" };
  return { ok: true };
}
