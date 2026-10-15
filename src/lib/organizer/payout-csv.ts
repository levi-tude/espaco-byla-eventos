/**
 * Planilha dos repasses aos organizadores: uma linha por item de lançamento, sem chave
 * PIX, titular ou documento. Mesmo formato da planilha da taxa de serviço.
 */

import { sessionDayKey } from "@/lib/datetime";
import { csvMoney, csvText } from "@/lib/finance/fee-csv";
import { formatDayKey } from "@/lib/finance/situation";
import type { PayoutKind } from "@/lib/organizer/finance";

export type PayoutCsvRow = {
  pixDate: string | null;
  createdAt: string;
  kind: PayoutKind;
  organizer: string;
  event: string;
  amountCents: number;
  createdByName: string;
  noteOrReason: string | null;
};

export const PAYOUT_CSV_HEADER = [
  "Data do PIX",
  "Registrado em",
  "Tipo",
  "Organizador",
  "Evento",
  "Valor (R$)",
  "Registrado por",
  "Nota ou motivo",
];

/** Item positivo diminui o saldo do organizador; negativo aumenta. */
export function payoutItemLabel(kind: PayoutKind, amountCents: number): string {
  switch (kind) {
    case "repasse":
      return amountCents >= 0 ? "Repasse" : "Desconto no repasse";
    case "compensacao":
      return amountCents >= 0 ? "Compensação" : "Desconto na compensação";
    case "ajuste":
      return amountCents >= 0 ? "Ajuste a favor do Espaço" : "Ajuste a favor do organizador";
    case "devolucao":
      return "Devolução recebida";
  }
}

function quote(cell: string): string {
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function buildPayoutsCsv(rows: readonly PayoutCsvRow[]): string {
  const lines = [
    PAYOUT_CSV_HEADER,
    ...rows.map((row) => [
      formatDayKey(row.pixDate),
      formatDayKey(sessionDayKey(row.createdAt)),
      payoutItemLabel(row.kind, row.amountCents),
      csvText(row.organizer),
      csvText(row.event),
      csvMoney(Math.abs(row.amountCents)),
      csvText(row.createdByName),
      csvText(row.noteOrReason),
    ]),
  ].map((row) => row.map(quote).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
