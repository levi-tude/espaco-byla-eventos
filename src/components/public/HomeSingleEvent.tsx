import { CalendarDays, MapPin } from "lucide-react";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";

type EventCard = {
  slug: string;
  name: string;
  startsLabel: string;
  venue: string;
  coverImageUrl: string | null;
};

export function HomeSingleEvent({ event }: { event: EventCard }) {
  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-byla-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[75vh] overflow-hidden [mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
      >
        {event.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-full w-full scale-125 object-cover opacity-25 blur-2xl dark:opacity-40"
            src={event.coverImageUrl}
          />
        ) : null}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(64,128,252,0.18),_transparent_60%)]" />
      </div>

      <div className="relative">
        <SiteHeader />
      </div>

      <div className="relative mx-auto w-full max-w-4xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:max-w-6xl lg:pt-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-byla-accent-text">
          Programação
        </p>
        <article className="mt-4 overflow-hidden rounded-2xl border border-byla-border bg-byla-surface shadow-xl shadow-black/10 lg:grid lg:grid-cols-[3fr_2fr] lg:items-center">
          <CoverImage priority src={event.coverImageUrl} />
          <div className="p-5 sm:p-8">
            <h1 className="font-display text-4xl tracking-wide text-foreground sm:text-6xl lg:text-5xl">
              {event.name}
            </h1>
            <ul className="mt-4 space-y-2 text-base text-byla-muted sm:text-lg">
              <li className="flex items-start gap-2">
                <CalendarDays aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                {event.startsLabel}
              </li>
              <li className="flex items-start gap-2">
                <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                {event.venue}
              </li>
            </ul>
            <ButtonLink
              className="mt-6 w-full sm:w-auto"
              href={`/eventos/${event.slug}`}
              size="lg"
            >
              Garantir ingresso
            </ButtonLink>
          </div>
        </article>
      </div>
    </main>
  );
}
