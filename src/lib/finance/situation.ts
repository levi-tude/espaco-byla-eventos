import { sessionDayKey } from "@/lib/datetime";
import type { FeeSituation } from "@/lib/domain/fee-payout";
import { formatMoney } from "@/lib/domain/service-fee";

/** "2026-10-06" → "06/10/2026". */
export function formatDayKey(dayKey: string | null | undefined): string {
  const match = dayKey ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dayKey) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** Desconto com sinal de menos tipográfico: "−R$ 2,50". */
export function formatDiscount(cents: number): string {
  return `−${formatMoney(Math.abs(cents))}`;
}

/** Valor com sinal explícito para ajustes: "+R$ 2,00" ou "−R$ 2,00". */
export function formatSigned(cents: number): string {
  return cents < 0 ? formatDiscount(cents) : `+${formatMoney(cents)}`;
}

/** Texto curto da situação, igual na tela e na planilha (spec 8.2). */
export function feeSituationLabel(situation: FeeSituation): string {
  switch (situation.kind) {
    case "aguardando":
      return "Aguardando fim do evento";
    case "a_pagar":
      return `A pagar · ${formatMoney(situation.balanceCents)}`;
    case "pago": {
      const day = formatDayKey(situation.last.pixDate ?? sessionDayKey(situation.last.createdAt)).slice(0, 5);
      return `Pago em ${day} por ${situation.last.createdByName}`;
    }
    case "sem_taxa":
      return "Sem taxa";
    case "desconto":
      return `Desconto pendente · ${formatDiscount(situation.balanceCents)}`;
  }
}

/** Linha de apoio da situação, quando ajuda a decidir. */
export function feeSituationDetail(situation: FeeSituation): string | null {
  if (situation.kind === "aguardando" && situation.dueDate) {
    return `Fica a pagar a partir de ${formatDayKey(situation.dueDate)}.`;
  }
  if (situation.kind === "desconto") return "Será descontado do próximo repasse.";
  return null;
}
