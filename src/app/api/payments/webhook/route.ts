import { NextResponse } from "next/server";

import { markOrderPaidIfPending } from "@/lib/domain/orders";
import { sendTicketsEmail } from "@/lib/email/send-tickets";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const provider = getPaymentProvider();
  const result = await provider.parseWebhook(request);

  if (result.kind === "ignored" || !result.externalId) {
    return NextResponse.json({ received: true });
  }

  const admin = createAdminClient();
  if (result.kind === "paid") {
    const outcome = await markOrderPaidIfPending(
      admin,
      result.externalId,
      provider.name,
    );

    if (outcome === "updated") {
      const { data: order, error: orderError } = await admin
        .from("orders")
        .select("buyer_email, buyer_name, public_token, event_id")
        .eq("payment_external_id", result.externalId)
        .eq("payment_provider", provider.name)
        .maybeSingle();

      if (orderError || !order) {
        console.error(
          "[email] Pedido pago, mas os dados para envio não foram encontrados.",
        );
      } else {
        const { data: event, error: eventError } = await admin
          .from("events")
          .select("name")
          .eq("id", order.event_id)
          .single();

        if (eventError) {
          console.error(
            "[email] Pedido pago, mas o evento para envio não foi encontrado.",
          );
        } else {
          await sendTicketsEmail({
            buyerEmail: order.buyer_email,
            buyerName: order.buyer_name,
            eventName: event.name,
            publicToken: order.public_token,
          });
        }
      }
    }

    return NextResponse.json({ received: true, outcome });
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .update({ status: "cancelado" })
    .eq("payment_external_id", result.externalId)
    .eq("payment_provider", provider.name)
    .eq("status", "pendente")
    .select("id")
    .maybeSingle();

  if (orderError) {
    throw new Error("Não foi possível cancelar o pedido.");
  }
  if (order) {
    const { error: ticketsError } = await admin
      .from("tickets")
      .update({
        status: "cancelado",
        cancelled_at: new Date().toISOString(),
      })
      .eq("order_id", order.id)
      .eq("status", "nao_pago");

    if (ticketsError) {
      throw new Error("Não foi possível cancelar os ingressos.");
    }
  }

  return NextResponse.json({
    received: true,
    outcome: order ? "updated" : "noop",
  });
}
