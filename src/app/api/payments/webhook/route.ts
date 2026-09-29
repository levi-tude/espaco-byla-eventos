import { NextResponse } from "next/server";

import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleWebhook(request: Request) {
  const provider = getPaymentProvider();
  const result = await provider.parseWebhook(request);

  if (result.kind !== "paid") {
    return NextResponse.json({ received: true });
  }

  const outcome = await confirmOrderPaid(
    createAdminClient(),
    result.externalId,
    provider.name,
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
