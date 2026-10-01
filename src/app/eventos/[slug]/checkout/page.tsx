import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { CheckoutForm } from "./checkout-form";
import { HeldPendingOrder } from "./pending-order-banner";
import type { CartKind } from "@/lib/cart/browser-cart";
import { buildCheckoutResume, type CheckoutResume } from "@/lib/cart/resume";
import { salesState, salesStateMessages } from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
import { isPublicTokenFormat } from "@/lib/domain/public-token";
import { createAdminClient } from "@/lib/supabase/admin";

/** Só pedido não pago deste evento preenche o checkout; o token já é a chave do pedido. */
async function loadResume(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  publicToken: string,
  offeredKinds: CartKind[],
): Promise<CheckoutResume | null> {
  const { data: order } = await admin
    .from("orders")
    .select("id, status, public_token, buyer_name, buyer_email, buyer_phone, expires_at")
    .eq("public_token", publicToken)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!order) return null;

  const { data: tickets, error } = await admin
    .from("tickets")
    .select("kind")
    .eq("order_id", order.id);
  if (error) return null;

  return buildCheckoutResume({
    order,
    ticketKinds: (tickets ?? []).map((ticket) => ticket.kind),
    offeredKinds,
  });
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
      .select("kind, price_cents")
      .eq("event_id", event.id)
      .in("kind", ["inteira", "meia"])
      .eq("active", true)
      .order("price_cents", { ascending: false }),
    loadEventAvailability(admin, event),
  ]);
  const publicTicketTypes = (ticketTypes ?? []).flatMap((ticketType) =>
    ticketType.kind === "inteira" || ticketType.kind === "meia"
      ? [{ kind: ticketType.kind, priceCents: ticketType.price_cents }]
      : [],
  );
  const resume = resumeToken
    ? await loadResume(
        admin,
        event.id,
        resumeToken,
        publicTicketTypes.map(({ kind }) => kind),
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

  return (
    <main className="relative flex min-h-full flex-1 flex-col">
      <SiteHeader variant="equipe" />
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link
          className="text-sm font-medium text-byla-muted transition hover:text-foreground"
          href={`/eventos/${slug}`}
        >
          ← Voltar ao evento
        </Link>
        <section className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-6 md:p-10">
          <p className="text-sm font-medium text-byla-yellow">
            Finalizar compra
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-wide text-foreground">
            {event.name}
          </h1>
          {!blockedMessage && publicTicketTypes.length ? (
            <CheckoutForm
              // Ao cancelar o pedido retomado, remonta com a disponibilidade atualizada.
              key={`${resume?.publicToken ?? ""}:${resume?.awaitingUntil ? "aguardando" : ""}`}
              remaining={availability?.remaining ?? null}
              resume={resume}
              slug={slug}
              ticketTypes={publicTicketTypes}
            />
          ) : (
            <>
              <p className="mt-6 rounded-lg border border-byla-border bg-byla-bg p-4 text-byla-muted">
                {blockedMessage ?? "As vendas deste evento estão fechadas."}
              </p>
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
            </>
          )}
        </section>
      </div>
    </main>
  );
}
