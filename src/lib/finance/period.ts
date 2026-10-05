/**
 * Período da página "Taxa de serviço" (`?de=AAAA-MM&ate=AAAA-MM`), contado pela data
 * da última sessão de cada evento. Inválido ou maior que 24 meses ⇒ mês atual.
 */

export const FEE_PERIOD_MAX_MONTHS = 24;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type FeePeriod = {
  /** "2026-10" */
  fromMonth: string;
  toMonth: string;
  /** Primeiro dia do mês inicial ("2026-10-01"). */
  from: string;
  /** Último dia do mês final ("2026-10-31"). */
  to: string;
};

function monthIndex(month: string): number | null {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 2000 || year > 2100) return null;
  return year * 12 + Number(match[2]) - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function periodOf(fromMonth: string, toMonth: string): FeePeriod {
  return { fromMonth, toMonth, from: `${fromMonth}-01`, to: lastDayOf(toMonth) };
}

/** Mês atual a partir do dia de hoje em São Paulo ("2026-10-04" → "2026-10"). */
export function currentMonth(today: string): string {
  return today.slice(0, 7);
}

function single(value: string | string[] | null | undefined): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function parseFeePeriod(
  de: string | string[] | null | undefined,
  ate: string | string[] | null | undefined,
  today: string,
): FeePeriod {
  const fallback = periodOf(currentMonth(today), currentMonth(today));
  const fromMonth = single(de);
  if (!fromMonth) return fallback;
  const toMonth = single(ate) || fromMonth;
  const fromIndex = monthIndex(fromMonth);
  const toIndex = monthIndex(toMonth);
  if (fromIndex === null || toIndex === null) return fallback;
  if (toIndex < fromIndex || toIndex - fromIndex + 1 > FEE_PERIOD_MAX_MONTHS) return fallback;
  return periodOf(fromMonth, toMonth);
}

export type FeePeriodShortcut = { label: string; fromMonth: string; toMonth: string };

export function feePeriodShortcuts(today: string): FeePeriodShortcut[] {
  const current = monthIndex(currentMonth(today)) ?? 0;
  return [
    { label: "Este mês", fromMonth: monthFromIndex(current), toMonth: monthFromIndex(current) },
    { label: "Mês passado", fromMonth: monthFromIndex(current - 1), toMonth: monthFromIndex(current - 1) },
    { label: "Últimos 12 meses", fromMonth: monthFromIndex(current - 11), toMonth: monthFromIndex(current) },
  ];
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${MONTH_NAMES[monthNumber - 1]} de ${year}`;
}

/** "outubro de 2026" ou "novembro de 2025 a outubro de 2026". */
export function feePeriodLabel(period: FeePeriod): string {
  return period.fromMonth === period.toMonth
    ? monthLabel(period.fromMonth)
    : `${monthLabel(period.fromMonth)} a ${monthLabel(period.toMonth)}`;
}

export function feePeriodQuery(period: Pick<FeePeriod, "fromMonth" | "toMonth">): string {
  return `de=${period.fromMonth}&ate=${period.toMonth}`;
}

export function feeCsvFileName(period: FeePeriod): string {
  return `taxa-servico-${period.fromMonth}_${period.toMonth}.csv`;
}
