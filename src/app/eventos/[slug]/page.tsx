import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { EventGallery } from "@/components/public/EventGallery";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";
import { Notice } from "@/components/ui/Notice";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
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
  const checkoutHref = `/eventos/${event.slug}/checkout`;
  const buyablePrices = (ticketTypes ?? [])
    .filter((ticketType) => !soldOutTypes.has(ticketType.id))
    .map((ticketType) => ticketType.price_cents);
  const lowestPriceCents = buyablePrices.length ? Math.min(...buyablePrices) : null;

  return (
    <main
      className={`relative flex min-h-full flex-1 flex-col ${
        state === "open" ? "pb-32 lg:pb-16" : "pb-16"
      }`}
    >
      <SiteHeader />

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-2 sm:px-6 sm:pt-4">
        <BackLink href="/">Ver programação</BackLink>

        <div className="mt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-10">
          <div className="min-w-0 lg:col-start-1">
            <div className="-mx-4 overflow-hidden sm:mx-0 sm:rounded-2xl sm:border sm:border-byla-border">
              <CoverImage alt={`Capa de ${event.name}`} priority src={event.cover_image_url} />
            </div>

            <header className="mt-5 sm:mt-6">
              <p className="flex items-start gap-2 text-base font-semibold text-byla-accent-text">
                <CalendarDays aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                {dateFormatter.format(new Date(event.starts_at))}
              </p>
              <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground sm:text-5xl">
                {event.name}
              </h1>
              <p className="mt-2 flex items-start gap-2 text-base text-foreground sm:text-lg">
                <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                {event.venue}
              </p>
            </header>
          </div>

          <aside
            aria-labelledby="ingressos-titulo"
            className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-start lg:shadow-xl lg:shadow-black/10"
          >
            <h2
              className="flex items-center gap-2 text-lg font-semibold text-foreground"
              id="ingressos-titulo"
            >
              <Ticket aria-hidden className="h-5 w-5 text-byla-accent-text" />
              Ingressos
            </h2>
            {ticketTypes?.length ? (
              <dl className="mt-3 divide-y divide-byla-border">
                {ticketTypes.map((ticketType) => (
                  <div
                    className="flex items-center justify-between gap-4 py-3"
                    key={ticketType.id}
                  >
                    <dt className="text-base text-foreground">
                      {ticketType.name}
                      {ticketType.people_per_unit > 1 ? (
                        <span className="block text-sm text-byla-muted">
                          {unitContentsLabel(ticketType.people_per_unit, ticketType.kind)}
                        </span>
                      ) : null}
                    </dt>
                    <dd
                      className={
                        soldOutTypes.has(ticketType.id)
                          ? "text-right text-base font-semibold text-byla-muted"
                          : "text-right text-lg font-semibold text-foreground"
                      }
                    >
                      {soldOutTypes.has(ticketType.id)
                        ? "Esgotado"
                        : moneyFormatter.format(ticketType.price_cents / 100)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-base text-byla-muted">Valores indisponíveis.</p>
            )}

            {state === "open" ? (
              <div className="mt-4 hidden lg:block">
                <ButtonLink fullWidth href={checkoutHref} size="lg">
                  Comprar ingresso
                </ButtonLink>
              </div>
            ) : (
              <Notice className="mt-4" live={false} tone={state === "held" ? "warning" : "neutral"}>
                {salesStateMessages[state]}
              </Notice>
            )}
          </aside>

          <div className="min-w-0 lg:col-start-1">
            {event.description ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold text-foreground">Sobre o evento</h2>
                <p className="mt-3 whitespace-pre-line text-base leading-7 text-byla-muted">
                  {event.description}
                </p>
              </section>
            ) : null}
            <EventGallery eventName={event.name} images={gallery} />
          </div>
        </div>
      </div>

      {state === "open" ? (
        <StickyActionBar hideFrom="lg">
          {lowestPriceCents !== null ? (
            <div className="shrink-0">
              <p className="text-sm text-byla-muted">A partir de</p>
              <p className="text-lg font-semibold leading-tight text-foreground">
                {moneyFormatter.format(lowestPriceCents / 100)}
              </p>
            </div>
          ) : null}
          <ButtonLink className="flex-1" href={checkoutHref} size="lg">
            Comprar ingresso
          </ButtonLink>
        </StickyActionBar>
      ) : null}
    </main>
  );
}
