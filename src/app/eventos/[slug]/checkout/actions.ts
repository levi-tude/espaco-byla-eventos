"use server";

import {
  capacityRefusalMessage,
  type CheckoutAvailability,
  MAX_PEOPLE_PER_ORDER,
  toCheckoutAvailability,
  typeRefusalMessage,
} from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
import { isPublicTokenFormat } from "@/lib/domain/public-token";
import { isUuid, TICKET_TYPE_LIMITS } from "@/lib/domain/ticket-types";
import { createPublicToken } from "@/lib/domain/tickets";
import {
  PRIVACY_POLICY_VERSION,
  PRIVACY_REQUIRED_MESSAGE,
} from "@/lib/legal/privacy";
import { getPaymentProvider } from "@/lib/payments/provider";
import { BOT_BLOCKED_MESSAGE, isBotRequest } from "@/lib/security/bot";
import {
  clientIp,
  consumeRateLimit,
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type CheckoutInput = {
  slug: string;
  items: { ticketTypeId: string; qty: number }[];
  buyer: { name: string; email: string; phone?: string };
  acceptedPrivacy: boolean;
};

// Em produção o Next esconde a mensagem de erros lançados em Server Actions;
// por isso os erros esperados voltam como resultado.
export type CheckoutResult =
  | { publicToken: string }
  | { error: string; availability?: CheckoutAvailability };

const LIMIT_MESSAGE = `Selecione no máximo ${MAX_PEOPLE_PER_ORDER} pessoas por compra.`;
const UNAVAILABLE_MESSAGE =
  "Um dos tipos de ingresso escolhidos não está mais à venda. Atualize a página e escolha de novo.";

export async function startCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const buyer = {
    name: input.buyer.name.trim(),
    email: input.buyer.email.trim().toLowerCase(),
    phone: input.buyer.phone?.trim() || null,
  };
  if (!Array.isArray(input.items) || input.items.length > TICKET_TYPE_LIMITS.maxTypes) {
    return { error: "Selecione quantidades válidas de ingressos." };
  }
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    if (
      !item ||
      !isUuid(item.ticketTypeId) ||
      quantities.has(item.ticketTypeId) ||
      !Number.isInteger(item.qty) ||
      item.qty < 0 ||
      item.qty > MAX_PEOPLE_PER_ORDER
    ) {
      return { error: "Selecione quantidades válidas de ingressos." };
    }
    quantities.set(item.ticketTypeId, item.qty);
  }

  // Cada unidade tem ao menos 1 pessoa; o total exato de pessoas o banco confere.
  const units = [...quantities.values()].reduce((sum, qty) => sum + qty, 0);
  if (!input.slug.trim() || !buyer.name || !buyer.email.includes("@")) {
    return { error: "Preencha nome e e-mail para continuar." };
  }
  if (units === 0) {
    return { error: "Selecione pelo menos um ingresso." };
  }
  if (units > MAX_PEOPLE_PER_ORDER) {
    return { error: LIMIT_MESSAGE };
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
    .select("id, capacity")
    .eq("slug", input.slug)
    .maybeSingle();

  if (eventError || !event) return { error: "Evento não encontrado." };
  const publicToken = createPublicToken();
  const provider = getPaymentProvider();
  const items = [...quantities.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([ticketTypeId, qty]) => ({ ticket_type_id: ticketTypeId, qty }));
  const { data: order, error: orderError } = await admin
    .rpc("create_checkout_order", {
      p_event_id: event.id,
      p_buyer_name: buyer.name,
      p_buyer_email: buyer.email,
      p_buyer_phone: buyer.phone,
      p_payment_provider: provider.name,
      p_public_token: publicToken,
      p_items: items,
      p_privacy_policy_version: PRIVACY_POLICY_VERSION,
    })
    .single();

  if (orderError || !order) {
    return checkoutRefusal(admin, event.id, orderError?.message ?? "");
  }

  return { publicToken };
}

/** Traduz a recusa do banco e devolve a disponibilidade atual para a tela se ajustar. */
async function checkoutRefusal(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  message: string,
): Promise<CheckoutResult> {
  const typeSoldOut = message.match(/ESGOTADO_TIPO:([0-9a-f-]{36}):(\d+)/i);
  if (message.includes("ESGOTADO_EVENTO") || typeSoldOut) {
    const availability = await loadEventAvailability(admin, { id: eventId });
    let error = capacityRefusalMessage(availability);
    if (typeSoldOut) {
      const { data: type } = await admin
        .from("ticket_types")
        .select("name")
        .eq("id", typeSoldOut[1])
        .maybeSingle();
      error = typeRefusalMessage(type?.name ?? "Este ingresso", Number(typeSoldOut[2]));
    }
    return {
      error,
      ...(availability ? { availability: toCheckoutAvailability(availability) } : {}),
    };
  }
  if (message.includes("LIMITE_PESSOAS")) return { error: LIMIT_MESSAGE };
  if (message.includes("TIPO_INDISPONIVEL")) return { error: UNAVAILABLE_MESSAGE };
  if (message.includes("vendas deste evento estão fechadas")) {
    return { error: "As vendas deste evento estão fechadas." };
  }
  return { error: "Não foi possível criar o pedido." };
}

export type PendingOrderLookup =
  | { state: "awaiting_payment"; expiresAt: string }
  | { state: "paid" }
  | { state: "none" };

/**
 * Pedido guardado no carrinho do navegador: diz se ainda aguarda pagamento dentro
 * da reserva, para o checkout oferecer "Continuar pagamento" em vez de criar outro.
 */
export async function findPendingOrder(
  slug: string,
  publicToken: string,
): Promise<PendingOrderLookup> {
  if (
    typeof slug !== "string" ||
    !slug.trim() ||
    slug.length > 200 ||
    !isPublicTokenFormat(publicToken)
  ) {
    return { state: "none" };
  }
  if (await isBotRequest()) return { state: "none" };

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) return { state: "none" };

  const { data: order } = await admin
    .from("orders")
    .select("status, expires_at")
    .eq("public_token", publicToken)
    .eq("event_id", event.id)
    .maybeSingle();
  if (!order) return { state: "none" };
  if (order.status === "pago") return { state: "paid" };
  if (
    order.status === "pendente" &&
    order.expires_at &&
    Date.parse(order.expires_at) > Date.now()
  ) {
    return { state: "awaiting_payment", expiresAt: order.expires_at };
  }
  return { state: "none" };
}
