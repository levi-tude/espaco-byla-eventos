"use server";

import { assertCapacityAvailable } from "@/lib/domain/capacity";
import { countsTowardCapacity } from "@/lib/domain/status";
import { createPublicToken, createTicketCode } from "@/lib/domain/tickets";
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
): Promise<{ checkoutUrl: string }> {
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

  const admin = createAdminClient();
  const { data: event, error: eventError } = await admin
    .from("events")
    .select("id, name, slug, capacity, sales_open")
    .eq("slug", input.slug)
    .maybeSingle();

  if (eventError || !event) throw new Error("Evento não encontrado.");
  if (!event.sales_open) throw new Error("As vendas deste evento estão fechadas.");

  const [{ data: ticketTypes, error: typesError }, { data: tickets, error: ticketsError }] =
    await Promise.all([
      admin
        .from("ticket_types")
        .select("id, kind, price_cents")
        .eq("event_id", event.id)
        .in("kind", ["inteira", "meia"])
        .eq("active", true),
      admin.from("tickets").select("status").eq("event_id", event.id),
    ]);

  if (typesError || ticketsError) {
    throw new Error("Não foi possível verificar os ingressos disponíveis.");
  }

  const selectedTypes = (ticketTypes ?? []).filter(
    (ticketType) =>
      (ticketType.kind === "inteira" || ticketType.kind === "meia") &&
      quantities.get(ticketType.kind)! > 0,
  );
  if (selectedTypes.length !== [...quantities.values()].filter(Boolean).length) {
    throw new Error("Um dos tipos de ingresso selecionados está indisponível.");
  }

  const occupied = (tickets ?? []).filter(({ status }) =>
    countsTowardCapacity(status),
  ).length;
  assertCapacityAvailable(occupied, event.capacity, quantity);

  const totalCents = selectedTypes.reduce(
    (sum, ticketType) =>
      sum + ticketType.price_cents * quantities.get(ticketType.kind as CheckoutKind)!,
    0,
  );
  const publicToken = createPublicToken();
  const provider = getPaymentProvider();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      event_id: event.id,
      buyer_name: buyer.name,
      buyer_email: buyer.email,
      buyer_phone: buyer.phone,
      total_cents: totalCents,
      status: "pendente",
      public_token: publicToken,
      payment_provider: provider.name,
    })
    .select("id")
    .single();

  if (orderError) throw new Error("Não foi possível criar o pedido.");

  const ticketRows = selectedTypes.flatMap((ticketType) =>
    Array.from({ length: quantities.get(ticketType.kind as CheckoutKind)! }, () => ({
      order_id: order.id,
      event_id: event.id,
      ticket_type_id: ticketType.id,
      kind: ticketType.kind,
      status: "nao_pago" as const,
      code: createTicketCode(),
      buyer_name: buyer.name,
      price_cents: ticketType.price_cents,
    })),
  );
  const { error: insertTicketsError } = await admin
    .from("tickets")
    .insert(ticketRows);

  if (insertTicketsError) {
    await admin.from("orders").delete().eq("id", order.id);
    throw new Error("Não foi possível emitir os ingressos do pedido.");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL não configurada.");

  const payment = await provider.createPayment({
    orderId: order.id,
    amountCents: totalCents,
    description: `Ingressos — ${event.name}`,
    buyerEmail: buyer.email,
    successUrl: `${appUrl}/pedidos/${publicToken}`,
    failureUrl: `${appUrl}/eventos/${event.slug}/checkout`,
  });
  const { error: paymentError } = await admin
    .from("orders")
    .update({ payment_external_id: payment.externalId })
    .eq("id", order.id);

  if (paymentError) {
    throw new Error("Pagamento criado, mas o pedido não pôde ser vinculado.");
  }

  return { checkoutUrl: payment.checkoutUrl };
}
