import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";

export type PastEventCard = {
  id: string;
  slug: string;
  name: string;
  venue: string;
  coverImageUrl: string | null;
  dateLabel: string;
};

/** Vitrine do que já aconteceu: mais discreta que os eventos à venda, sem preço. */
export function PastEventsSection({
  events,
  nextLimit,
}: {
  events: readonly PastEventCard[];
  nextLimit: number | null;
}) {
  if (!events.length) return null;

  return (
    <section
      aria-labelledby="eventos-passados-titulo"
      className="mt-14 scroll-mt-6 sm:mt-16"
      id="eventos-passados"
    >
      <h2
        className="font-display text-3xl tracking-wide text-foreground sm:text-4xl"
        id="eventos-passados-titulo"
      >
        Eventos passados
      </h2>
      <ul className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {events.map((event) => {
          const href = `/eventos/${event.slug}`;
          return (
            <li key={event.id}>
              <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-byla-border bg-byla-surface">
                <Link aria-hidden className="overflow-hidden" href={href} tabIndex={-1}>
                  <CoverImage className="opacity-90" src={event.coverImageUrl} />
                </Link>
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <h3 className="font-display text-2xl tracking-wide text-foreground">
                    <Link
                      className="text-foreground no-underline hover:text-byla-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                      href={href}
                    >
                      {event.name}
                    </Link>
                  </h3>
                  {event.dateLabel ? (
                    <p className="mt-2 flex items-start gap-2 text-base text-byla-muted">
                      <CalendarDays aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                      {event.dateLabel}
                    </p>
                  ) : null}
                  <p className="mt-1 flex items-start gap-2 text-base text-byla-muted">
                    <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                    {event.venue}
                  </p>
                  <div className="mt-auto pt-4">
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
      {nextLimit !== null ? (
        <div className="mt-8 flex justify-center">
          <ButtonLink
            className="w-full sm:w-auto"
            href={`/?passados=${nextLimit}#eventos-passados`}
            variant="secondary"
          >
            Ver mais
          </ButtonLink>
        </div>
      ) : null}
    </section>
  );
}
