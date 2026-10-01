import Link from "next/link";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { HomeSingleEvent } from "@/components/public/HomeSingleEvent";
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
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-6 pb-16 pt-8">
        <div className="max-w-2xl pt-4">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-byla-yellow">
            Programação
          </p>
          <h1 className="mt-2 font-display text-5xl tracking-wide text-foreground sm:text-6xl">
            Espaço Byla Eventos
          </h1>
          <p className="mt-3 text-byla-muted">
            Escolha seu evento e garanta o ingresso — direto com o Espaço Byla.
          </p>
        </div>

        {error ? (
          <p
            className="mt-10 rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-red-700 dark:bg-red-950/40 dark:text-red-100"
            role="alert"
          >
            Não foi possível carregar os eventos agora.
          </p>
        ) : null}

        {!error && list.length === 0 ? (
          <p className="mt-10 rounded-xl border border-byla-border bg-byla-surface p-8 text-byla-muted">
            Nenhum evento com venda aberta no momento.
          </p>
        ) : null}

        {!error && list.length > 1 ? (
          <ul className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((event) => (
              <li key={event.id}>
                <Link
                  className="group block overflow-hidden rounded-2xl border border-byla-border bg-byla-surface transition hover:border-byla-blue/50"
                  href={`/eventos/${event.slug}`}
                >
                  {event.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="aspect-video w-full object-cover transition duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      src={event.cover_image_url}
                    />
                  ) : (
                    <div className="aspect-video bg-gradient-to-br from-byla-navy to-black" />
                  )}
                  <div className="p-5">
                    <h2 className="font-display text-2xl tracking-wide text-foreground">
                      {event.name}
                    </h2>
                    <p className="mt-2 text-sm text-byla-muted">
                      {dateFormatter.format(new Date(event.starts_at))}
                    </p>
                    <p className="mt-1 text-sm text-byla-muted">{event.venue}</p>
                    <span className="mt-5 inline-flex text-sm font-semibold text-byla-blue group-hover:text-byla-yellow">
                      Ver evento →
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
