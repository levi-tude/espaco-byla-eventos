import "server-only";

import { alertTeam } from "@/lib/alerts/team-alert";
import {
  markOrderPaidIfPending,
  type PaidOrderOutcome,
  type SupabaseAdmin,
} from "@/lib/domain/orders";
import { sendTicketsEmail } from "@/lib/email/send-tickets";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatCents(cents: number | null | undefined): string {
  return typeof cents === "number" ? brl.format(cents / 100) : "desconhecido";
}

/**
 * Marca o pedido como pago e envia os ingressos por e-mail na primeira confirmação.
 * Só confirma se o valor pago no provedor for exatamente o total do pedido.
 */
export async function confirmOrderPaid(
  admin: SupabaseAdmin,
  orderId: string,
  providerName: string,
  paidAmountCents: number | null,
): Promise<PaidOrderOutcome> {
  const { data: expected } = await admin
    .from("orders")
    .select("total_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (!expected || paidAmountCents !== expected.total_cents) {
    console.error("[pagamento] Valor pago não confere com o pedido.", {
      orderId,
      paidAmountCents,
      expectedCents: expected?.total_cents ?? null,
    });
    await alertTeam(
      admin,
      "valor_divergente",
      orderId,
      `Valor pago: ${formatCents(paidAmountCents)} · Valor do pedido: ${formatCents(expected?.total_cents)}. O pedido NÃO foi marcado como pago.`,
    );
    throw new Error("Valor pago não confere com o pedido; confirmação bloqueada.");
  }

  let outcome: PaidOrderOutcome;
  try {
    outcome = await markOrderPaidIfPending(admin, orderId, providerName);
  } catch (error) {
    await alertTeam(
      admin,
      "confirmacao_falhou",
      orderId,
      `Motivo: ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    throw error;
  }
  if (outcome === "noop") return outcome;

  const emailNotSent = (reason: string) =>
    alertTeam(
      admin,
      "email_nao_enviado",
      orderId,
      `Motivo: ${reason}. Os ingressos estão pagos e válidos; envie o link do pedido ao comprador.`,
    );

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("buyer_email, buyer_name, public_token, event_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error(
      "[email] Pedido pago, mas os dados para envio não foram encontrados.",
    );
    await emailNotSent("dados do pedido não encontrados");
    return outcome;
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
    await emailNotSent("evento não encontrado");
    return outcome;
  }

  if (ticketsResult.error || !ticketsResult.data?.length) {
    console.error(
      "[email] Pedido pago, mas os ingressos para envio não foram encontrados.",
    );
    await emailNotSent("ingressos não encontrados");
    return outcome;
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
    await emailNotSent(
      emailResult === "skipped"
        ? "envio de e-mail não configurado"
        : "o serviço de e-mail recusou ou falhou",
    );
  }

  return outcome;
}
