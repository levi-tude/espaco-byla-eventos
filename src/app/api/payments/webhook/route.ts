import { NextResponse } from "next/server";

import { alertTeamSetup } from "@/lib/alerts/team-alert";
import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { getPaymentProvider } from "@/lib/payments/provider";
import { syncOrderRefunded } from "@/lib/payments/refund";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleWebhook(request: Request) {
  const provider = getPaymentProvider();
  const result = await provider.parseWebhook(request);

  if (result.kind === "not_configured") {
    console.error(
      "[pagamento] MERCADOPAGO_WEBHOOK_SECRET não configurado: aviso de pagamento recusado sem processar.",
    );
    await alertMissingWebhookSecret();
    // 503 (e não 401): o aviso pode ser legítimo e o Mercado Pago o reenvia depois.
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
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

async function alertMissingWebhookSecret() {
  try {
    await alertTeamSetup(
      createAdminClient(),
      "webhook_sem_chave",
      [
        "O Mercado Pago enviou um aviso de pagamento, mas o site está sem a chave secreta dos avisos e recusou o aviso por segurança.",
        "Os pagamentos continuam sendo confirmados quando o comprador fica na página do pedido, mas quem fecha a página antes pode ficar sem o ingresso até alguém conferir.",
        "Como resolver: no painel do Mercado Pago (Suas integrações → aplicação do site → Webhooks), copie a assinatura secreta e cadastre na Vercel como MERCADOPAGO_WEBHOOK_SECRET; depois faça um novo deploy.",
      ].join("\n\n"),
    );
  } catch (error) {
    console.error("[alerta] Falha ao preparar alerta de configuração.", {
      error: error instanceof Error ? error.name : "desconhecido",
    });
  }
}

export async function POST(request: Request) {
  return handleWebhook(request);
}

/** Mercado Pago também pode notificar via query string (IPN). */
export async function GET(request: Request) {
  return handleWebhook(request);
}
