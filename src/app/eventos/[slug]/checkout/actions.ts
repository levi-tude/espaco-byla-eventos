"use server";

import { createPublicToken } from "@/lib/domain/tickets";
import { PRIVACY_REQUIRED_MESSAGE } from "@/lib/legal/privacy";
import { getPaymentProvider } from "@/lib/payments/provider";
import { BOT_BLOCKED_MESSAGE, isBotRequest } from "@/lib/security/bot";
import {
  clientIp,
  consumeRateLimit,
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type CheckoutKind = "inteira" | "meia";

export type CheckoutInput = {
  slug: string;
  items: { kind: CheckoutKind; qty: number }[];
  buyer: { name: string; email: string; phone?: string };
  acceptedPrivacy: boolean;
};

// Em produção o Next esconde a mensagem de erros lançados em Server Actions;
// por isso os erros esperados voltam como resultado.
export type CheckoutResult = { publicToken: string } | { error: string };

export async function startCheckout(input: CheckoutInput): Promise<CheckoutResult> {
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
      return { error: "Selecione quantidades válidas de ingressos." };
    }
    quantities.set(item.kind, quantities.get(item.kind)! + item.qty);
  }

  const quantity = [...quantities.values()].reduce((sum, qty) => sum + qty, 0);
  if (!input.slug.trim() || !buyer.name || !buyer.email.includes("@")) {
    return { error: "Preencha nome e e-mail para continuar." };
  }
  if (quantity === 0) {
    return { error: "Selecione pelo menos um ingresso." };
  }
  if (quantity > 10) {
    return { error: "Selecione no máximo 10 ingressos por pedido." };
  }
  if (input.acceptedPrivacy !== true) {
    return { error: PRIVACY_REQUIRED_MESSAGE };
  }

  if (await isBotRequest()) return { error: BOT_BLOCKED_MESSAGE };

  const admin = createAdminClient();
  const withinLimits =
    (await consumeRateLimit(admin, RATE_LIMITS.checkoutPerIp, await clientIp())) &&
    (await consumeRateLimit(
      admin,
      RATE_LIMITS.checkoutPerEmail,
      `${input.slug}:${buyer.email}`,
    ));
  if (!withinLimits) return { error: RATE_LIMIT_MESSAGE };

  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();

  if (eventError || !event) return { error: "Evento não encontrado." };
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
      return { error: "Capacidade esgotada para este evento." };
    }
    return { error: "Não foi possível criar o pedido." };
  }

  return { publicToken };
}
