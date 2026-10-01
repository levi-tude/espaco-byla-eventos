import { NextResponse } from "next/server";

import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { getPaymentProvider } from "@/lib/payments/provider";
import { syncOrderRefunded } from "@/lib/payments/refund";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleWebhook(request: Request) {
  const provider = getPaymentProvider();
  const result = await provider.parseWebhook(request);

  if (result.kind === "invalid_signature") {
    console.warn("[pagamento] Aviso de pagamento com assinatura inválida recusado.");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (result.kind === "refunded") {
    const outcome = await syncOrderRefunded(
      createAdminClient(),
      result.externalId,
      provider.name,
      result.providerOrderId,
    );
    return NextResponse.json({ received: true, outcome });
  }
  if (result.kind !== "paid") {
    return NextResponse.json({ received: true });
  }

  const outcome = await confirmOrderPaid(
    createAdminClient(),
    result.externalId,
    provider.name,
    result.amountCents,
    { providerOrderId: result.providerOrderId, providerPaymentId: result.providerPaymentId },
  );
  return NextResponse.json({ received: true, outcome });
}

export async function POST(request: Request) {
  return handleWebhook(request);
}

/** Mercado Pago também pode notificar via query string (IPN). */
export async function GET(request: Request) {
  return handleWebhook(request);
}
