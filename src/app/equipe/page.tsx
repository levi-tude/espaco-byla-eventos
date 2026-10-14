import { CalendarPlus, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { eventDateFormatter, formatSessionShort } from "@/lib/datetime";
import { isPastEventDay } from "@/lib/domain/past-events";
import { createServerClient } from "@/lib/supabase/server";

const dateFormatter = eventDateFormatter({
  dateStyle: "short",
  timeStyle: "short",
});

type EventRow = {
  id: string;
  name: string;
  starts_at: string;
  sales_open: boolean;
  published_at: string | null;
  hidden_from_past: boolean;
  cover_image_url: string | null;
  /** Início das sessões ativas, em ordem. */
  sessionStarts: string[];
  /** Fim (ou início, sem término) da última sessão ativa. */
  lastSessionAt: string | null;
};

/** Evento passa para "Passados" no dia seguinte à última sessão (mesma regra do site). */
function splitByDate(events: EventRow[]) {
  const isPast = (event: EventRow) => isPastEventDay(event.lastSessionAt ?? event.starts_at);
  return {
    upcoming: events.filter((event) => !isPast(event)),
    past: events.filter(isPast).reverse(),
  };
}

/** Sessão única: a data. Várias: "3 sessões · próxima: sáb, 10/10 · 19h00". */
function whenLine(event: EventRow) {
  if (event.sessionStarts.length <= 1) {
    return dateFormatter.format(new Date(event.sessionStarts[0] ?? event.starts_at));
  }
  const now = Date.now();
  const next = event.sessionStarts.find((start) => new Date(start).getTime() > now);
  return next
    ? `${event.sessionStarts.length} sessões · próxima: ${formatSessionShort(next)}`
    : `${event.sessionStarts.length} sessões · última: ${formatSessionShort(event.sessionStarts.at(-1))}`;
}

function EventList({
  title,
  events,
  past = false,
}: {
  title: string;
  events: EventRow[];
  past?: boolean;
}) {
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
                <p className="mt-0.5 text-sm text-byla-muted">{whenLine(event)}</p>
                {past ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge>Encerrado</StatusBadge>
                    {event.published_at && event.hidden_from_past ? (
                      <StatusBadge tone="warning">Escondido do site</StatusBadge>
                    ) : null}
                  </div>
                ) : (
                  <StatusBadge className="mt-2" tone={event.sales_open ? "success" : "neutral"}>
                    {event.sales_open ? "Venda aberta" : "Venda fechada"}
                  </StatusBadge>
                )}
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
  const { data: rows, error } = await supabase
    .from("events")
    .select(
      "id, name, starts_at, sales_open, published_at, hidden_from_past, cover_image_url, event_sessions(starts_at, ends_at, status, archived_at)",
    )
    .order("starts_at", { ascending: true });

  const events: EventRow[] = (rows ?? []).map(({ event_sessions: sessions, ...event }) => {
    const active = (sessions ?? []).filter(
      (session) => session.status === "ativa" && session.archived_at === null,
    );
    const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);
    return {
      ...event,
      sessionStarts: active.map((session) => session.starts_at).sort(byTime),
      lastSessionAt:
        active.map((session) => session.ends_at ?? session.starts_at).sort(byTime).at(-1) ?? null,
    };
  });
  const { upcoming, past } = splitByDate(events);

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

      {!error && events.length === 0 ? (
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
          <EventList events={past} past title="Passados" />
        </>
      ) : null}
    </main>
  );
}
