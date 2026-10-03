import { CalendarDays, CalendarX, MapPin } from "lucide-react";
import Link from "next/link";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { HomeSingleEvent } from "@/components/public/HomeSingleEvent";
import { CoverImage } from "@/components/ui/CoverImage";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { eventDateFormatter } from "@/lib/datetime";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
  dateStyle: "long",
  timeStyle: "short",
});

export default async function Home() {
  const supabase = await createServerClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, slug, name, starts_at, venue, cover_image_url")
    .eq("sales_open", true)
    .order("starts_at", { ascending: true });

  const list = events ?? [];
  const single = list.length === 1 ? list[0] : null;

  if (single) {
    return (
      <HomeSingleEvent
        event={{
          slug: single.slug,
          name: single.name,
          startsLabel: dateFormatter.format(new Date(single.starts_at)),
          venue: single.venue,
          coverImageUrl: single.cover_image_url,
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
            {list.map((event, index) => (
              <li key={event.id}>
                <Link
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-byla-border bg-byla-surface no-underline transition hover:border-byla-link/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
                  href={`/eventos/${event.slug}`}
                >
                  <div className="overflow-hidden">
                    <CoverImage
                      className="transition duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      priority={index === 0}
                      src={event.cover_image_url}
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-4 sm:p-5">
                    <h2 className="font-display text-2xl tracking-wide text-foreground">
                      {event.name}
                    </h2>
                    <p className="mt-2 flex items-start gap-2 text-base text-byla-muted">
                      <CalendarDays aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                      {dateFormatter.format(new Date(event.starts_at))}
                    </p>
                    <p className="mt-1 flex items-start gap-2 text-base text-byla-muted">
                      <MapPin aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-byla-accent-text" />
                      {event.venue}
                    </p>
                    <span className="mt-auto pt-4 text-base font-semibold text-byla-link">
                      Ver evento <span aria-hidden>→</span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
