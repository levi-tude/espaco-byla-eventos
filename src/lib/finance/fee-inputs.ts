/** Regras de entrada do financeiro, iguais às do banco (spec seção 13). */

export const FEE_MAX_CENTS = 10_000_000;
export const FEE_NOTE_MAX = 140;
export const FEE_REASON_MIN = 5;
export const FEE_REASON_MAX = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isFeeAmount(value: unknown, options: { allowNegative: boolean }): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value === 0) return false;
  if (!options.allowNegative && value < 0) return false;
  return Math.abs(value) <= FEE_MAX_CENTS;
}

/** Data do PIX "AAAA-MM-DD" que existe no calendário e não é futura. */
export function isValidPixDate(value: unknown, today: string): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  return value <= today;
}

/** Nota opcional: vazia vira `null`; até 140 caracteres, sem quebra de linha. */
export function normalizeFeeNote(value: unknown): { ok: true; note: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string" || /[\r\n]/.test(value)) return { ok: false };
  const note = value.trim();
  if (note.length > FEE_NOTE_MAX) return { ok: false };
  return { ok: true, note: note || null };
}

export function normalizeFeeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= FEE_REASON_MIN && reason.length <= FEE_REASON_MAX ? reason : null;
}

/**
 * Valor digitado em reais, com sinal opcional ("2,50", "-2,50", "1.234,56", "R$ 10").
 * Devolve centavos ou `null` se não der para entender.
 */
export function parseReaisInput(text: string): number | null {
  let value = text.replace(/R\$/gi, "").replace(/\s/g, "").replace(/−/g, "-");
  let sign = 1;
  if (value.startsWith("-")) {
    sign = -1;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }
  if (value.includes(",")) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+\.\d{1,2}$/.test(value)) {
    value = value.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? sign * cents : null;
}
