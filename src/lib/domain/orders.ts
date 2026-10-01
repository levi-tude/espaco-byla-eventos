import type { ProviderIds } from "@/lib/payments/types";
import type { createAdminClient } from "@/lib/supabase/admin";

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/** `needs_decision_*`: dinheiro recebido sem vaga ou com o pedido já cancelado; a equipe decide. */
export type PaidOrderOutcome =
  | "updated"
  | "repaired"
  | "noop"
  | "needs_decision_capacity"
  | "needs_decision_cancelled";

const PAID_OUTCOMES: readonly PaidOrderOutcome[] = [
  "updated",
  "repaired",
  "noop",
  "needs_decision_capacity",
  "needs_decision_cancelled",
];

export async function markOrderPaidIfPending(
  admin: SupabaseAdmin,
  externalId: string,
  provider: string,
  ids: ProviderIds = {},
): Promise<PaidOrderOutcome> {
  const { data, error } = await admin.rpc("mark_order_paid_by_external", {
    p_external_id: externalId,
    p_provider: provider,
    p_provider_order_id: ids.providerOrderId ?? null,
    p_provider_payment_id: ids.providerPaymentId ?? null,
  });

  if (error) {
    throw new Error("Não foi possível confirmar o pagamento do pedido.");
  }
  if (PAID_OUTCOMES.includes(data as PaidOrderOutcome)) {
    return data as PaidOrderOutcome;
  }

  throw new Error("Resposta inválida ao confirmar o pagamento do pedido.");
}

export async function cancelOrderIfPending(
  admin: SupabaseAdmin,
  externalId: string,
  provider: string,
): Promise<"updated" | "noop"> {
  const { data, error } = await admin.rpc("cancel_order_by_external", {
    p_external_id: externalId,
    p_provider: provider,
  });

  if (error) {
    throw new Error("Não foi possível cancelar o pedido.");
  }
  if (data === "updated" || data === "noop") return data;

  throw new Error("Resposta inválida ao cancelar o pedido.");
}
