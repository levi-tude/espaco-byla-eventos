import type { createAdminClient } from "@/lib/supabase/admin";

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export async function markOrderPaidIfPending(
  admin: SupabaseAdmin,
  externalId: string,
  provider: string,
): Promise<"updated" | "noop"> {
  const paidAt = new Date().toISOString();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .update({ status: "pago", paid_at: paidAt })
    .eq("payment_external_id", externalId)
    .eq("payment_provider", provider)
    .eq("status", "pendente")
    .select("id")
    .maybeSingle();

  if (orderError) {
    throw new Error("Não foi possível confirmar o pagamento do pedido.");
  }
  if (!order) return "noop";

  const { error: ticketsError } = await admin
    .from("tickets")
    .update({ status: "pago" })
    .eq("order_id", order.id)
    .eq("status", "nao_pago");

  if (ticketsError) {
    throw new Error("Pedido pago, mas os ingressos não foram atualizados.");
  }

  return "updated";
}
