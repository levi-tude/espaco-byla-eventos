import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { type CheckoutSession, type CheckoutTicketType, CheckoutForm } from "./checkout-form";
import { HeldPendingOrder } from "./pending-order-banner";
import { buildCheckoutResume } from "@/lib/cart/resume";
import { formatSessionLabel } from "@/lib/datetime";
import {
  NO_CATEGORY_LIMIT,
  salesState,
  salesStateMessages,
  toCheckoutAvailability,
} from "@/lib/domain/availability";
import {
  loadEventAvailability,
  loadEventSessions,
  loadSessionAvailability,
} from "@/lib/domain/event-availability";
import { isPublicTokenFormat } from "@/lib/domain/public-token";
import { buyerVisibleSessions, SALES_CLOSED_MESSAGE } from "@/lib/domain/sessions";
import { isUuid } from "@/lib/domain/ticket-types";
import { createAdminClient } from "@/lib/supabase/admin";

/** Só pedido não pago deste evento preenche o checkout; o token já é a chave do pedido. */
async function loadResumeOrder(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  publicToken: string,
) {
  const { data: order } = await admin
    .from("orders")
    .select("id, session_id, status, public_token, buyer_name, buyer_email, buyer_phone, expires_at")
    .eq("public_token", publicToken)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!order) return null;

  const { data: items, error } = await admin
    .from("order_items")
    .select("ticket_type_id, quantity")
    .eq("order_id", order.id);
  if (error) return null;
  return { order, items: items ?? [] };
}

export default async function CheckoutPage({
  params,
  searchParams,
}: PageProps<"/eventos/[slug]/checkout">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const resumeToken = isPublicTokenFormat(query.retomar) ? query.retomar : null;
  const requestedSessionId =
    typeof query.sessao === "string" && isUuid(query.sessao) ? query.sessao : null;
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name, sales_open, capacity")
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const [{ data: ticketTypes }, summary, resumeOrder] = await Promise.all([
    admin
      .from("ticket_types")
      .select("id, name, kind, preset, price_cents, people_per_unit")
      .eq("event_id", event.id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .eq("active", true)
      .order("sort_order")
      .order("id"),
    loadEventSessions(admin, event.id),
    resumeToken ? loadResumeOrder(admin, event.id, resumeToken) : Promise.resolve(null),
  ]);

  // Sessão da compra: a do pedido retomado, a escolhida na página do evento ou,
  // em evento de sessão única, a única. O banco confere de novo ao reservar.
  const visible = summary ? buyerVisibleSessions(summary.sessions) : [];
  const multi = visible.length > 1;
  const wantedId = resumeOrder?.order.session_id ?? requestedSessionId;
  const session = summary
    ? wantedId
      ? (summary.sessions.find((item) => item.id === wantedId) ?? null)
      : visible.length === 1
        ? visible[0]
        : null
    : null;
  const sessionGone = Boolean(
    session && !visible.some((item) => item.id === session.id),
  );
  const needsChoice = Boolean(summary) && !session;

  const availability = session
    ? await loadSessionAvailability(admin, session.id)
    : summary
      ? null
      : await loadEventAvailability(admin, event);
  const sessionTypes = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type]),
  );
  const publicTicketTypes: CheckoutTicketType[] = (ticketTypes ?? []).flatMap((type) => {
    const current = sessionTypes.get(type.id);
    if (session && (!current || current.onSale === false || !current.priceCents)) return [];
    return [
      {
        id: type.id,
        name: type.name,
        kind: type.kind,
        preset: type.preset,
        priceCents: session && current?.priceCents ? current.priceCents : type.price_cents,
        peoplePerUnit: type.people_per_unit,
        remainingUnits: current?.remainingUnits ?? null,
      },
    ];
  });
  const resume = resumeOrder
    ? buildCheckoutResume({
        order: resumeOrder.order,
        items: resumeOrder.items,
        offeredTypeIds: publicTicketTypes.map(({ id }) => id),
      })
    : null;
  const checkoutSession: CheckoutSession | null = session
    ? {
        id: session.id,
        label: formatSessionLabel(session.name, session.startsAt, session.endsAt),
        canChange: multi,
      }
    : null;

  const state = salesState(
    event.sales_open && (session ? session.salesOpen : true),
    availability,
  );
  const blockedMessage = needsChoice
    ? "Escolha a sessão na página do evento para continuar."
    : sessionGone
      ? "Esta sessão não está mais disponível. Escolha outra sessão."
      : state === "open"
        ? null
        : state === "closed"
          ? multi
            ? SALES_CLOSED_MESSAGE
            : "As vendas deste evento estão fechadas."
          : state === "sold_out"
            ? multi
              ? "Os ingressos desta sessão esgotaram."
              : "Os ingressos deste evento esgotaram."
            : salesStateMessages.held;

  const showForm = !blockedMessage && publicTicketTypes.length > 0;
  const chooseAnother = needsChoice || (multi && blockedMessage !== null && state !== "held");

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
              key={`${resume?.publicToken ?? ""}:${resume?.awaitingUntil ? "aguardando" : ""}:${session?.id ?? ""}`}
              remaining={availability?.remaining ?? null}
              categoryRemaining={
                availability ? toCheckoutAvailability(availability).categoryRemaining : NO_CATEGORY_LIMIT
              }
              resume={resume}
              session={checkoutSession}
              slug={slug}
              ticketTypes={publicTicketTypes}
            />
          ) : (
            <div className="max-w-2xl">
              {checkoutSession ? (
                <p className="mt-3 text-base text-byla-muted">{checkoutSession.label}</p>
              ) : null}
              <Notice
                className="mt-6"
                live={false}
                tone={state === "held" && !needsChoice && !sessionGone ? "warning" : "neutral"}
              >
                {blockedMessage ?? "As vendas deste evento estão fechadas."}
              </Notice>
              {chooseAnother ? (
                <ButtonLink className="mt-4 w-full sm:w-auto" href={`/eventos/${slug}#sessoes`} size="lg">
                  Escolher sessão
                </ButtonLink>
              ) : null}
              {state === "held" && !needsChoice && !sessionGone ? (
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
