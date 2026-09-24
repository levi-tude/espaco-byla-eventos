import Link from "next/link";
import { notFound } from "next/navigation";

import { EventForm } from "@/components/equipe/EventForm";
import { TicketList } from "@/components/equipe/TicketList";
import { createServerClient } from "@/lib/supabase/server";

export default async function EventoEquipePage({
  params,
}: PageProps<"/equipe/eventos/[id]">) {
  const { id } = await params;
  const supabase = await createServerClient();
  const [
    { data: event },
    { data: ticketTypes },
    { count: occupied },
    { data: tickets },
  ] = await Promise.all([
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

  if (!event) notFound();

  const fullPrice =
    ticketTypes?.find(({ kind }) => kind === "inteira")?.price_cents ?? 0;
  const halfPrice =
    ticketTypes?.find(({ kind }) => kind === "meia")?.price_cents ?? 0;
  const occupiedCount = occupied ?? 0;
  const remaining = Math.max(event.capacity - occupiedCount, 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
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
          <p className="mt-1 text-byla-muted">
            {event.sales_open ? "Venda aberta" : "Venda fechada"}
          </p>
        </div>

        <Link
          className="rounded-lg bg-byla-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          href={`/equipe/eventos/${event.id}/check-in`}
        >
          Check-in
        </Link>
      </div>

      <dl className="my-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-byla-border bg-byla-surface p-5">
          <dt className="text-sm text-byla-muted">Capacidade</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {event.capacity}
          </dd>
        </div>
        <div className="rounded-xl border border-byla-border bg-byla-surface p-5">
          <dt className="text-sm text-byla-muted">Ocupados</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">
            {occupiedCount}
          </dd>
        </div>
        <div className="rounded-xl border border-byla-border bg-byla-surface p-5">
          <dt className="text-sm text-byla-muted">Restantes</dt>
          <dd className="mt-1 text-2xl font-semibold text-foreground">{remaining}</dd>
        </div>
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
            checkedInAt: ticket.checked_in_at,
            publicToken: order.public_token,
          };
        })}
      />
    </main>
  );
}
