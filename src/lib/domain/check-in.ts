export type CheckInRejectionReason =
  | "evento_errado"
  | "nao_encontrado"
  | "nao_pago"
  | "cancelado"
  | "estornado"
  | "ja_usado"
  | "invalido";

export function checkInMessage(
  reason: CheckInRejectionReason,
  otherEventName?: string | null,
): string {
  if (reason === "evento_errado") {
    const name = otherEventName?.trim();
    return name ? `Ingresso de outro evento: ${name}` : "Ingresso de outro evento";
  }

  const messages: Record<Exclude<CheckInRejectionReason, "evento_errado">, string> = {
    nao_encontrado: "Ingresso não encontrado",
    nao_pago: "Ingresso não pago",
    cancelado: "Cancelado",
    estornado: "Estornado — não liberar entrada",
    ja_usado: "Já utilizado",
    invalido: "Ingresso inválido — não liberar entrada",
  };

  return messages[reason];
}

const KNOWN_REJECTIONS: Record<string, CheckInRejectionReason> = {
  evento_errado: "evento_errado",
  nao_encontrado: "nao_encontrado",
  nao_pago: "nao_pago",
  cancelado: "cancelado",
  estornado: "estornado",
  ja_usado: "ja_usado",
};

/** Resultado de `check_in_ticket`: só "ok" libera; qualquer outro valor é recusado. */
export function parseCheckInOutcome(
  outcome: unknown,
): { ok: true } | { ok: false; reason: CheckInRejectionReason } {
  if (outcome === "ok") return { ok: true };
  return {
    ok: false,
    reason:
      typeof outcome === "string" && Object.hasOwn(KNOWN_REJECTIONS, outcome)
        ? KNOWN_REJECTIONS[outcome]
        : "invalido",
  };
}
