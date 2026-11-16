import "server-only";

import { ActionError } from "@/lib/action-result";
import { requireActor, requireEventAccess } from "@/lib/auth/actor";
import { UUID_PATTERN } from "@/lib/events/event-input";
import { sendOrderTicketsEmail } from "@/lib/payments/confirm-order";
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
  releaseRateLimit,
  tryConsumeRateLimit,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const RESEND_TICKETS_FALLBACK = "Não foi possível reenviar o e-mail do ingresso.";
export const RESEND_TICKETS_NOT_PAID = "Só é possível reenviar o e-mail de um pedido pago.";
export const RESEND_TICKETS_RATE_LIMITED =
  "Este e-mail já foi reenviado há pouco. Aguarde 2 minutos e tente de novo.";

/** Reenvia o e-mail de ingressos de um pedido pago. Equipe ou dono do evento. */
export async function resendOrderTicketsOrThrow(orderId: unknown): Promise<undefined> {
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
    throw new ActionError("Pedido inválido.");
  }

  await requireActor();

  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id, event_id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error("[email] Falha ao buscar o pedido para reenvio.", error.code ?? "sem-codigo");
    throw new ActionError(RESEND_TICKETS_FALLBACK);
  }
  if (!order) throw new ActionError("Pedido não encontrado.");

  await requireEventAccess(order.event_id);

  if (order.status !== "pago") throw new ActionError(RESEND_TICKETS_NOT_PAID);

  const limit = await tryConsumeRateLimit(admin, RATE_LIMITS.resendTicketsPerOrder, orderId);
  if (limit === "limited") throw new ActionError(RESEND_TICKETS_RATE_LIMITED);
  if (limit === "error") throw new ActionError(RATE_LIMIT_MESSAGE);

  const sent = await sendOrderTicketsEmail(admin, orderId);
  if (!sent) {
    await releaseRateLimit(admin, RATE_LIMITS.resendTicketsPerOrder, orderId);
    console.error("[email] Falha ao reenviar os ingressos.", { orderId });
    throw new ActionError(RESEND_TICKETS_FALLBACK);
  }
  return undefined;
}
