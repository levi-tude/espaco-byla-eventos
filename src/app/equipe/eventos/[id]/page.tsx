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
  ] =
    await Promise.all([
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
          "id, buyer_name, kind, status, price_cents, checked_in_at, orders!inner(buyer_email, paid_at)",
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
            className="text-sm text-zinc-600 hover:text-zinc-950"
            href="/equipe"
          >
            ← Voltar para eventos
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            {event.name}
          </h1>
          <p className="mt-1 text-zinc-600">
            {event.sales_open ? "Venda aberta" : "Venda fechada"}
          </p>
        </div>

        <Link
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium"
          href={`/equipe/eventos/${event.id}/check-in`}
        >
          Check-in
        </Link>
      </div>

      <dl className="my-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <dt className="text-sm text-zinc-600">Capacidade</dt>
          <dd className="mt-1 text-2xl font-semibold">{event.capacity}</dd>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <dt className="text-sm text-zinc-600">Ocupados</dt>
          <dd className="mt-1 text-2xl font-semibold">{occupiedCount}</dd>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <dt className="text-sm text-zinc-600">Restantes</dt>
          <dd className="mt-1 text-2xl font-semibold">{remaining}</dd>
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
        tickets={(tickets ?? []).map((ticket) => ({
          id: ticket.id,
          buyerName: ticket.buyer_name,
          buyerEmail: ticket.orders.buyer_email,
          kind: ticket.kind,
          status: ticket.status,
          priceCents: ticket.price_cents,
          paidAt: ticket.orders.paid_at,
          checkedInAt: ticket.checked_in_at,
        }))}
      />
    </main>
  );
}
