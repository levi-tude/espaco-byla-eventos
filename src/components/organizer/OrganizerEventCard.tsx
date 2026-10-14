import { ButtonLink } from "@/components/ui/Button";
import { CoverImage } from "@/components/ui/CoverImage";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import { EVENT_TIME_ZONE, formatSessionTime, sessionDayKey } from "@/lib/datetime";
import { isPastEventDay } from "@/lib/domain/past-events";

export type OrganizerEventStatus = { label: string; tone: Tone };

/**
 * Selo do card: Rascunho · Em análise · Recusado · À venda · Vendas pausadas · Encerrado.
 * Aprovado e ainda não publicado também aparece como "Vendas pausadas".
 */
export function organizerEventStatus(
  event: { approvalStatus: string; salesOpen: boolean; lastSessionAt: string | null },
  now: Date = new Date(),
): OrganizerEventStatus {
  switch (event.approvalStatus) {
    case "em_analise":
      return { label: "Em análise", tone: "info" };
    case "recusado":
      return { label: "Recusado", tone: "danger" };
    case "aprovado":
      if (isPastEventDay(event.lastSessionAt, now)) return { label: "Encerrado", tone: "neutral" };
      return event.salesOpen
        ? { label: "À venda", tone: "success" }
        : { label: "Vendas pausadas", tone: "warning" };
    default:
      return { label: "Rascunho", tone: "neutral" };
  }
}

const dayMonthParts = new Intl.DateTimeFormat("pt-BR", {
  timeZone: EVENT_TIME_ZONE,
  day: "numeric",
  month: "long",
});

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

/** "12 e 13 de dezembro · 2 sessões"; uma sessão: "12 de dezembro · 19h00". */
export function formatEventDays(sessionStarts: string[]): string {
  const starts = [...sessionStarts].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!starts.length) return "";

  const days: { day: string; month: string }[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    const key = sessionDayKey(start);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const parts = dayMonthParts.formatToParts(new Date(start));
    days.push({
      day: parts.find((part) => part.type === "day")?.value ?? "",
      month: parts.find((part) => part.type === "month")?.value ?? "",
    });
  }
  if (!days.length) return "";

  const withMonth = (index: number) => `${days[index].day} de ${days[index].month}`;
  let dates: string;
  if (days.length > 3) {
    const first = days[0];
    const last = days[days.length - 1];
    dates = `${first.month === last.month ? first.day : withMonth(0)} a ${withMonth(days.length - 1)}`;
  } else {
    // O mês vai só no último dia de cada mês: "30 de novembro, 1 e 2 de dezembro".
    dates = joinList(
      days.map((item, index) =>
        index === days.length - 1 || days[index + 1].month !== item.month ? withMonth(index) : item.day,
      ),
    );
  }

  const suffix = starts.length === 1 ? formatSessionTime(starts[0]) : `${starts.length} sessões`;
  return `${dates} · ${suffix}`;
}

export type OrganizerEventCardData = {
  id: string;
  name: string;
  coverImageUrl: string | null;
  sessionStarts: string[];
  status: OrganizerEventStatus;
  /** Motivo da recusa, quando recusado. */
  refusalNote: string | null;
  /** Soma das sessões ativas. */
  capacity: number;
  /** Pessoas com ingresso (inclui cortesias); `null` = não contado ou não foi possível. */
  sold: number | null;
};

export function OrganizerEventCard({ event }: { event: OrganizerEventCardData }) {
  const when = formatEventDays(event.sessionStarts);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-byla-border bg-byla-surface">
      <CoverImage markSize={48} src={event.coverImageUrl} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="text-lg font-semibold text-foreground">{event.name}</h2>
        {when ? <p className="text-sm text-byla-muted">{when}</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tone={event.status.tone}>{event.status.label}</StatusBadge>
          <span className="text-sm text-byla-muted">
            {event.sold !== null
              ? `${event.sold} de ${event.capacity} vendidos`
              : `${event.capacity} lugares`}
          </span>
        </div>
        {event.refusalNote ? (
          <p className="text-sm text-foreground">
            <span className="font-medium">Motivo:</span> {event.refusalNote}
          </p>
        ) : null}
        <ButtonLink
          aria-label={`Abrir ${event.name}`}
          className="mt-auto self-start"
          href={`/organizador/eventos/${event.id}`}
          variant="secondary"
        >
          Abrir
        </ButtonLink>
      </div>
    </article>
  );
}
