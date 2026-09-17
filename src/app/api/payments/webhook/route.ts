import { NextResponse } from "next/server";

import { markOrderPaidIfPending } from "@/lib/domain/orders";
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
