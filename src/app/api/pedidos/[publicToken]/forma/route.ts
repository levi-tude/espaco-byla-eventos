import { NextResponse } from "next/server";

import { isPublicTokenFormat } from "@/lib/domain/public-token";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const GENERIC = "Não foi possível atualizar a forma de pagamento. Tente de novo.";
const METHOD_CHANGED =
  "Os valores do pedido mudaram. Confira o total antes de continuar.";

type Body = { method?: unknown };

function parseMethod(raw: unknown): "pix" | "card" | null {
  if (raw === "pix" || raw === "card") return raw;
  if (raw === "cartao") return "card";
  return null;
}

/**
 * Escolha Pix/cartão: só o método vem do cliente; totais são recalculados no banco.
 * Recusa troca se houver cobrança PIX ativa (ainda não expirada/cancelada).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ publicToken: string }> },
) {
  const { publicToken } = await context.params;
  if (!isPublicTokenFormat(publicToken)) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const method = parseMethod(body.method);
  if (!method) {
    return NextResponse.json({ error: "Escolha Pix ou cartão." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, status, total_cents, created_at, payment_method, expires_at")
    .eq("public_token", publicToken)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  if (order.status !== "pendente") {
    return NextResponse.json(
      { error: "Este pedido não aceita mais mudança de forma de pagamento." },
      { status: 409 },
    );
  }
  if (order.total_cents <= 0) {
    return NextResponse.json({ error: "Este pedido não precisa de pagamento." }, { status: 409 });
  }

  try {
    const provider = getPaymentProvider();
    const existing = await provider.findOrderPayment({
      id: order.id,
      createdAt: order.created_at,
    });
    if (existing.kind === "paid") {
      return NextResponse.json(
        { error: "Este pedido já foi pago." },
        { status: 409 },
      );
    }
    if (existing.kind === "pending_pix" && method !== "pix") {
      return NextResponse.json(
        {
          error:
            "Já existe um PIX em aberto neste pedido. Aguarde o vencimento ou cancele a seleção para pagar com cartão.",
        },
        { status: 409 },
      );
    }
  } catch (error) {
    console.error("[pagamento] Falha ao consultar cobrança antes de trocar a forma.", error);
    return NextResponse.json({ error: GENERIC }, { status: 502 });
  }

  const { data, error } = await admin.rpc("set_order_payment_method", {
    p_order_id: order.id,
    p_method: method,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.startsWith("FORMA_") || message.startsWith("PEDIDO") || message.startsWith("TAXA_")) {
      return NextResponse.json(
        { error: message.includes("EXPIRADO") ? "A reserva deste pedido expirou." : METHOD_CHANGED },
        { status: 409 },
      );
    }
    console.error("[pagamento] Falha ao definir forma de pagamento.", { code: error.code });
    return NextResponse.json({ error: GENERIC }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json({ error: GENERIC }, { status: 500 });
  }

  return NextResponse.json({
    paymentMethod: row.payment_method as "pix" | "card",
    serviceFeeCents: row.service_fee_cents as number,
    totalCents: row.total_cents as number,
    serviceFeeRateBps: row.service_fee_rate_bps as number,
  });
}
