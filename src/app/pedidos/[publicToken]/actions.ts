"use server";

import type { PaidOrderOutcome } from "@/lib/domain/orders";
import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { extendHoldForPix } from "@/lib/payments/pix-hold";
import { getPaymentProvider } from "@/lib/payments/provider";
import type { CardPaymentType, PixData } from "@/lib/payments/types";
import { BOT_BLOCKED_MESSAGE, isBotRequest } from "@/lib/security/bot";
import {
  clientIp,
  consumeRateLimit,
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type PaymentSubmission = {
  paymentMethodId: string;
  paymentType?: string;
  cardToken?: string;
  installments?: number;
  email?: string;
  identification?: { type?: string; number?: string };
};

export type PayOrderResult =
  | { status: "paid" }
  | { status: "pix"; pix: PixData; holdExpiresAt: string | null }
  | { status: "processing" }
  | { status: "rejected"; message: string }
  | { status: "unavailable"; message: string };

export type OrderPaymentStatus = "paid" | "pending" | "unavailable";

const GENERIC_FAILURE =
  "Não foi possível processar o pagamento agora. Tente novamente em instantes.";

const AWAITING_DECISION_MESSAGE =
  "Recebemos seu pagamento. Nossa equipe vai conferir o pedido e avisar você por e-mail.";

const PIX_ALREADY_USED_MESSAGE =
  "O PIX deste pedido venceu. Pague com cartão ou faça uma nova compra.";

async function loadOrder(publicToken: string) {
  if (typeof publicToken !== "string" || !publicToken || publicToken.length > 100) {
    return null;
  }
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select(
      "id, event_id, status, total_cents, buyer_email, expires_at, created_at, hold_extended_at",
    )
    .eq("public_token", publicToken)
    .maybeSingle();
  return order ? { admin, order } : null;
}

function isExpired(expiresAt: string | null) {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}

function needsDecision(outcome: PaidOrderOutcome) {
  return (
    outcome === "needs_decision_capacity" || outcome === "needs_decision_cancelled"
  );
}

function paidResult(outcome: PaidOrderOutcome): PayOrderResult {
  return needsDecision(outcome)
    ? { status: "unavailable", message: AWAITING_DECISION_MESSAGE }
    : { status: "paid" };
}

function sanitizeSubmission(raw: PaymentSubmission, fallbackEmail: string) {
  const paymentMethodId =
    typeof raw?.paymentMethodId === "string" ? raw.paymentMethodId.trim() : "";
  if (!/^[a-z0-9_]{2,40}$/i.test(paymentMethodId)) return null;

  const email =
    typeof raw.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim())
      ? raw.email.trim().toLowerCase()
      : fallbackEmail;

  const idType = raw.identification?.type?.trim().toUpperCase();
  const idNumber = raw.identification?.number?.replace(/\D/g, "");
  const identification =
    (idType === "CPF" || idType === "CNPJ") && idNumber
      ? { type: idType, number: idNumber }
      : undefined;

  if (paymentMethodId === "pix") {
    return { paymentMethodId, payer: { email, identification } };
  }

  const cardToken =
    typeof raw.cardToken === "string" && raw.cardToken.length <= 200
      ? raw.cardToken
      : "";
  if (!cardToken) return null;

  const installments = Number.isInteger(raw.installments)
    ? Math.min(12, Math.max(1, raw.installments!))
    : 1;
  const cardType: CardPaymentType =
    raw.paymentType === "debit_card" ? "debit_card" : "credit_card";

  return {
    paymentMethodId,
    cardToken,
    cardType,
    installments,
    payer: { email, identification },
  };
}

export async function payOrder(
  publicToken: string,
  submission: PaymentSubmission,
): Promise<PayOrderResult> {
  if (await isBotRequest()) {
    return { status: "rejected", message: BOT_BLOCKED_MESSAGE };
  }

  const loaded = await loadOrder(publicToken);
  if (!loaded) {
    return { status: "unavailable", message: "Pedido não encontrado." };
  }
  const { admin, order } = loaded;

  if (order.status === "pago") return { status: "paid" };
  if (order.status === "aguardando_decisao") {
    return { status: "unavailable", message: AWAITING_DECISION_MESSAGE };
  }
  if (order.status !== "pendente") {
    return {
      status: "unavailable",
      message: "Este pedido foi cancelado ou expirou. Faça uma nova compra.",
    };
  }

  const provider = getPaymentProvider();
  const payment = sanitizeSubmission(submission, order.buyer_email);
  if (!payment) {
    return {
      status: "rejected",
      message: "Dados de pagamento inválidos. Preencha novamente.",
    };
  }

  try {
    const existing = await provider.findOrderPayment({
      id: order.id,
      createdAt: order.created_at,
    });
    if (existing.kind === "paid") {
      return paidResult(
        await confirmOrderPaid(admin, order.id, provider.name, existing.amountCents, existing),
      );
    }
    if (existing.kind === "pending_pix" && payment.paymentMethodId === "pix") {
      const holdExpiresAt = await extendHoldForPix(admin, order.id, existing.pix);
      return { status: "pix", pix: existing.pix, holdExpiresAt };
    }

    if (isExpired(order.expires_at)) {
      return {
        status: "unavailable",
        message: "O tempo para pagar este pedido acabou. Faça uma nova compra.",
      };
    }
    // A reserva só acompanha um PIX; vencido, não se gera outro.
    if (payment.paymentMethodId === "pix" && order.hold_extended_at) {
      return { status: "rejected", message: PIX_ALREADY_USED_MESSAGE };
    }

    const withinLimits =
      (await consumeRateLimit(admin, RATE_LIMITS.paymentPerOrder, order.id)) &&
      (await consumeRateLimit(admin, RATE_LIMITS.paymentPerIp, await clientIp()));
    if (!withinLimits) return { status: "rejected", message: RATE_LIMIT_MESSAGE };

    const { data: event } = await admin
      .from("events")
      .select("name")
      .eq("id", order.event_id)
      .single();

    const result = await provider.createPayment({
      orderId: order.id,
      amountCents: order.total_cents,
      description: `Ingressos — ${event?.name ?? "Espaço Byla"}`,
      ...payment,
    });

    if (result.status === "approved") {
      return paidResult(
        await confirmOrderPaid(admin, order.id, provider.name, order.total_cents, {
          providerOrderId: result.providerOrderId ?? result.paymentId,
          providerPaymentId: result.providerPaymentId,
        }),
      );
    }
    if (result.status === "pending") {
      if (!result.pix) return { status: "processing" };
      const holdExpiresAt = await extendHoldForPix(admin, order.id, result.pix);
      return { status: "pix", pix: result.pix, holdExpiresAt };
    }
    return { status: "rejected", message: result.reason };
  } catch (error) {
    console.error("[pagamento] Falha ao processar pagamento.", error);
    return { status: "rejected", message: GENERIC_FAILURE };
  }
}

export async function checkOrderPayment(
  publicToken: string,
): Promise<OrderPaymentStatus> {
  if (await isBotRequest()) return "pending";

  const loaded = await loadOrder(publicToken);
  if (!loaded) return "unavailable";
  const { admin, order } = loaded;

  if (order.status === "pago") return "paid";
  if (order.status !== "pendente" && order.status !== "expirado") return "unavailable";

  const provider = getPaymentProvider();
  try {
    const existing = await provider.findOrderPayment({
      id: order.id,
      createdAt: order.created_at,
    });
    if (existing.kind === "paid") {
      const outcome = await confirmOrderPaid(
        admin,
        order.id,
        provider.name,
        existing.amountCents,
        existing,
      );
      return needsDecision(outcome) ? "unavailable" : "paid";
    }
  } catch (error) {
    console.error("[pagamento] Falha ao consultar pagamento.", error);
  }
  return order.status === "expirado" ? "unavailable" : "pending";
}
