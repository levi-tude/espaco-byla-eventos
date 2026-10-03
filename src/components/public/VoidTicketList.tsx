import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatSessionWhen } from "@/lib/datetime";
import { sessionName as cleanSessionName } from "@/lib/domain/sessions";
import { ticketPositionLabel } from "@/lib/tickets/ticket-content";

export type VoidTicket = {
  id: string;
  holderName: string;
  typeLabel: string;
};

type Props = {
  tickets: VoidTicket[];
  eventName: string;
  sessionName: string | null;
  startsAt: string;
  endsAt: string | null;
  orderNumber: string;
  /** Ex.: "Estornado — não vale para entrada". */
  label: string;
};

/** Ingressos que não valem mais: sem QR, sem código e sem PDF (spec de sessões, 8.4.3). */
export function VoidTicketList({
  tickets,
  eventName,
  sessionName,
  startsAt,
  endsAt,
  orderNumber,
  label,
}: Props) {
  if (tickets.length === 0) return null;
  const named = cleanSessionName(sessionName);
  const when = formatSessionWhen(startsAt, endsAt);

  return (
    <ul className="mt-6 grid gap-3">
      {tickets.map((ticket, i) => {
        const position = ticketPositionLabel(i + 1, tickets.length);
        return (
          <li
            className="rounded-2xl border border-byla-border bg-byla-surface p-4 text-left text-foreground"
            key={ticket.id}
          >
            <p className="font-semibold">{eventName}</p>
            <p className="text-sm text-byla-muted">{[named, when].filter(Boolean).join(" · ")}</p>
            <p className="mt-2 text-base">
              {ticket.holderName} · {ticket.typeLabel}
              {position ? ` · ${position}` : ""}
            </p>
            <p className="text-sm text-byla-muted">Pedido nº {orderNumber}</p>
            <StatusBadge className="mt-2" tone="danger">
              {label}
            </StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}
