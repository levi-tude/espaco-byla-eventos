import { NextResponse } from "next/server";

import {
  cancelOrderIfPending,
  markOrderPaidIfPending,
} from "@/lib/domain/orders";
import { sendTicketsEmail } from "@/lib/email/send-tickets";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

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

    if (outcome === "updated" || outcome === "repaired") {
      const orderQuery = admin
        .from("orders")
        .select("buyer_email, buyer_name, public_token, event_id")
        .eq("payment_provider", provider.name);

      const { data: order, error: orderError } = await (
        isUuid(result.externalId)
          ? orderQuery.or(
              `payment_external_id.eq.${result.externalId},id.eq.${result.externalId}`,
            )
          : orderQuery.eq("payment_external_id", result.externalId)
      ).maybeSingle();

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

  const outcome = await cancelOrderIfPending(
    admin,
    result.externalId,
    provider.name,
  );

  return NextResponse.json({
    received: true,
    outcome,
  });
}
