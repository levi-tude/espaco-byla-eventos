import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { EventGallery } from "@/components/public/EventGallery";
import { FeeNote } from "@/components/public/FeeNote";
import { SessionPicker } from "@/components/public/SessionPicker";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";
import { Notice } from "@/components/ui/Notice";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { eventDateFormatter, formatSessionDay, formatSessionLabel } from "@/lib/datetime";
import {
  NO_CATEGORY_LIMIT,
  type SalesState,
  salesState,
  salesStateMessages,
  toCheckoutAvailability,
  typeUnitsLeft,
} from "@/lib/domain/availability";
import {
  loadEventAvailability,
  loadEventSessions,
  loadSessionAvailability,
} from "@/lib/domain/event-availability";
import { formatMoney } from "@/lib/domain/service-fee";
import {
  buyerVisibleSessions,
  pickBuyerSession,
  SALES_CLOSED_MESSAGE,
  sessionIsBuyable,
} from "@/lib/domain/sessions";
import { unitContentsLabel } from "@/lib/domain/ticket-types";
import { loadEventGallery } from "@/lib/media/gallery";
import { loadServiceFeePolicy } from "@/lib/payments/service-fee-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
  dateStyle: "long",
  timeStyle: "short",
});

/** "Sábado, 10 de outubro e Domingo, 11 de outubro" (ou "de … a …" com mais dias). */
function daysLabel(startsAt: readonly string[]) {
  const days = [...new Map(startsAt.map((start) => [formatSessionDay(start), start])).keys()];
  if (days.length <= 1) return days[0] ?? "";
  if (days.length === 2) return `${days[0]} e ${days[1]}`;
  return `De ${days[0]} a ${days.at(-1)}`;
}

export default async function EventoPublicoPage({
  params,
  searchParams,
}: PageProps<"/eventos/[slug]">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const admin = createAdminClient();
  const [gallery, { data: ticketTypes }, summary, feePolicy] = await Promise.all([
    loadEventGallery(supabase, event.id),
    supabase
      .from("ticket_types")
      .select("id, name, kind, price_cents, people_per_unit")
      .eq("event_id", event.id)
      .neq("kind", "cortesia")
      .is("archived_at", null)
      .eq("active", true)
      .order("sort_order")
      .order("id"),
    loadEventSessions(admin, event.id),
    loadServiceFeePolicy(admin),
  ]);

  const visible = summary ? buyerVisibleSessions(summary.sessions) : [];
  const multi = visible.length > 1;
  const selected = pickBuyerSession(visible, query.sessao);
  // Sem o resumo das sessões (falha na consulta), vale o comportamento antigo:
  // o banco usa a sessão única e recusa se houver mais de uma.
  const availability = selected
    ? await loadSessionAvailability(admin, selected.id)
    : summary
      ? null
      : await loadEventAvailability(admin, event);

  const sessionTypes = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type]),
  );
  const offeredTypes = (ticketTypes ?? []).flatMap((type) => {
    if (!selected) return summary ? [] : [{ ...type, remainingUnits: null as number | null }];
    const current = sessionTypes.get(type.id);
    if (!current || current.onSale === false || !current.priceCents) return [];
    return [{ ...type, price_cents: current.priceCents, remainingUnits: current.remainingUnits }];
  });

  let state: SalesState;
  if (selected) {
    state = salesState(event.sales_open && selected.salesOpen, availability);
  } else if (summary) {
    state = visible.some(sessionIsBuyable)
      ? "open"
      : visible.length && visible.every((session) => session.soldOut)
        ? "sold_out"
        : "closed";
  } else {
    state = salesState(event.sales_open, availability);
  }
  const blockedText =
    state === "open"
      ? null
      : state === "closed" && multi && selected
        ? SALES_CLOSED_MESSAGE
        : salesStateMessages[state];

  const categoryRemaining = availability
    ? toCheckoutAvailability(availability).categoryRemaining
    : NO_CATEGORY_LIMIT;
  const soldOutTypes = new Set(
    offeredTypes
      .filter(
        (type) =>
          typeUnitsLeft(
            {
              kind: type.kind,
              peoplePerUnit: type.people_per_unit,
              remainingUnits: type.remainingUnits,
            },
            categoryRemaining,
          ) === 0,
      )
      .map((type) => type.id),
  );
  const choosing = multi && !selected;
  const checkoutHref = selected
    ? `/eventos/${event.slug}/checkout?sessao=${selected.id}`
    : `/eventos/${event.slug}/checkout`;
  const buyablePrices = offeredTypes
    .filter((type) => !soldOutTypes.has(type.id))
    .map((type) => type.price_cents);
  const lowestPriceCents = choosing
    ? (summary?.minPriceCents ?? null)
    : buyablePrices.length
      ? Math.min(...buyablePrices)
      : null;
  const showBuy = state === "open";
  const selectedLabel = selected
    ? formatSessionLabel(selected.name, selected.startsAt, selected.endsAt)
    : "";
  const whenText = multi
    ? daysLabel(visible.map((session) => session.startsAt))
    : dateFormatter.format(new Date(visible[0]?.startsAt ?? event.starts_at));

  return (
    <main
      className={`relative flex min-h-full flex-1 flex-col ${
        showBuy ? "pb-32 lg:pb-16" : "pb-16"
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
                {whenText}
                {multi ? ` · ${visible.length} sessões` : ""}
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

            {multi ? (
              <SessionPicker
                feePolicy={feePolicy}
                selectedId={selected?.id ?? null}
                sessions={visible}
                slug={event.slug}
              />
            ) : null}

            {choosing ? (
              <p className="mt-4 text-base text-byla-muted">
                Escolha uma sessão para ver os ingressos e os preços.
              </p>
            ) : (
              <>
                {multi && selected ? (
                  <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-byla-accent-text">
                    {selectedLabel}
                  </p>
                ) : null}
                {offeredTypes.length ? (
                  <dl className={multi ? "mt-1 divide-y divide-byla-border" : "mt-3 divide-y divide-byla-border"}>
                    {offeredTypes.map((ticketType) => (
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
                          {soldOutTypes.has(ticketType.id) ? (
                            "Esgotado"
                          ) : (
                            <>
                              {formatMoney(ticketType.price_cents)}
                              <FeeNote priceCents={ticketType.price_cents} policy={feePolicy} />
                            </>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-3 text-base text-byla-muted">Valores indisponíveis.</p>
                )}
              </>
            )}

            {state === "open" ? (
              choosing ? null : (
                <div className="mt-4 hidden lg:block">
                  <ButtonLink fullWidth href={checkoutHref} size="lg">
                    Comprar ingresso
                  </ButtonLink>
                </div>
              )
            ) : (
              <Notice className="mt-4" live={false} tone={state === "held" ? "warning" : "neutral"}>
                {blockedText}
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

      {showBuy ? (
        <StickyActionBar hideFrom="lg">
          {lowestPriceCents !== null ? (
            <div className="min-w-0 shrink-0">
              {multi && selected ? (
                <p className="line-clamp-2 max-w-[10rem] text-sm font-medium leading-snug text-foreground">
                  {selectedLabel}
                </p>
              ) : null}
              <p className="text-sm text-byla-muted">A partir de</p>
              <p className="text-lg font-semibold leading-tight text-foreground">
                {formatMoney(lowestPriceCents)}
              </p>
              <FeeNote className="text-xs" priceCents={lowestPriceCents} policy={feePolicy} />
            </div>
          ) : null}
          {choosing ? (
            <ButtonLink className="flex-1" href="#sessoes" size="lg">
              Escolher sessão
            </ButtonLink>
          ) : (
            <ButtonLink className="flex-1" href={checkoutHref} size="lg">
              Comprar ingresso
            </ButtonLink>
          )}
        </StickyActionBar>
      ) : null}
    </main>
  );
}
