"use server";

import { createPublicToken } from "@/lib/domain/tickets";
import { getPaymentProvider } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";

type CheckoutKind = "inteira" | "meia";

export type CheckoutInput = {
  slug: string;
  items: { kind: CheckoutKind; qty: number }[];
  buyer: { name: string; email: string; phone?: string };
};

export async function startCheckout(
  input: CheckoutInput,
): Promise<{ publicToken: string }> {
  const buyer = {
    name: input.buyer.name.trim(),
    email: input.buyer.email.trim().toLowerCase(),
    phone: input.buyer.phone?.trim() || null,
  };
  const quantities = new Map<CheckoutKind, number>([
    ["inteira", 0],
    ["meia", 0],
  ]);

  for (const item of input.items) {
    if (!quantities.has(item.kind) || !Number.isInteger(item.qty) || item.qty < 0) {
      throw new Error("Selecione quantidades válidas de ingressos.");
    }
    quantities.set(item.kind, quantities.get(item.kind)! + item.qty);
  }

  const quantity = [...quantities.values()].reduce((sum, qty) => sum + qty, 0);
  if (!input.slug.trim() || !buyer.name || !buyer.email.includes("@")) {
    throw new Error("Preencha nome e e-mail para continuar.");
  }
  if (quantity === 0) {
    throw new Error("Selecione pelo menos um ingresso.");
  }
  if (quantity > 10) {
    throw new Error("Selecione no máximo 10 ingressos por pedido.");
  }

  const admin = createAdminClient();
  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();

  if (eventError || !event) throw new Error("Evento não encontrado.");
  const publicToken = createPublicToken();
  const provider = getPaymentProvider();
  const items = [...quantities.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([kind, qty]) => ({ kind, qty }));
  const { data: order, error: orderError } = await admin
    .rpc("create_checkout_order", {
      p_event_id: event.id,
      p_buyer_name: buyer.name,
      p_buyer_email: buyer.email,
      p_buyer_phone: buyer.phone,
      p_payment_provider: provider.name,
      p_public_token: publicToken,
      p_items: items,
    })
    .single();

  if (orderError || !order) {
    if (orderError?.message.includes("Capacidade esgotada")) {
      throw new Error("Capacidade esgotada para este evento.");
    }
    throw new Error("Não foi possível criar o pedido.");
  }

  return { publicToken };
}
