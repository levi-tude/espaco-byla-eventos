import Link from "next/link";

import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-14">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Programação
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Espaço Byla Eventos
        </h1>
        <p className="mt-3 text-zinc-600">
          Escolha seu próximo evento e garanta seu ingresso.
        </p>
      </div>

      {error ? (
        <p className="mt-10 rounded-xl bg-red-50 p-5 text-red-800" role="alert">
          Não foi possível carregar os eventos agora.
        </p>
      ) : null}

      {!error && events?.length === 0 ? (
        <p className="mt-10 rounded-xl border border-zinc-200 p-8 text-zinc-600">
          Nenhum evento com venda aberta no momento.
        </p>
      ) : null}

      {!error && events && events.length > 0 ? (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <li
              className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
              key={event.id}
            >
              {event.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="aspect-video w-full object-cover"
                  src={event.cover_image_url}
                />
              ) : (
                <div className="aspect-video bg-zinc-100" />
              )}
              <div className="p-5">
                <h2 className="text-xl font-semibold">{event.name}</h2>
                <p className="mt-2 text-sm text-zinc-600">
                  {dateFormatter.format(new Date(event.starts_at))}
                </p>
                <p className="mt-1 text-sm text-zinc-600">{event.venue}</p>
                <Link
                  className="mt-5 inline-flex rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white"
                  href={`/eventos/${event.slug}`}
                >
                  Ver evento
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
