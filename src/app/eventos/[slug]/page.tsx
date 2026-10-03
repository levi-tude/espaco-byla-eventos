import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { EventGallery } from "@/components/public/EventGallery";
import { eventDateFormatter } from "@/lib/datetime";
import {
  NO_CATEGORY_LIMIT,
  salesState,
  salesStateMessages,
  toCheckoutAvailability,
  typeUnitsLeft,
} from "@/lib/domain/availability";
import { loadEventAvailability } from "@/lib/domain/event-availability";
import { unitContentsLabel } from "@/lib/domain/ticket-types";
import { loadEventGallery } from "@/lib/media/gallery";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
  dateStyle: "long",
  timeStyle: "short",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function EventoPublicoPage({
  params,
}: PageProps<"/eventos/[slug]">) {
  const { slug } = await params;
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const gallery = await loadEventGallery(supabase, event.id);

  const [{ data: ticketTypes }, availability] = await Promise.all([
    supabase
      .from("ticket_types")
      .select("id, name, kind, price_cents, people_per_unit")
      .eq("event_id", event.id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .eq("active", true)
      .order("sort_order")
      .order("id"),
    loadEventAvailability(createAdminClient(), event),
  ]);

  const state = salesState(event.sales_open, availability);
  const typeRemaining = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type.remainingUnits]),
  );
  const categoryRemaining = availability
    ? toCheckoutAvailability(availability).categoryRemaining
    : NO_CATEGORY_LIMIT;
  const soldOutTypes = new Set(
    (ticketTypes ?? [])
      .filter(
        (type) =>
          typeUnitsLeft(
            {
              kind: type.kind,
              peoplePerUnit: type.people_per_unit,
              remainingUnits: typeRemaining.get(type.id) ?? null,
            },
            categoryRemaining,
          ) === 0,
      )
      .map((type) => type.id),
  );

  return (
    <main className="relative flex min-h-full flex-1 flex-col pb-28 md:pb-12">
      <SiteHeader variant="equipe" />

      <div className="relative mx-auto w-full max-w-5xl flex-1 px-6 pt-6">
        <Link
          className="text-sm font-medium text-byla-muted transition hover:text-foreground"
          href="/"
        >
          ← Ver programação
        </Link>

        <article className="mt-6 overflow-hidden rounded-2xl border border-byla-border bg-byla-surface">
          {event.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`Capa de ${event.name}`}
              className="aspect-video w-full object-cover"
              src={event.cover_image_url}
            />
          ) : (
            <div className="h-48 bg-gradient-to-br from-byla-navy to-black sm:h-64" />
          )}

          <div className="grid gap-10 p-6 md:grid-cols-[1fr_18rem] md:p-10">
            <div>
              <p className="text-sm font-medium text-byla-yellow">
                {dateFormatter.format(new Date(event.starts_at))}
              </p>
              <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
                {event.name}
              </h1>
              <p className="mt-3 font-medium text-foreground">{event.venue}</p>
              {event.description ? (
                <p className="mt-8 whitespace-pre-line leading-7 text-byla-muted">
                  {event.description}
                </p>
              ) : null}
              <EventGallery eventName={event.name} images={gallery} />
            </div>

            <aside className="rounded-xl border border-byla-border bg-byla-overlay p-5">
              <h2 className="font-semibold text-foreground">Ingressos</h2>
              {ticketTypes?.length ? (
                <dl className="mt-4 grid gap-3">
                  {ticketTypes.map((ticketType) => (
                    <div
                      className="flex items-center justify-between gap-4"
                      key={ticketType.id}
                    >
                      <dt className="text-byla-muted">
                        {ticketType.name}
                        {ticketType.people_per_unit > 1 ? (
                          <span className="block text-xs">
                            {unitContentsLabel(ticketType.people_per_unit, ticketType.kind)}
                          </span>
                        ) : null}
                      </dt>
                      <dd className="text-right font-medium text-foreground">
                        {soldOutTypes.has(ticketType.id)
                          ? "Esgotado"
                          : moneyFormatter.format(ticketType.price_cents / 100)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-byla-muted">
                  Valores indisponíveis.
                </p>
              )}

              {state === "open" ? (
                <Link
                  className="mt-6 hidden min-h-12 items-center justify-center rounded-lg bg-byla-blue px-4 text-sm font-semibold text-white transition hover:brightness-110 md:flex"
                  href={`/eventos/${event.slug}/checkout`}
                >
                  Comprar ingresso
                </Link>
              ) : (
                <p className="mt-6 rounded-lg border border-byla-border bg-byla-bg p-3 text-center text-sm font-medium text-foreground">
                  {salesStateMessages[state]}
                </p>
              )}
            </aside>
          </div>
        </article>
      </div>

      {state === "open" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-byla-border bg-byla-bg/95 p-4 backdrop-blur md:hidden">
          <Link
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-byla-blue text-base font-semibold text-white"
            href={`/eventos/${event.slug}/checkout`}
          >
            Comprar ingresso
          </Link>
        </div>
      ) : null}
    </main>
  );
}
