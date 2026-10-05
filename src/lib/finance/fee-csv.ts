/**
 * Planilha da taxa de serviço (spec 10.4): uma linha por evento, sem dados de
 * compradores. Formato do Excel brasileiro: `;`, vírgula decimal, UTF-8 com BOM, CRLF.
 */

import { feeSituation, type OverviewEvent } from "@/lib/domain/fee-payout";
import { feeSituationLabel, formatDayKey } from "@/lib/finance/situation";

export const FEE_CSV_HEADER = [
  "Evento",
  "Data da última sessão",
  "Vendido (R$)",
  "Taxa (R$)",
  "Estornado (R$)",
  "Contestado (R$)",
  "Taxa devida (R$)",
  "Repassado (R$)",
  "Saldo (R$)",
  "Situação",
  "Data do PIX",
  "Marcado por",
  "Nota",
];

/** Centavos sem símbolo: "1234,56" / "-2,50". */
export function csvMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Texto livre (nome do evento, nota, quem marcou) que começa com caractere de fórmula
 * recebe `'` na frente, para o Excel não executar. Valores em dinheiro não passam por
 * aqui: "-2,50" precisa continuar número.
 */
export function csvText(value: string | null | undefined): string {
  const text = value ?? "";
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function quote(cell: string): string {
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function feeCsvRow(event: OverviewEvent, today: string): string[] {
  const situation = feeSituation({
    dueDate: event.dueDate,
    balanceCents: event.balanceCents,
    lastPayout: event.lastPayout,
    today,
  });
  return [
    csvText(event.name),
    formatDayKey(event.lastSessionAt),
    csvMoney(event.ticketsCents),
    csvMoney(event.feeCents),
    csvMoney(event.refundedCents),
    csvMoney(event.contestedCents),
    csvMoney(event.feeDueCents),
    csvMoney(event.paidOutCents),
    csvMoney(event.balanceCents),
    csvText(feeSituationLabel(situation).replace(/\u00a0/g, " ")),
    formatDayKey(event.lastPayout?.pixDate),
    csvText(event.lastPayout?.createdByName),
    csvText(event.lastPayout?.note),
  ];
}

export function buildFeeCsv(events: readonly OverviewEvent[], today: string): string {
  const lines = [FEE_CSV_HEADER, ...events.map((event) => feeCsvRow(event, today))].map((row) =>
    row.map(quote).join(";"),
  );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
