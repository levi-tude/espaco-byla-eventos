import { DownloadTicketPdf } from "@/components/public/DownloadTicketPdf";
import { formatSessionWhen } from "@/lib/datetime";
import { sessionName as cleanSessionName } from "@/lib/domain/sessions";
import { ticketTypeLabel } from "@/lib/domain/ticket-types";
import { ticketQrDataUrl } from "@/lib/tickets/qr";
import {
  checkedInLabel,
  ticketPdfLines,
  ticketPositionLabel,
} from "@/lib/tickets/ticket-content";
import type { Enums } from "@/types/database";

type TicketQrProps = {
  code: string;
  eventName: string;
  sessionName: string | null;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  holderName: string;
  kind: Enums<"ticket_kind">;
  /** Nome do tipo gravado no pedido (ex.: "Casadinha"). */
  typeName?: string | null;
  status: "pago" | "check_in";
  checkedInAt?: string | null;
  orderNumber: string;
  index: number;
  total: number;
};

const statusLabels: Record<TicketQrProps["status"], string> = {
  pago: "Pago",
  check_in: "Check-in",
};

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

export async function TicketQr({
  code,
  eventName,
  sessionName,
  startsAt,
  endsAt,
  venue,
  holderName,
  kind,
  typeName,
  status,
  checkedInAt,
  orderNumber,
  index,
  total,
}: TicketQrProps) {
  const qrDataUrl = await ticketQrDataUrl(code);
  const typeLabel = ticketTypeLabel(typeName, kind);
  const named = cleanSessionName(sessionName);
  const when = formatSessionWhen(startsAt, endsAt);
  const position = ticketPositionLabel(index, total);
  const entered = status === "check_in" ? checkedInLabel(checkedInAt) : null;
  const fileName = `ingresso-${safeFileName(eventName)}-${safeFileName(holderName)}-${kind}`;

  return (
    <article className="rounded-2xl border border-byla-border bg-byla-surface p-5 text-center shadow-lg shadow-black/10 sm:p-6 dark:shadow-black/40">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-byla-accent-text">
        Espaço Byla Eventos
      </p>
      <h2 className="mt-2 font-display text-3xl tracking-wide text-foreground">
        {eventName}
      </h2>
      <div className="mt-3 rounded-xl border border-byla-border bg-byla-overlay px-4 py-3 text-foreground">
        {named ? <p className="text-base font-semibold">{named}</p> : null}
        <p className="text-base">{when}</p>
      </div>
      <p className="mt-3 text-sm text-byla-muted">
        {typeLabel}
        {position ? ` · ${position}` : ""}
      </p>
      <div className="mx-auto my-5 inline-block rounded-xl bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={`QR Code do ingresso de ${holderName}`}
          className="h-64 w-64"
          height={256}
          src={qrDataUrl}
          width={256}
        />
      </div>
      <p className="text-lg font-semibold text-foreground">{holderName}</p>
      <div className="mt-4">
        <p className="text-sm font-semibold text-byla-muted">
          Código para digitação manual
        </p>
        <code className="mt-1 block select-all break-all rounded-lg border border-byla-border bg-byla-overlay px-3 py-2 text-sm text-foreground">
          {code}
        </code>
      </div>
      <p
        className={`mt-3 inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${
          status === "pago"
            ? "border-byla-success/40 bg-byla-success-bg text-byla-success"
            : "border-byla-neutral/30 bg-byla-neutral-bg text-byla-neutral"
        }`}
      >
        {statusLabels[status]}
      </p>
      {entered ? <p className="mt-1 text-sm text-byla-muted">{entered}</p> : null}
      <p className="mt-3 text-sm text-byla-muted">
        Local: {venue} · Pedido nº {orderNumber}
      </p>
      <DownloadTicketPdf
        ticket={{
          code,
          fileName: fileName || "ingresso",
          lines: ticketPdfLines({
            eventName,
            sessionName: named,
            startsAt,
            endsAt,
            venue,
            holderName,
            typeLabel,
            orderNumber,
            index,
            total,
            statusLabel: entered ? `${statusLabels[status]} (${entered})` : statusLabels[status],
          }),
          qrDataUrl,
        }}
      />
    </article>
  );
}
