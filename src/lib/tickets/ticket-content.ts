import { formatSessionShort, formatSessionTime, formatSessionWhen } from "@/lib/datetime";
import { sessionName } from "@/lib/domain/sessions";

/** Tudo o que um ingresso mostra (spec de sessões, seção 8.4.2). */
export type TicketContent = {
  eventName: string;
  sessionName: string | null;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  holderName: string;
  typeLabel: string;
  orderNumber: string;
  index: number;
  total: number;
  statusLabel: string;
};

export type TicketPdfLine = readonly [label: string, value: string];

/** "Ingresso 2 de 4" só quando o pedido tem mais de um ingresso. */
export function ticketPositionLabel(index: number, total: number): string | null {
  return total > 1 ? `Ingresso ${index} de ${total}` : null;
}

/** "Entrou em 10/10 às 19h12" (horário de Brasília). */
export function checkedInLabel(checkedInAt: string | null | undefined): string | null {
  const short = formatSessionShort(checkedInAt);
  if (!short) return null;
  const date = short.split(" · ")[0].split(", ")[1] ?? "";
  return `Entrou em ${date} às ${formatSessionTime(checkedInAt)}`;
}

/**
 * As fontes padrão do PDF só têm o alfabeto latino básico (acentos do português
 * incluídos); travessões e aspas curvas viram equivalentes simples.
 */
export function pdfSafeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u2012-\u2015]/g, "-")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0020-\u00FF]/g, "");
}

export function ticketPdfLines(content: TicketContent): TicketPdfLine[] {
  const named = sessionName(content.sessionName);
  const position = ticketPositionLabel(content.index, content.total);
  const lines: Array<TicketPdfLine | null> = [
    ["Evento", content.eventName],
    named ? ["Sessão", named] : null,
    ["Quando", formatSessionWhen(content.startsAt, content.endsAt)],
    ["Local", content.venue],
    ["Participante", content.holderName],
    ["Tipo", content.typeLabel],
    position ? ["Ingresso", position.replace("Ingresso ", "")] : null,
    ["Pedido nº", content.orderNumber],
    ["Status", content.statusLabel],
  ];
  return lines
    .filter((line): line is TicketPdfLine => line !== null && line[1] !== "")
    .map(([label, value]) => [pdfSafeText(label), pdfSafeText(value)] as const);
}
