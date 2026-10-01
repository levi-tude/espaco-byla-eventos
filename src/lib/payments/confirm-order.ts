import "server-only";

import { alertTeam, type TeamAlertKind } from "@/lib/alerts/team-alert";
import {
  markOrderPaidIfPending,
  type PaidOrderOutcome,
  type SupabaseAdmin,
} from "@/lib/domain/orders";
import { sendTicketsEmail } from "@/lib/email/send-tickets";
import type { ProviderIds } from "@/lib/payments/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatCents(cents: number | null | undefined): string {
  return typeof cents === "number" ? brl.format(cents / 100) : "desconhecido";
}

/**
 * Pedidos em que um novo aviso de pagamento não muda o estado: não há o que
 * conferir e um alerta de valor seria falso (ex.: aviso repetido ou após estorno).
 */
const SETTLED_STATUSES = new Set(["pago", "estornado", "aguardando_decisao"]);

const DECIDE_HINT =
  "Use “Aceitar mesmo assim” no painel do evento para liberar os ingressos. Para devolver o dinheiro, aguarde o botão “Estornar”.";

const DECISION_ALERTS: Partial<
  Record<PaidOrderOutcome, { kind: TeamAlertKind; details: string }>
> = {
  needs_decision_capacity: {
    kind: "pago_sem_vaga",
    details: `Os lugares do evento acabaram antes de o pagamento ser confirmado. O pedido está em “Pago sem vaga — decidir” e os ingressos ainda não valem. ${DECIDE_HINT}`,
  },
  needs_decision_cancelled: {
    kind: "pago_apos_cancelamento",
    details: `O pagamento chegou depois de o pedido ter sido cancelado. O pedido está em “Pago após cancelamento — decidir” e os ingressos ainda não valem. ${DECIDE_HINT}`,
  },
};

/**
 * Marca o pedido como pago e envia os ingressos por e-mail na primeira confirmação.
 * Quando o pagamento muda o pedido, só confirma se o valor pago no provedor for
 * exatamente o total do pedido. Sem vaga (ou pedido cancelado) não libera ingresso:
 * o pedido fica para a equipe decidir e ela é avisada.
 */
export async function confirmOrderPaid(
  admin: SupabaseAdmin,
  orderId: string,
  providerName: string,
  paidAmountCents: number | null,
  ids: ProviderIds = {},
): Promise<PaidOrderOutcome> {
  const { data: current } = await admin
    .from("orders")
    .select("status, total_cents")
    .eq("id", orderId)
    .maybeSingle();
  const settled = current ? SETTLED_STATUSES.has(current.status) : false;
  if (!settled && (!current || paidAmountCents !== current.total_cents)) {
    console.error("[pagamento] Valor pago não confere com o pedido.", {
      orderId,
      paidAmountCents,
      expectedCents: current?.total_cents ?? null,
    });
    await alertTeam(
      admin,
      "valor_divergente",
      orderId,
      `Valor pago: ${formatCents(paidAmountCents)} · Valor do pedido: ${formatCents(current?.total_cents)}. O pedido NÃO foi marcado como pago.`,
    );
    throw new Error("Valor pago não confere com o pedido; confirmação bloqueada.");
  }

  let outcome: PaidOrderOutcome;
  try {
    outcome = await markOrderPaidIfPending(admin, orderId, providerName, ids);
  } catch (error) {
    await alertTeam(
      admin,
      "confirmacao_falhou",
      orderId,
      `Motivo: ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    throw error;
  }

  const decision = DECISION_ALERTS[outcome];
  if (decision) {
    console.warn("[pagamento] Pagamento recebido aguardando decisão da equipe.", {
      orderId,
      outcome,
    });
    await alertTeam(admin, decision.kind, orderId, decision.details);
    return outcome;
  }
  if (outcome === "noop") return outcome;

  await sendOrderTicketsEmail(admin, orderId);
  return outcome;
}

/**
 * Envia ao comprador o e-mail com os ingressos pagos do pedido. Em qualquer falha
 * avisa a equipe e devolve `false`; nunca lança.
 */
export async function sendOrderTicketsEmail(
  admin: SupabaseAdmin,
  orderId: string,
): Promise<boolean> {
  const emailNotSent = async (reason: string) => {
    await alertTeam(
      admin,
      "email_nao_enviado",
      orderId,
      `Motivo: ${reason}. Os ingressos estão pagos e válidos; envie o link do pedido ao comprador.`,
    );
    return false;
  };

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("buyer_email, buyer_name, public_token, event_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error(
      "[email] Pedido pago, mas os dados para envio não foram encontrados.",
    );
    return emailNotSent("dados do pedido não encontrados");
  }

  const [eventResult, ticketsResult] = await Promise.all([
    admin
      .from("events")
      .select("name, venue, starts_at")
      .eq("id", order.event_id)
      .single(),
    admin
      .from("tickets")
      .select("code, buyer_name, kind")
      .eq("order_id", orderId)
      .eq("status", "pago")
      .order("created_at"),
  ]);

  if (eventResult.error || !eventResult.data) {
    console.error(
      "[email] Pedido pago, mas o evento para envio não foi encontrado.",
    );
    return emailNotSent("evento não encontrado");
  }

  if (ticketsResult.error || !ticketsResult.data?.length) {
    console.error(
      "[email] Pedido pago, mas os ingressos para envio não foram encontrados.",
    );
    return emailNotSent("ingressos não encontrados");
  }

  const event = eventResult.data;

  const emailResult = await sendTicketsEmail({
    buyerEmail: order.buyer_email,
    buyerName: order.buyer_name,
    eventName: event.name,
    venue: event.venue,
    startsAt: event.starts_at,
    tickets: ticketsResult.data.map((ticket) => ({
      code: ticket.code,
      holderName: ticket.buyer_name,
      kind: ticket.kind,
    })),
    publicToken: order.public_token,
  });

  if (emailResult !== "sent") {
    return emailNotSent(
      emailResult === "skipped"
        ? "envio de e-mail não configurado"
        : "o serviço de e-mail recusou ou falhou",
    );
  }

  return true;
}
