import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { DecisionQueue } from "@/components/equipe/DecisionQueue";
import { EventForm } from "@/components/equipe/EventForm";
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { RefundHistory } from "@/components/equipe/RefundHistory";
import { TicketList } from "@/components/equipe/TicketList";
import type { EditorTicketType } from "@/components/equipe/TicketTypesEditor";
import { salesState } from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
import { isRecentlyPaid } from "@/lib/domain/status";
import { orderItemName as itemName, ticketTypeLabel } from "@/lib/domain/ticket-types";
import { loadEventGallery } from "@/lib/media/gallery";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const teamSalesLabels = {
  open: "Venda aberta",
  closed: "Venda fechada",
  sold_out: "Esgotado",
  held: "Venda aberta · lugares restantes reservados por compras em andamento",
} as const;

export default async function EventoEquipePage({
  params,
}: PageProps<"/equipe/eventos/[id]">) {
  const { id } = await params;
  const supabase = await createServerClient();
  const [
    { data: isStaff },
    { data: event },
    { data: ticketTypes },
    { count: sold },
    { data: tickets },
    { data: decisionOrders },
    { data: refunds },
  ] = await Promise.all([
    supabase.rpc("is_staff"),
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("ticket_types")
      .select("id, preset, name, kind, price_cents, people_per_unit, max_units")
      .eq("event_id", id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .order("sort_order")
      .order("id"),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id)
      .in("status", ["pago", "check_in"]),
    supabase
      .from("tickets")
      .select(
        "id, order_id, buyer_name, kind, status, price_cents, checked_in_at, order_items(name), orders!inner(buyer_email, paid_at, public_token, status, decision_reason, total_cents, payment_provider)",
      )
      .eq("event_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        "id, buyer_name, buyer_email, total_cents, paid_at, decision_reason, payment_provider, tickets(id, kind, buyer_name, status, order_items(name))",
      )
      .eq("event_id", id)
      .eq("status", "aguardando_decisao")
      .order("paid_at", { ascending: true }),
    supabase
      .from("order_refunds")
      .select(
        "id, order_id, status, amount_cents, reason, requested_by_name, created_at, completed_at, error_code, orders!inner(event_id, buyer_name)",
      )
      .eq("orders.event_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!isStaff || !event) notFound();

  const gallery = await loadEventGallery(supabase, event.id);

  const availability = await loadEventAvailability(createAdminClient(), event);
  const typeAvailability = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type]),
  );
  const editorTypes: EditorTicketType[] = (ticketTypes ?? []).map((type) => {
    const current = typeAvailability.get(type.id);
    return {
      id: type.id,
      preset: type.preset,
      name: type.name,
      priceCents: type.price_cents,
      peoplePerUnit: type.people_per_unit,
      maxUnits: type.max_units,
      hasSales: current?.hasSales ?? true,
      unitsSold: current?.unitsSold ?? 0,
      unitsTaken: current?.unitsTaken ?? 0,
    };
  });
  const soldCount = availability?.sold ?? sold ?? 0;
  const remaining =
    availability?.remaining ?? Math.max(event.capacity - soldCount, 0);
  const state = salesState(event.sales_open, availability);
  const cards = [
    { label: "Lotação", value: event.capacity, hint: null },
    { label: "Vendidos", value: soldCount, hint: "inclui cortesias" },
    {
      label: "Reservados agora",
      value: availability ? availability.held : "—",
      hint: "compras aguardando pagamento",
    },
    { label: "Restantes", value: remaining, hint: null },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            className="text-sm text-byla-muted transition hover:text-foreground"
            href="/equipe"
          >
            ← Voltar para eventos
          </Link>
          <h1 className="mt-5 font-display text-4xl tracking-wide text-foreground">
            {event.name}
          </h1>
          <p
            className={`mt-1 ${
              state === "sold_out"
                ? "font-semibold text-red-700 dark:text-red-400"
                : state === "held"
                  ? "font-medium text-amber-800 dark:text-amber-300"
                  : "text-byla-muted"
            }`}
          >
            {teamSalesLabels[state]}
          </p>
        </div>

        <Link
          className="rounded-lg bg-byla-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          href={`/equipe/eventos/${event.id}/check-in`}
        >
          Check-in
        </Link>
      </div>

      <DecisionQueue
        capacity={event.capacity}
        occupied={availability ? availability.sold + availability.held : null}
        orders={(decisionOrders ?? []).map((order) => ({
          orderId: order.id,
          buyerName: order.buyer_name,
          buyerEmail: order.buyer_email,
          totalCents: order.total_cents,
          paidAt: order.paid_at,
          decisionReason: order.decision_reason,
          ticketCount: order.tickets.length,
          paymentProvider: order.payment_provider,
          hasCheckIn: order.tickets.some(({ status }) => status === "check_in"),
          ticketLabels: order.tickets.map(
            (ticket) =>
              `${ticketTypeLabel(itemName(ticket.order_items), ticket.kind)} — ${ticket.buyer_name}`,
          ),
        }))}
      />

      <RefundHistory
        refunds={(refunds ?? []).map((refund) => {
          const order = Array.isArray(refund.orders) ? refund.orders[0] : refund.orders;
          return {
            id: refund.id,
            orderId: refund.order_id,
            buyerName: order?.buyer_name ?? "—",
            amountCents: refund.amount_cents,
            status: refund.status,
            reason: refund.reason,
            requestedByName: refund.requested_by_name,
            createdAt: refund.created_at,
            completedAt: refund.completed_at,
            errorCode: refund.error_code,
          };
        })}
      />

      <dl className="my-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((card) => (
          <div
            className="rounded-xl border border-byla-border bg-byla-surface p-5"
            key={card.label}
          >
            <dt className="text-sm text-byla-muted">{card.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-foreground">
              {card.value}
            </dd>
            {card.hint ? (
              <dd className="mt-1 text-xs text-byla-muted">{card.hint}</dd>
            ) : null}
          </div>
        ))}
      </dl>

      <EventForm
        event={{
          id: event.id,
          name: event.name,
          startsAt: event.starts_at,
          venue: event.venue,
          description: event.description,
          capacity: event.capacity,
          ticketTypes: editorTypes,
          coverImageUrl: event.cover_image_url,
          salesOpen: event.sales_open,
        }}
      />

      <EventGalleryManager eventId={event.id} images={gallery} />

      <TicketList
        eventId={event.id}
        remaining={remaining}
        tickets={(tickets ?? []).map((ticket) => {
          const order = Array.isArray(ticket.orders)
            ? ticket.orders[0]
            : ticket.orders;
          return {
            id: ticket.id,
            orderId: ticket.order_id,
            orderTotalCents: order.total_cents,
            paymentProvider: order.payment_provider,
            buyerName: ticket.buyer_name,
            buyerEmail: order.buyer_email,
            kind: ticket.kind,
            typeLabel: ticketTypeLabel(itemName(ticket.order_items), ticket.kind),
            status: ticket.status,
            orderStatus: order.status,
            decisionReason: order.decision_reason,
            priceCents: ticket.price_cents,
            paidAt: order.paid_at,
            recentlyPaid:
              ticket.kind !== "cortesia" &&
              order.status === "pago" &&
              (ticket.status === "pago" || ticket.status === "check_in") &&
              isRecentlyPaid(order.paid_at),
            checkedInAt: ticket.checked_in_at,
            publicToken: order.public_token,
          };
        })}
      />
    </main>
  );
}
