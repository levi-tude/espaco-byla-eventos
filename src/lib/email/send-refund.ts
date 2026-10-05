import "server-only";

import { buildRefundEmail, type RefundEmailData } from "@/lib/email/refund-template";
import { createAdminClient } from "@/lib/supabase/admin";

export type SendRefundEmailInput = Omit<RefundEmailData, "orderUrl"> & {
  buyerEmail: string;
  publicToken: string;
};

export type SendRefundEmailResult = "sent" | "skipped" | "failed";

/** Taxa gravada no pedido; sem ela o e-mail só não menciona a taxa. */
async function orderServiceFeeCents(publicToken: string): Promise<number> {
  try {
    const { data, error } = await createAdminClient()
      .from("orders")
      .select("service_fee_cents")
      .eq("public_token", publicToken)
      .maybeSingle();
    return error || !data ? 0 : data.service_fee_cents;
  } catch {
    return 0;
  }
}

export async function sendRefundEmail({
  buyerEmail,
  publicToken,
  ...details
}: SendRefundEmailInput): Promise<SendRefundEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

  if (!apiKey || !from || !appUrl) {
    console.warn(
      "[email] Aviso de estorno não enviado: configure RESEND_API_KEY, RESEND_FROM_EMAIL e NEXT_PUBLIC_APP_URL.",
    );
    return "skipped";
  }

  const orderUrl = `${appUrl}/pedidos/${encodeURIComponent(publicToken)}`;

  try {
    const serviceFeeCents =
      details.serviceFeeCents ?? (await orderServiceFeeCents(publicToken));
    const { subject, html, text } = buildRefundEmail({ ...details, serviceFeeCents, orderUrl });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [buyerEmail], subject, html, text }),
    });

    if (!response.ok) {
      console.error(`[email] Resend recusou o aviso de estorno (${response.status}).`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("[email] Falha ao enviar o aviso de estorno.", error);
    return "failed";
  }
}
