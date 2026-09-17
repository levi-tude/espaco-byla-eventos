import type { createAdminClient } from "@/lib/supabase/admin";

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export type PaidOrderOutcome = "updated" | "repaired" | "noop";

export async function markOrderPaidIfPending(
  admin: SupabaseAdmin,
  externalId: string,
  provider: string,
): Promise<PaidOrderOutcome> {
  const { data, error } = await admin.rpc("mark_order_paid_by_external", {
    p_external_id: externalId,
    p_provider: provider,
  });

  if (error) {
    throw new Error("Não foi possível confirmar o pagamento do pedido.");
  }
  if (data === "cancelled_capacity") {
    throw new Error(
      "Pagamento recebido após a capacidade esgotar; pedido cancelado para tratamento manual.",
    );
  }
  if (data === "updated" || data === "repaired" || data === "noop") return data;

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
