import { CalendarPlus, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { eventDateFormatter } from "@/lib/datetime";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
  dateStyle: "short",
  timeStyle: "short",
});

/** Evento continua em "Próximos" durante o dia em que acontece. */
const PAST_AFTER_MS = 24 * 60 * 60 * 1000;

type EventRow = {
  id: string;
  name: string;
  starts_at: string;
  sales_open: boolean;
  cover_image_url: string | null;
};

function splitByDate(events: EventRow[]) {
  const cutoff = Date.now() - PAST_AFTER_MS;
  const isPast = (event: EventRow) => new Date(event.starts_at).getTime() < cutoff;
  return {
    upcoming: events.filter((event) => !isPast(event)),
    past: events.filter(isPast).reverse(),
  };
}

function EventList({ title, events }: { title: string; events: EventRow[] }) {
  if (!events.length) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <ul className="mt-3 grid gap-3 lg:grid-cols-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              className="group flex items-center gap-4 rounded-2xl border border-byla-border bg-byla-surface p-3 no-underline transition hover:border-byla-link/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue sm:p-4"
              href={`/equipe/eventos/${event.id}`}
            >
              <div className="w-24 shrink-0 overflow-hidden rounded-lg sm:w-32">
                <CoverImage markSize={32} src={event.cover_image_url} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-foreground">{event.name}</p>
                <p className="mt-0.5 text-sm text-byla-muted">
                  {dateFormatter.format(new Date(event.starts_at))}
                </p>
                <StatusBadge className="mt-2" tone={event.sales_open ? "success" : "neutral"}>
                  {event.sales_open ? "Venda aberta" : "Venda fechada"}
                </StatusBadge>
              </div>
              <ChevronRight
                aria-hidden
                className="h-5 w-5 shrink-0 text-byla-muted transition group-hover:text-byla-link"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function EquipePage() {
  const supabase = await createServerClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, name, starts_at, sales_open, cover_image_url")
    .order("starts_at", { ascending: true });

  const { upcoming, past } = splitByDate(events ?? []);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-foreground">Eventos</h1>
          <p className="mt-1 text-base text-byla-muted">
            Organize a programação e os ingressos do Espaço Byla.
          </p>
        </div>

        <ButtonLink className="w-full sm:w-auto" href="/equipe/eventos/novo">
          <Plus aria-hidden className="h-5 w-5" />
          Novo evento
        </ButtonLink>
      </div>

      {error ? (
        <Notice className="mt-8" tone="danger">
          Não foi possível carregar os eventos.
        </Notice>
      ) : null}

      {!error && events?.length === 0 ? (
        <EmptyState
          className="mt-8"
          description="Crie o primeiro evento para começar."
          icon={CalendarPlus}
          title="Nenhum evento cadastrado."
        />
      ) : null}

      {!error ? (
        <>
          <EventList events={upcoming} title="Próximos" />
          <EventList events={past} title="Passados" />
        </>
      ) : null}
    </main>
  );
}
