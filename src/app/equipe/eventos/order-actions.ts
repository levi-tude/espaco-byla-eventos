"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { sendOrderTicketsEmail } from "@/lib/payments/confirm-order";
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
    throw new Error(`accept_paid_order falhou: ${error.message}`);
  }
  if (data !== "accepted" && data !== "noop") {
    throw new Error("Resposta inválida ao aceitar o pedido.");
  }

  const emailSent =
    data === "accepted" ? await sendOrderTicketsEmail(admin, orderId) : true;

  const event = Array.isArray(order.events) ? order.events[0] : order.events;
  revalidatePath(`/equipe/eventos/${order.event_id}`);
  if (event?.slug) revalidatePath(`/eventos/${event.slug}`);

  return { alreadyAccepted: data === "noop", emailSent };
}
