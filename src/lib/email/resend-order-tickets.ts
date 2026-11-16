import "server-only";

import { ActionError } from "@/lib/action-result";
import { requireActor, requireEventAccess } from "@/lib/auth/actor";
import {
  RESEND_TICKETS_DAILY_LIMITED,
  RESEND_TICKETS_FALLBACK,
  RESEND_TICKETS_NOT_PAID,
  RESEND_TICKETS_RATE_LIMITED,
} from "@/lib/email/resend-order-tickets-messages";
import { UUID_PATTERN } from "@/lib/events/event-input";
import { sendOrderTicketsEmail } from "@/lib/payments/confirm-order";
import {
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
  releaseRateLimit,
  tryConsumeRateLimit,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export {
  RESEND_TICKETS_DAILY_LIMITED,
  RESEND_TICKETS_FALLBACK,
  RESEND_TICKETS_NOT_PAID,
  RESEND_TICKETS_RATE_LIMITED,
  RESEND_TICKETS_SENT,
} from "@/lib/email/resend-order-tickets-messages";

/** Reenvia o e-mail de ingressos de um pedido pago. Equipe ou dono do evento. */
export async function resendOrderTicketsOrThrow(orderId: unknown): Promise<undefined> {
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
    throw new ActionError("Pedido inválido.");
  }

  const actor = await requireActor();

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

  const shortWindow = await tryConsumeRateLimit(admin, RATE_LIMITS.resendTicketsPerOrder, orderId);
  if (shortWindow === "limited") throw new ActionError(RESEND_TICKETS_RATE_LIMITED);
  if (shortWindow === "error") throw new ActionError(RATE_LIMIT_MESSAGE);

  const daily = await tryConsumeRateLimit(admin, RATE_LIMITS.resendTicketsPerOrderDay, orderId);
  if (daily !== "allowed") {
    await releaseRateLimit(admin, RATE_LIMITS.resendTicketsPerOrder, orderId);
    if (daily === "limited") throw new ActionError(RESEND_TICKETS_DAILY_LIMITED);
    throw new ActionError(RATE_LIMIT_MESSAGE);
  }

  const sent = await sendOrderTicketsEmail(admin, orderId);
  if (!sent) {
    await releaseRateLimit(admin, RATE_LIMITS.resendTicketsPerOrder, orderId);
    await releaseRateLimit(admin, RATE_LIMITS.resendTicketsPerOrderDay, orderId);
    console.error("[email] Falha ao reenviar os ingressos.", { orderId });
    throw new ActionError(RESEND_TICKETS_FALLBACK);
  }

  console.info("[email] Ingressos reenviados.", { orderId, actorId: actor.userId });
  return undefined;
}
