import Link from "next/link";

import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export default async function EquipePage() {
  const supabase = await createServerClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, name, starts_at, sales_open")
    .order("starts_at", { ascending: true });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-foreground">
            Eventos
          </h1>
          <p className="mt-1 text-byla-muted">
            Organize a programação e os ingressos do Espaço Byla.
          </p>
        </div>

        <Link
          className="rounded-lg bg-byla-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          href="/equipe/eventos/novo"
        >
          Novo evento
        </Link>
      </div>

      {error ? (
        <div
          className="mt-8 rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-100"
          role="alert"
        >
          Não foi possível carregar os eventos.
        </div>
      ) : null}

      {!error && events?.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-byla-border bg-byla-surface p-10 text-center">
          <p className="font-medium text-foreground">Nenhum evento cadastrado.</p>
          <p className="mt-1 text-sm text-byla-muted">
            Crie o primeiro evento para começar.
          </p>
        </div>
      ) : null}

      {!error && events && events.length > 0 ? (
        <ul className="mt-8 grid gap-4">
          {events.map((event) => (
            <li
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-byla-border bg-byla-surface p-5"
              key={event.id}
            >
              <div>
                <h2 className="font-semibold text-foreground">{event.name}</h2>
                <p className="mt-1 text-sm text-byla-muted">
                  {dateFormatter.format(new Date(event.starts_at))}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={
                    event.sales_open
                      ? "rounded-full bg-emerald-500/20 px-3 py-1 text-sm font-medium text-emerald-300"
                      : "rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-zinc-300"
                  }
                >
                  {event.sales_open ? "Venda aberta" : "Venda fechada"}
                </span>
                <Link
                  className="rounded-lg border border-byla-border px-3 py-2 text-sm font-medium text-foreground transition hover:border-byla-blue/60"
                  href={`/equipe/eventos/${event.id}`}
                >
                  Gerenciar
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
