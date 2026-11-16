import {
  RESEND_TICKETS_FALLBACK,
  RESEND_TICKETS_RATE_LIMITED,
  RESEND_TICKETS_SENT,
} from "@/lib/email/resend-order-tickets-messages";

export const RESEND_TICKETS_IDLE_LABEL = "Reenviar ingresso";
export const RESEND_TICKETS_PENDING_LABEL = "Reenviando…";
export const RESEND_TICKETS_SUCCESS_LABEL = "Reenviado ✓";
export const RESEND_TICKETS_WAIT_LABEL = "Aguarde para reenviar";

/** Tempo em que o botão fica "Reenviado ✓" depois do sucesso. */
export const RESEND_SUCCESS_HOLD_MS = 8_000;
/** Cooldown visual alinhado ao limite de 1 reenvio a cada 2 minutos. */
export const RESEND_RATE_LIMIT_HOLD_MS = 120_000;
/** Mantém o erro visível além de um ciclo de atualização automática de 30 s. */
export const RESEND_ERROR_HOLD_MS = 60_000;

export type ResendTicketsFeedbackKind = "success" | "error" | "rate-limited";

export type ResendTicketsFeedback = {
  kind: ResendTicketsFeedbackKind;
  text: string;
  startedAt: number;
  holdMs: number;
};

const entries = new Map<string, ResendTicketsFeedback>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Assina mudanças do estado de reenvio (sobrevive a um remount no refresh de 30 s). */
export function subscribeResendTicketsFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getResendTicketsFeedbackSnapshot(orderId: string): ResendTicketsFeedback | null {
  return entries.get(orderId) ?? null;
}

/** No servidor o mapa está vazio; evita divergência na hidratação. */
export function getResendTicketsFeedbackServerSnapshot(): null {
  return null;
}

export function setResendTicketsFeedback(orderId: string, feedback: ResendTicketsFeedback): void {
  entries.set(orderId, feedback);
  emit();
}

export function clearResendTicketsFeedback(orderId: string): void {
  if (!entries.delete(orderId)) return;
  emit();
}

/** Remove entradas vencidas e avisa os assinantes. */
export function clearExpiredResendTicketsFeedback(now = Date.now()): void {
  let changed = false;
  for (const [orderId, feedback] of entries) {
    if (now >= feedback.startedAt + feedback.holdMs) {
      entries.delete(orderId);
      changed = true;
    }
  }
  if (changed) emit();
}

/** Esvazia o mapa (só para testes). */
export function resetResendTicketsFeedbackForTests(): void {
  if (entries.size === 0) return;
  entries.clear();
  emit();
}

export function feedbackFromResendResult(
  ok: boolean,
  error: string | undefined,
  now = Date.now(),
): ResendTicketsFeedback {
  if (ok) {
    return {
      kind: "success",
      text: RESEND_TICKETS_SENT,
      startedAt: now,
      holdMs: RESEND_SUCCESS_HOLD_MS,
    };
  }
  if (error === RESEND_TICKETS_RATE_LIMITED) {
    return {
      kind: "rate-limited",
      text: error,
      startedAt: now,
      holdMs: RESEND_RATE_LIMIT_HOLD_MS,
    };
  }
  return {
    kind: "error",
    text: error ?? RESEND_TICKETS_FALLBACK,
    startedAt: now,
    holdMs: RESEND_ERROR_HOLD_MS,
  };
}

export function resendTicketsButtonLabel(input: {
  pending: boolean;
  feedback: ResendTicketsFeedback | null;
}): string {
  if (input.pending) return RESEND_TICKETS_PENDING_LABEL;
  if (input.feedback?.kind === "success") return RESEND_TICKETS_SUCCESS_LABEL;
  if (input.feedback?.kind === "rate-limited") return RESEND_TICKETS_WAIT_LABEL;
  return RESEND_TICKETS_IDLE_LABEL;
}

export function resendTicketsButtonDisabled(input: {
  pending: boolean;
  feedback: ResendTicketsFeedback | null;
}): boolean {
  if (input.pending) return true;
  return input.feedback?.kind === "success" || input.feedback?.kind === "rate-limited";
}

export function remainingResendHoldMs(feedback: ResendTicketsFeedback, now = Date.now()): number {
  return Math.max(0, feedback.startedAt + feedback.holdMs - now);
}
