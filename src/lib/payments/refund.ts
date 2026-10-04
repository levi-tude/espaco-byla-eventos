import "server-only";

import { ActionError } from "@/lib/action-result";
import { alertTeam } from "@/lib/alerts/team-alert";
import type { SupabaseAdmin } from "@/lib/domain/orders";
import { refundBlockMessage, refundRejectionMessage } from "@/lib/domain/refund";
import { sendRefundEmail } from "@/lib/email/send-refund";
import { runSessionNotices } from "@/lib/notices/process";
import type { PaymentProvider } from "@/lib/payments/provider";
import { orderItemName, ticketTypeLabel } from "@/lib/domain/ticket-types";

export type RefundOutcome =
  | { status: "refunded"; emailSent: boolean }
  | { status: "processing" };

type BeginRefundRow = {
  refund_id: string;
  idempotency_key: string;
  amount_cents: number;
  provider_order_id: string | null;
  already_requested: boolean;
};

const BEGIN_ERRORS: Record<string, string> = {
  ESTORNO_EQUIPE: "Acesso restrito à equipe.",
  ESTORNO_PEDIDO: "Pedido não encontrado.",
  ESTORNO_JA_FEITO: "Este pedido já foi estornado. Atualize a página.",
  ESTORNO_PROVEDOR: refundBlockMessage("provedor"),
  ESTORNO_STATUS: "Só pedidos pagos podem ser estornados. Atualize a página.",
  ESTORNO_CHECK_IN: refundBlockMessage("check_in"),
  ESTORNO_PRAZO: refundBlockMessage("prazo"),
  ESTORNO_MOTIVO: "Escreva o motivo do estorno (de 5 a 500 caracteres).",
};

/**
 * Erro esperado do estorno, com o motivo em código para quem precisa decidir o que
 * fazer em seguida (o "Estornar todos" separa "pular" de "falhou").
 * `blocked`: o banco recusou começar (prefixo ESTORNO_*); `rejected`: o provedor recusou.
 */
export class RefundActionError extends ActionError {
  constructor(
    message: string,
    readonly kind: "blocked" | "rejected",
    readonly code: string,
  ) {
    super(message);
  }
}

function beginError(message: string): Error {
  const prefix = message.match(/^(ESTORNO_[A-Z_]+):/)?.[1];
  if (prefix && BEGIN_ERRORS[prefix]) return new RefundActionError(BEGIN_ERRORS[prefix], "blocked", prefix);
  return new Error(`begin_order_refund falhou: ${message}`);
}

/**
 * Estorna o pedido inteiro (100%, valor decidido no banco). A chave de idempotência
 * vem do banco e é a mesma em toda nova tentativa do mesmo estorno, então dois
 * cliques ou duas abas nunca devolvem duas vezes. Recusa do provedor desfaz o
 * congelamento; resposta incerta deixa "em processamento" para conferir depois.
 */
export async function refundPaidOrder(
  admin: SupabaseAdmin,
  provider: PaymentProvider,
  input: { orderId: string; staffUserId: string; reason: string },
): Promise<RefundOutcome> {
  const { data, error } = await admin.rpc("begin_order_refund", {
    p_order_id: input.orderId,
    p_staff_user_id: input.staffUserId,
    p_reason: input.reason,
  });
  if (error) throw beginError(error.message);
  const refund = (Array.isArray(data) ? data[0] : data) as BeginRefundRow | undefined;
  if (!refund?.refund_id || !refund.idempotency_key) {
    throw new Error("Resposta inválida ao iniciar o estorno.");
  }

  let providerOrderId = refund.provider_order_id;
  if (!providerOrderId) {
    const recovered = await recoverProviderOrderId(
      admin,
      provider,
      input.orderId,
      refund.amount_cents,
    );
    if ("code" in recovered) {
      return rejectRefund(admin, input.orderId, refund.refund_id, recovered.code);
    }
    providerOrderId = recovered.providerOrderId;
  }

  const result = await provider.refundOrder({
    providerOrderId,
    idempotencyKey: refund.idempotency_key,
  });

  if (result.status === "rejected") {
    return rejectRefund(admin, input.orderId, refund.refund_id, result.code);
  }
  if (result.status === "pending") {
    console.warn("[estorno] Resposta incerta do provedor; estorno em processamento.", {
      orderId: input.orderId,
      refundId: refund.refund_id,
    });
    return { status: "processing" };
  }

  const { data: completed, error: completeError } = await admin.rpc(
    "complete_order_refund",
    {
      p_refund_id: refund.refund_id,
      p_provider_refund_id: result.providerRefundId ?? null,
    },
  );
  if (completeError) {
    // O dinheiro já voltou; o estorno segue "solicitado" e a próxima tentativa
    // (mesma chave) ou o aviso do provedor concluem.
    console.error("[estorno] Estorno feito no provedor, mas não foi registrado.", {
      orderId: input.orderId,
      refundId: refund.refund_id,
    });
    return { status: "processing" };
  }

  const emailSent =
    completed === "completed" ? await notifyBuyerRefunded(admin, input.orderId) : true;
  return { status: "refunded", emailSent };
}

async function rejectRefund(
  admin: SupabaseAdmin,
  orderId: string,
  refundId: string,
  code: string,
): Promise<never> {
  const { error } = await admin.rpc("fail_order_refund", {
    p_refund_id: refundId,
    p_error_code: code,
  });
  if (error) {
    throw new Error(`fail_order_refund falhou: ${error.message}`);
  }
  console.warn("[estorno] Provedor recusou o estorno.", { orderId, refundId, code });
  await alertTeam(
    admin,
    "estorno_falhou",
    orderId,
    `Motivo informado: ${refundRejectionMessage(code)} (código: ${code}). O pedido voltou ao estado anterior e os ingressos continuam como estavam.`,
  );
  throw new RefundActionError(refundRejectionMessage(code), "rejected", code);
}

/** Pedidos pagos antes da fase 2 não guardaram a order do provedor: busca e grava. */
async function recoverProviderOrderId(
  admin: SupabaseAdmin,
  provider: PaymentProvider,
  orderId: string,
  amountCents: number,
): Promise<{ providerOrderId: string } | { code: string }> {
  const { data: order } = await admin
    .from("orders")
    .select("created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { code: "provider_order_not_found" };

  const found = await provider
    .findOrderPayment({ id: orderId, createdAt: order.created_at })
    .catch(() => null);
  if (found?.kind !== "paid" || !found.providerOrderId) {
    return { code: "provider_order_not_found" };
  }
  if (found.amountCents !== null && found.amountCents !== amountCents) {
    return { code: "provider_amount_mismatch" };
  }

  const { error } = await admin
    .from("orders")
    .update({ provider_order_id: found.providerOrderId })
    .eq("id", orderId)
    .is("provider_order_id", null);
  if (error) {
    console.error("[estorno] Não foi possível guardar o ID da cobrança no pedido.", { orderId });
  }
  return { providerOrderId: found.providerOrderId };
}

export type RefundSyncOutcome = "completed" | "external" | "other_order" | "noop";

const SYNC_OUTCOMES: readonly RefundSyncOutcome[] = [
  "completed",
  "external",
  "other_order",
  "noop",
];

/**
 * Aviso do provedor de que a order foi estornada. Nunca marca nada como pago.
 * Estorno feito fora do site é registrado e a equipe é avisada.
 */
export async function syncOrderRefunded(
  admin: SupabaseAdmin,
  externalId: string,
  providerName: string,
  providerOrderId?: string,
): Promise<RefundSyncOutcome> {
  const { data, error } = await admin.rpc("sync_order_refunded", {
    p_provider: providerName,
    p_external_id: externalId,
    p_provider_order_id: providerOrderId ?? null,
  });
  if (error || !SYNC_OUTCOMES.includes(data as RefundSyncOutcome)) {
    throw new Error("Não foi possível registrar o estorno do pedido.");
  }
  const outcome = data as RefundSyncOutcome;

  if (outcome === "external") {
    await alertTeam(
      admin,
      "estorno_externo",
      externalId,
      "O Mercado Pago avisou que o pagamento deste pedido foi devolvido fora do site (ex.: pelo painel do Mercado Pago). O pedido foi marcado como estornado e os ingressos deixaram de valer. Confira no painel se a devolução foi total.",
    );
  }
  if (outcome === "other_order") {
    await alertTeam(
      admin,
      "estorno_externo",
      externalId,
      "O Mercado Pago avisou o estorno de uma cobrança deste pedido que não é a que confirmou o pagamento. Nada foi alterado no site; confira no painel do Mercado Pago.",
    );
  }
  if (outcome === "completed" || outcome === "external") {
    await notifyBuyerRefunded(admin, externalId);
  }
  return outcome;
}

/**
 * Envia ao comprador o aviso de estorno concluído. Em qualquer falha avisa a equipe
 * e devolve `false`; nunca lança.
 */
export async function notifyBuyerRefunded(
  admin: SupabaseAdmin,
  orderId: string,
): Promise<boolean> {
  const notSent = async (reason: string) => {
    await alertTeam(
      admin,
      "email_estorno_nao_enviado",
      orderId,
      `Motivo: ${reason}. O estorno foi concluído; avise o comprador por outro meio.`,
    );
    return false;
  };

  try {
    const { data: order } = await admin
      .from("orders")
      .select("buyer_email, buyer_name, public_token, event_id, session_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return notSent("dados do pedido não encontrados");

    const [eventResult, sessionResult, refundResult, ticketsResult] = await Promise.all([
      admin.from("events").select("name, starts_at").eq("id", order.event_id).maybeSingle(),
      admin
        .from("event_sessions")
        .select("name, starts_at, status")
        .eq("id", order.session_id)
        .maybeSingle(),
      admin
        .from("order_refunds")
        .select("amount_cents")
        .eq("order_id", orderId)
        .eq("status", "concluido")
        .maybeSingle(),
      admin
        .from("tickets")
        .select("buyer_name, kind, order_items(name)")
        .eq("order_id", orderId)
        .eq("status", "estornado")
        .order("created_at"),
    ]);
    if (!eventResult.data) return notSent("evento não encontrado");
    if (!refundResult.data) return notSent("estorno concluído não encontrado");

    const sessionCancelled = sessionResult.data?.status === "cancelada";
    if (sessionCancelled) {
      const queued = await queueCancelledSessionRefundEmail(admin, orderId);
      if (queued === "queued") return true;
      if (queued === "not_configured") return notSent("envio de e-mail não configurado");
    }

    const result = await sendRefundEmail({
      buyerEmail: order.buyer_email,
      buyerName: order.buyer_name,
      publicToken: order.public_token,
      eventName: eventResult.data.name,
      startsAt: sessionResult.data?.starts_at ?? eventResult.data.starts_at,
      sessionName: sessionResult.data?.name ?? null,
      amountCents: refundResult.data.amount_cents,
      tickets: (ticketsResult.data ?? []).map((ticket) => ({
        holderName: ticket.buyer_name,
        kindLabel: ticketTypeLabel(orderItemName(ticket.order_items), ticket.kind),
      })),
      sessionCancelled,
    });
    if (result !== "sent") {
      return notSent(
        result === "skipped"
          ? "envio de e-mail não configurado"
          : "o serviço de e-mail recusou ou falhou",
      );
    }
    return true;
  } catch (error) {
    console.error("[estorno] Falha ao preparar o aviso de estorno.", error);
    return notSent("erro ao preparar o e-mail");
  }
}

/**
 * Sessão cancelada: o "valor devolvido" entra na fila de avisos da sessão (uma vez
 * por pedido, respeitando o limite diário) e é tentado na hora. Se não sair agora,
 * o agendador ou o botão "Continuar envio" mandam depois. `failed` = a fila não
 * aceitou; quem chamou envia direto.
 */
async function queueCancelledSessionRefundEmail(
  admin: SupabaseAdmin,
  orderId: string,
): Promise<"queued" | "not_configured" | "failed"> {
  const { data, error } = await admin.rpc("queue_cancellation_refund_notice", { p_order_id: orderId });
  const noticeId =
    data && typeof data === "object" && !Array.isArray(data) && typeof data.notice_id === "string"
      ? data.notice_id
      : null;
  if (error || !noticeId) {
    console.error("[estorno] Não foi possível pôr o aviso de valor devolvido na fila.", { orderId });
    return "failed";
  }
  const run = await runSessionNotices(admin, { limit: 1, noticeId, orderId });
  return run.status === "not_configured" ? "not_configured" : "queued";
}
