import { formatSessionShort } from "@/lib/datetime";
import { sessionName, wrongSessionMessage } from "@/lib/domain/sessions";

export type CheckInRejectionReason =
  | "evento_errado"
  | "sessao_errada"
  | "sessao_cancelada"
  | "nao_encontrado"
  | "nao_pago"
  | "cancelado"
  | "estornado"
  | "ja_usado"
  | "invalido";

export type OtherSession = {
  name?: string | null;
  startsAt?: string | null;
};

export function checkInMessage(
  reason: CheckInRejectionReason,
  otherEventName?: string | null,
  otherSession?: OtherSession,
): string {
  if (reason === "evento_errado") {
    const name = otherEventName?.trim();
    return name ? `Ingresso de outro evento: ${name}` : "Ingresso de outro evento";
  }
  if (reason === "sessao_errada") {
    return wrongSessionMessage(otherSession?.name ?? null, otherSession?.startsAt ?? null);
  }

  const messages: Record<
    Exclude<CheckInRejectionReason, "evento_errado" | "sessao_errada">,
    string
  > = {
    sessao_cancelada: "Sessão cancelada — não liberar entrada",
    nao_encontrado: "Ingresso não encontrado",
    nao_pago: "Ingresso não pago",
    cancelado: "Cancelado",
    estornado: "Estornado — não liberar entrada",
    ja_usado: "Já utilizado",
    invalido: "Ingresso inválido — não liberar entrada",
  };

  return messages[reason];
}

/** Linha do "Pode entrar": "Sessão infantil · sáb, 10/10 · 16h00 · Evento" (nome só se existir). */
export function checkInSessionLine(
  name: string | null | undefined,
  startsAt: string | null | undefined,
  eventName: string | null | undefined,
): string {
  return [sessionName(name), formatSessionShort(startsAt), eventName?.trim()]
    .filter(Boolean)
    .join(" · ");
}

const KNOWN_REJECTIONS: Record<string, CheckInRejectionReason> = {
  evento_errado: "evento_errado",
  sessao_errada: "sessao_errada",
  sessao_cancelada: "sessao_cancelada",
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
