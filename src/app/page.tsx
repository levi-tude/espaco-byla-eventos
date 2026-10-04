import { CalendarDays, CalendarX, MapPin } from "lucide-react";
import Link from "next/link";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { HomeSingleEvent } from "@/components/public/HomeSingleEvent";
import { SessionChips } from "@/components/public/SessionChips";
import { CoverImage } from "@/components/ui/CoverImage";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { eventDateFormatter } from "@/lib/datetime";
import { loadEventSessions } from "@/lib/domain/event-availability";
import { homeChipSessions, sessionName } from "@/lib/domain/sessions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
  dateStyle: "long",
  timeStyle: "short",
});

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

export default async function Home() {
  const supabase = await createServerClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, slug, name, starts_at, venue, cover_image_url")
    .eq("sales_open", true)
    .order("starts_at", { ascending: true });

  const admin = createAdminClient();
  const summaries = await Promise.all(
    (events ?? []).map((event) => loadEventSessions(admin, event.id)),
  );
  // Um card por evento, enquanto houver sessão que ainda não começou (vendendo ou
  // esgotada). Sem o resumo das sessões (falha na consulta), o card fica como antes.
  const list = (events ?? [])
    .map((event, index) => {
      const summary = summaries[index];
      const chips = summary ? homeChipSessions(summary.sessions) : [];
      const first = chips[0];
      const named = first ? sessionName(first.name) : null;
      const startsAt = first?.startsAt ?? event.starts_at;
      return {
        ...event,
        hasSummary: summary !== null,
        chips,
        nextStartsAt: startsAt,
        startsLabel: [named, dateFormatter.format(new Date(startsAt))].filter(Boolean).join(" · "),
        priceLabel: !summary
          ? null
          : summary.minPriceCents !== null
            ? `A partir de ${moneyFormatter.format(summary.minPriceCents / 100)}`
            : chips.length && chips.every((session) => session.soldOut)
              ? "Esgotado"
              : null,
      };
    })
    .filter((event) => !event.hasSummary || event.chips.length > 0)
    .sort((a, b) => Date.parse(a.nextStartsAt) - Date.parse(b.nextStartsAt));
  const single = list.length === 1 ? list[0] : null;

  if (single) {
    return (
      <HomeSingleEvent
        event={{
          slug: single.slug,
          name: single.name,
          startsLabel: single.startsLabel,
          venue: single.venue,
          coverImageUrl: single.cover_image_url,
          sessions: single.chips.length > 1 ? single.chips : [],
          priceLabel: single.priceLabel,
        }}
      />
    );
  }

  return (
    <main className="relative flex min-h-full flex-1 flex-col bg-byla-bg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(64,128,252,0.18),_transparent_55%)]" />
      <SiteHeader />
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-byla-accent-text">
            Programação
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-wide text-foreground sm:text-6xl">
            Espaço Byla Eventos
          </h1>
          <p className="mt-2 text-base text-byla-muted sm:text-lg">
            Escolha seu evento e garanta o ingresso — direto com o Espaço Byla.
          </p>
        </div>

        {error ? (
          <Notice className="mt-8" title="Não foi possível carregar os eventos agora." tone="danger">
            Atualize a página em alguns segundos.
          </Notice>
        ) : null}

        {!error && list.length === 0 ? (
          <EmptyState
            className="mt-8"
            description="Assim que um novo evento abrir as vendas, ele aparece aqui."
            icon={CalendarX}
            title="Nenhum evento à venda no momento"
          />
        ) : null}

        {!error && list.length > 1 ? (
          <ul className="mt-8 grid gap-5 sm:mt-10 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {list.map((event, index) => {
              const href = `/eventos/${event.slug}`;
              const multi = event.chips.length > 1;
              return (
                <li key={event.id}>
                  <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-byla-border bg-byla-surface transition hover:border-byla-link/50">
                    <Link
                      aria-hidden
                      className="overflow-hidden"
                      href={href}
                      tabIndex={-1}
                    >
                      <CoverImage
                        className="transition duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                        priority={index === 0}
                        src={event.cover_image_url}
                      />
                    </Link>
                    <div className="flex flex-1 flex-col p-4 sm:p-5">
                      <h2 className="font-display text-2xl tracking-wide text-foreground">
                        <Link
                          className="text-foreground no-underline hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                          href={href}
                        >
                          {event.name}
                        </Link>
                      </h2>
                      {multi ? null : (
                        <p className="mt-2 flex items-start gap-2 text-base text-byla-muted">
                          <CalendarDays aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                          {event.startsLabel}
                        </p>
                      )}
                      <p className="mt-1 flex items-start gap-2 text-base text-byla-muted">
                        <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                        {event.venue}
                      </p>
                      {multi ? (
                        <SessionChips
                          className="mt-3"
                          eventName={event.name}
                          sessions={event.chips}
                          slug={event.slug}
                        />
                      ) : null}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-4">
                        {event.priceLabel ? (
                          <span className="text-base font-semibold text-foreground">
                            {event.priceLabel}
                          </span>
                        ) : null}
                        <Link
                          className="inline-flex min-h-11 items-center text-base font-semibold text-byla-link no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                          href={href}
                        >
                          Ver evento <span aria-hidden>&nbsp;→</span>
                          <span className="sr-only">: {event.name}</span>
                        </Link>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
