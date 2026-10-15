"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { normalizeRefundReason } from "@/lib/domain/refund";
import { notifyOrganizerOrderRefunded } from "@/lib/organizer/refund-notice";
import { captureOrderFee } from "@/lib/payments/capture-fee";
import { sendOrderTicketsEmail } from "@/lib/payments/confirm-order";
import { getPaymentProvider } from "@/lib/payments/provider";
import { refundPaidOrder, type RefundOutcome } from "@/lib/payments/refund";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AcceptPaidOrderResult = {
  alreadyAccepted: boolean;
  emailSent: boolean;
};

/** "Aceitar mesmo assim": libera os ingressos de um pedido pago que aguarda decisão. */
export async function acceptPaidOrder(
  orderId: string,
): Promise<ActionResult<AcceptPaidOrderResult>> {
  return runAction(
    () => acceptPaidOrderOrThrow(orderId),
    "Não foi possível aceitar o pedido.",
  );
}

async function acceptPaidOrderOrThrow(orderId: unknown): Promise<AcceptPaidOrderResult> {
  const { userId } = await requireStaffUser();
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
    throw new ActionError("Pedido inválido.");
  }

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("event_id, events(slug)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new ActionError("Pedido não encontrado.");

  const { data, error } = await admin.rpc("accept_paid_order", {
    p_order_id: orderId,
    p_staff_user_id: userId,
  });
  if (error) {
    if (error.message.includes("não está aguardando decisão")) {
      throw new ActionError("Este pedido já foi resolvido. Atualize a página.");
    }
    if (error.message.includes("SESSAO_CANCELADA")) {
      throw new ActionError("Sessão cancelada: este pedido só pode ser estornado.");
    }
    throw new Error(`accept_paid_order falhou: ${error.message}`);
  }
  if (data !== "accepted" && data !== "noop") {
    throw new Error("Resposta inválida ao aceitar o pedido.");
  }

  let emailSent = true;
  if (data === "accepted") {
    emailSent = await sendOrderTicketsEmail(admin, orderId);
    try {
      await captureOrderFee(admin, orderId);
    } catch {
      console.error("[tarifa] Falha ao capturar a tarifa após aceitar o pedido.", { orderId });
    }
  }

  const event = Array.isArray(order.events) ? order.events[0] : order.events;
  revalidatePath(`/equipe/eventos/${order.event_id}`);
  if (event?.slug) revalidatePath(`/eventos/${event.slug}`);

  return { alreadyAccepted: data === "noop", emailSent };
}

/**
 * "Estornar pedido": devolve 100% do pedido inteiro. Também serve para conferir um
 * estorno "em processamento" (a nova tentativa reusa a mesma chave no provedor).
 */
export async function refundOrder(
  orderId: string,
  reason: string,
): Promise<ActionResult<RefundOutcome>> {
  return runAction(
    () => refundOrderOrThrow(orderId, reason),
    "Não foi possível estornar o pedido.",
  );
}

async function refundOrderOrThrow(orderId: unknown, reason: unknown): Promise<RefundOutcome> {
  const { userId } = await requireStaffUser();
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
    throw new ActionError("Pedido inválido.");
  }
  const normalizedReason = normalizeRefundReason(reason);
  if (!normalizedReason) {
    throw new ActionError("Escreva o motivo do estorno (de 5 a 500 caracteres).");
  }

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("event_id, public_token, events(slug, name, organizer_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new ActionError("Pedido não encontrado.");
  const event = Array.isArray(order.events) ? order.events[0] : order.events;

  let outcome: RefundOutcome;
  try {
    outcome = await refundPaidOrder(admin, getPaymentProvider(), {
      orderId,
      staffUserId: userId,
      reason: normalizedReason,
    });
  } finally {
    revalidatePath(`/equipe/eventos/${order.event_id}`);
    revalidatePath(`/pedidos/${order.public_token}`);
    if (event?.slug) revalidatePath(`/eventos/${event.slug}`);
    if (event?.organizer_id) revalidatePath(`/organizador/eventos/${order.event_id}`);
  }

  if (outcome.status === "refunded" && event?.organizer_id) {
    await notifyOrganizerOrderRefunded(admin, orderId);
  }
  return outcome;
}

