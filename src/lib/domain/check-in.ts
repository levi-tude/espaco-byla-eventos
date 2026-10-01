export type CheckInRejectionReason =
  | "evento_errado"
  | "nao_pago"
  | "cancelado"
  | "estornado"
  | "ja_usado"
  | "invalido";

export function checkInMessage(reason: CheckInRejectionReason): string {
  const messages: Record<CheckInRejectionReason, string> = {
    evento_errado: "Evento errado",
    nao_pago: "Ingresso não pago",
    cancelado: "Cancelado",
    estornado: "Estornado — não liberar entrada",
    ja_usado: "Já utilizado",
    invalido: "Ingresso inválido — não liberar entrada",
  };

  return messages[reason];
}

const KNOWN_REJECTIONS: Record<string, CheckInRejectionReason> = {
  check_in: "ja_usado",
  cancelado: "cancelado",
  nao_pago: "nao_pago",
  estornado: "estornado",
};

/** Lista de permitidos: só `pago` entra; status desconhecido é recusado. */
export function evaluateCheckIn(input: {
  ticketEventId: string;
  eventId: string;
  status: string;
}): { ok: true } | { ok: false; reason: CheckInRejectionReason } {
  if (input.ticketEventId !== input.eventId) return { ok: false, reason: "evento_errado" };
  if (input.status === "pago") return { ok: true };
  return {
    ok: false,
    reason: Object.hasOwn(KNOWN_REJECTIONS, input.status)
      ? KNOWN_REJECTIONS[input.status]
      : "invalido",
  };
}
