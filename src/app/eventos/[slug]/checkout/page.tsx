import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { BackLink } from "@/components/ui/BackLink";
import { Notice } from "@/components/ui/Notice";
import { type CheckoutTicketType, CheckoutForm } from "./checkout-form";
import { HeldPendingOrder } from "./pending-order-banner";
import { buildCheckoutResume, type CheckoutResume } from "@/lib/cart/resume";
import {
  NO_CATEGORY_LIMIT,
  salesState,
  salesStateMessages,
  toCheckoutAvailability,
} from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
import { isPublicTokenFormat } from "@/lib/domain/public-token";
import { createAdminClient } from "@/lib/supabase/admin";

/** Só pedido não pago deste evento preenche o checkout; o token já é a chave do pedido. */
async function loadResume(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  publicToken: string,
  offeredTypeIds: string[],
): Promise<CheckoutResume | null> {
  const { data: order } = await admin
    .from("orders")
    .select("id, status, public_token, buyer_name, buyer_email, buyer_phone, expires_at")
    .eq("public_token", publicToken)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!order) return null;

  const { data: items, error } = await admin
    .from("order_items")
    .select("ticket_type_id, quantity")
    .eq("order_id", order.id);
  if (error) return null;

  return buildCheckoutResume({ order, items: items ?? [], offeredTypeIds });
}

export default async function CheckoutPage({
  params,
  searchParams,
}: PageProps<"/eventos/[slug]/checkout">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const resumeToken = isPublicTokenFormat(query.retomar) ? query.retomar : null;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, sales_open, capacity")
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const [{ data: ticketTypes }, availability] = await Promise.all([
    admin
      .from("ticket_types")
      .select("id, name, kind, preset, price_cents, people_per_unit")
      .eq("event_id", event.id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .eq("active", true)
      .order("sort_order")
      .order("id"),
    loadEventAvailability(admin, event),
  ]);
  const typeRemaining = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type.remainingUnits]),
  );
  const publicTicketTypes: CheckoutTicketType[] = (ticketTypes ?? []).map((type) => ({
    id: type.id,
    name: type.name,
    kind: type.kind,
    preset: type.preset,
    priceCents: type.price_cents,
    peoplePerUnit: type.people_per_unit,
    remainingUnits: typeRemaining.get(type.id) ?? null,
  }));
  const resume = resumeToken
    ? await loadResume(
        admin,
        event.id,
        resumeToken,
        publicTicketTypes.map(({ id }) => id),
      )
    : null;
  const state = salesState(event.sales_open, availability);
  const blockedMessage =
    state === "open"
      ? null
      : state === "closed"
        ? "As vendas deste evento estão fechadas."
        : state === "sold_out"
          ? "Os ingressos deste evento esgotaram."
          : salesStateMessages.held;

  const showForm = !blockedMessage && publicTicketTypes.length > 0;

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <div
        className={`mx-auto w-full max-w-5xl flex-1 px-4 pt-2 sm:px-6 sm:pt-4 ${
          showForm ? "pb-36 lg:pb-16" : "pb-16"
        }`}
      >
        <BackLink href={`/eventos/${slug}`}>Voltar ao evento</BackLink>
        <section className="mt-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-byla-accent-text">
            Finalizar compra
          </p>
          <h1 className="mt-1 break-words font-display text-4xl tracking-wide text-foreground sm:text-5xl">
            {event.name}
          </h1>
          {showForm ? (
            <CheckoutForm
              // Ao cancelar o pedido retomado, remonta com a disponibilidade atualizada.
              key={`${resume?.publicToken ?? ""}:${resume?.awaitingUntil ? "aguardando" : ""}`}
              remaining={availability?.remaining ?? null}
              categoryRemaining={
                availability ? toCheckoutAvailability(availability).categoryRemaining : NO_CATEGORY_LIMIT
              }
              resume={resume}
              slug={slug}
              ticketTypes={publicTicketTypes}
            />
          ) : (
            <div className="max-w-2xl">
              <Notice
                className="mt-6"
                live={false}
                tone={state === "held" ? "warning" : "neutral"}
              >
                {blockedMessage ?? "As vendas deste evento estão fechadas."}
              </Notice>
              {state === "held" ? (
                <HeldPendingOrder
                  initialOrder={
                    resume?.awaitingUntil
                      ? { token: resume.publicToken, expiresAt: resume.awaitingUntil }
                      : null
                  }
                  slug={slug}
                />
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
