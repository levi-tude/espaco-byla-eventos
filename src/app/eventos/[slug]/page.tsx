import Link from "next/link";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
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

  const [{ data: ticketTypes }, { count: occupied }] = await Promise.all([
    supabase
      .from("ticket_types")
      .select("kind, price_cents")
      .eq("event_id", event.id)
      .in("kind", ["inteira", "meia"])
      .eq("active", true)
      .order("price_cents", { ascending: false }),
    createAdminClient()
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .in("status", ["pago", "check_in"]),
  ]);

  const hasAvailability = (occupied ?? 0) < event.capacity;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <Link className="text-sm text-zinc-600 hover:text-zinc-950" href="/">
        ← Ver todos os eventos
      </Link>

      <article className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {event.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`Capa de ${event.name}`}
            className="max-h-[28rem] w-full object-cover"
            src={event.cover_image_url}
          />
        ) : null}

        <div className="grid gap-10 p-6 md:grid-cols-[1fr_18rem] md:p-10">
          <div>
            <p className="text-sm font-medium text-zinc-600">
              {dateFormatter.format(new Date(event.starts_at))}
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              {event.name}
            </h1>
            <p className="mt-3 font-medium">{event.venue}</p>
            {event.description ? (
              <p className="mt-8 whitespace-pre-line leading-7 text-zinc-700">
                {event.description}
              </p>
            ) : null}
          </div>

          <aside className="rounded-xl bg-zinc-100 p-5">
            <h2 className="font-semibold">Ingressos</h2>
            {ticketTypes?.length ? (
              <dl className="mt-4 grid gap-3">
                {ticketTypes.map((ticketType) => (
                  <div
                    className="flex items-center justify-between gap-4"
                    key={ticketType.kind}
                  >
                    <dt className="capitalize">{ticketType.kind}</dt>
                    <dd className="font-medium">
                      {moneyFormatter.format(ticketType.price_cents / 100)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-zinc-600">
                Valores indisponíveis.
              </p>
            )}

            {event.sales_open && hasAvailability ? (
              <Link
                className="mt-6 flex justify-center rounded-lg bg-zinc-950 px-4 py-3 text-sm font-medium text-white"
                href={`/eventos/${event.slug}/comprar`}
              >
                Comprar
              </Link>
            ) : (
              <p className="mt-6 rounded-lg bg-white p-3 text-center text-sm font-medium">
                {hasAvailability ? "Venda fechada" : "Ingressos esgotados"}
              </p>
            )}
          </aside>
        </div>
      </article>
    </main>
  );
}
