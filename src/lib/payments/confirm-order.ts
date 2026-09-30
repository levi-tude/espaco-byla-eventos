import "server-only";

import {
  markOrderPaidIfPending,
  type PaidOrderOutcome,
  type SupabaseAdmin,
} from "@/lib/domain/orders";
import { sendTicketsEmail } from "@/lib/email/send-tickets";

/** Marca o pedido como pago e envia os ingressos por e-mail na primeira confirmação. */
export async function confirmOrderPaid(
  admin: SupabaseAdmin,
  orderId: string,
  providerName: string,
): Promise<PaidOrderOutcome> {
  const outcome = await markOrderPaidIfPending(admin, orderId, providerName);
  if (outcome === "noop") return outcome;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("buyer_email, buyer_name, public_token, event_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error(
      "[email] Pedido pago, mas os dados para envio não foram encontrados.",
    );
    return outcome;
  }

  const [eventResult, ticketsResult] = await Promise.all([
    admin
      .from("events")
      .select("name, venue, starts_at")
      .eq("id", order.event_id)
      .single(),
    admin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId),
  ]);

  if (eventResult.error || !eventResult.data) {
    console.error(
      "[email] Pedido pago, mas o evento para envio não foi encontrado.",
    );
    return outcome;
  }

  const event = eventResult.data;

  await sendTicketsEmail({
    buyerEmail: order.buyer_email,
    buyerName: order.buyer_name,
    eventName: event.name,
    venue: event.venue,
    startsAt: event.starts_at,
    ticketCount: ticketsResult.count ?? 1,
    publicToken: order.public_token,
  });

  return outcome;
}
