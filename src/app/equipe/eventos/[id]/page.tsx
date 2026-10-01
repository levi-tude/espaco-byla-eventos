import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { EventForm } from "@/components/equipe/EventForm";
import { EventGalleryManager } from "@/components/equipe/EventGalleryManager";
import { TicketList } from "@/components/equipe/TicketList";
import { salesState } from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
import { isRecentlyPaid } from "@/lib/domain/status";
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
  ] = await Promise.all([
    supabase.rpc("is_staff"),
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("ticket_types")
      .select("kind, price_cents")
      .eq("event_id", id),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id)
      .in("status", ["pago", "check_in"]),
    supabase
      .from("tickets")
      .select(
        "id, buyer_name, kind, status, price_cents, checked_in_at, orders!inner(buyer_email, paid_at, public_token)",
      )
      .eq("event_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!isStaff || !event) notFound();

  const gallery = await loadEventGallery(supabase, event.id);

  const availability = await loadEventAvailability(createAdminClient(), event);
  const fullPrice =
    ticketTypes?.find(({ kind }) => kind === "inteira")?.price_cents ?? 0;
  const halfPrice =
    ticketTypes?.find(({ kind }) => kind === "meia")?.price_cents ?? 0;
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
          fullPriceCents: fullPrice,
          halfPriceCents: halfPrice,
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
            buyerName: ticket.buyer_name,
            buyerEmail: order.buyer_email,
            kind: ticket.kind,
            status: ticket.status,
            priceCents: ticket.price_cents,
            paidAt: order.paid_at,
            recentlyPaid:
              ticket.kind !== "cortesia" &&
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
