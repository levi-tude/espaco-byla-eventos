import { sessionDayKey } from "@/lib/datetime";

export const PAST_PAGE_SIZE = 12;
export const PAST_MAX_LIMIT = 120;

const MONTHS = [
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

type Day = { day: number; month: string; year: string };

function toDay(key: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return null;
  return { year: match[1], month, day: Number(match[3]) };
}

/**
 * Data do card de evento passado, no horário de Brasília: "10 de outubro de 2026",
 * "10 e 11 de outubro de 2026" ou "De 10 a 12 de outubro de 2026".
 */
export function pastEventDateLabel(startsAt: readonly string[]): string {
  const days = [...new Set(startsAt.map((start) => sessionDayKey(start)).filter(Boolean))]
    .sort()
    .map(toDay)
    .filter((day): day is Day => day !== null);
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return "";

  const full = (day: Day) => `${day.day} de ${day.month} de ${day.year}`;
  if (days.length === 1) return full(first);

  const start =
    first.year !== last.year
      ? full(first)
      : first.month !== last.month
        ? `${first.day} de ${first.month}`
        : String(first.day);
  return days.length === 2 ? `${start} e ${full(last)}` : `De ${start} a ${full(last)}`;
}

/** `?passados=` da página inicial: múltiplo de 12 entre 12 e 120; inválido vira 12. */
export function parsePastLimit(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,6}$/.test(raw)) return PAST_PAGE_SIZE;
  const steps = Math.max(Math.floor(Number(raw) / PAST_PAGE_SIZE), 1);
  return Math.min(steps * PAST_PAGE_SIZE, PAST_MAX_LIMIT);
}

/** Valor do próximo "Ver mais", ou `null` quando já está no máximo. */
export function nextPastLimit(limit: number): number | null {
  return limit < PAST_MAX_LIMIT ? limit + PAST_PAGE_SIZE : null;
}

/** Mesma regra do banco: passado a partir do dia seguinte (Brasília) ao fim da última sessão. */
export function isPastEventDay(
  lastSessionAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const lastDay = sessionDayKey(lastSessionAt);
  return lastDay !== "" && sessionDayKey(now) > lastDay;
}
