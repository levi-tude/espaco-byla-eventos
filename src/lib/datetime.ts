export const EVENT_TIME_ZONE = "America/Sao_Paulo";

// Brasil não tem horário de verão desde 2019.
const EVENT_UTC_OFFSET = "-03:00";

const LOCAL_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function eventDateFormatter(
  options: Pick<Intl.DateTimeFormatOptions, "dateStyle" | "timeStyle">,
) {
  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    timeZone: EVENT_TIME_ZONE,
  });
}

/** Valor de `<input type="datetime-local">` no horário de Brasília. */
export function toEventInputValue(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: EVENT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

type ZonedParts = {
  dayKey: string;
  weekdayLong: string;
  weekdayShort: string;
  day: string;
  dayPadded: string;
  monthPadded: string;
  monthLong: string;
  year: string;
  time: string;
};

const numericParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: EVENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdayLongFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: EVENT_TIME_ZONE,
  weekday: "long",
});
const weekdayShortFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: EVENT_TIME_ZONE,
  weekday: "short",
});
const monthLongFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: EVENT_TIME_ZONE,
  month: "long",
});

function zonedParts(value: string | Date | null | undefined): ZonedParts | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    numericParts.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekdayLong: weekdayLongFormatter.format(date),
    weekdayShort: weekdayShortFormatter.format(date).replace(/\.$/, ""),
    day: String(Number(parts.day)),
    dayPadded: parts.day,
    monthPadded: parts.month,
    monthLong: monthLongFormatter.format(date),
    year: parts.year,
    time: `${parts.hour}h${parts.minute}`,
  };
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Horário no padrão brasileiro: "19h00". */
export function formatSessionTime(value: string | Date | null | undefined): string {
  return zonedParts(value)?.time ?? "";
}

/**
 * Data e horário da sessão, formato longo: "Sábado, 10 de outubro de 2026 · 19h00",
 * com o término se houver ("· 19h00 – 21h30"; no dia seguinte, "– 01h00 (domingo)").
 */
export function formatSessionWhen(
  startsAt: string | Date | null | undefined,
  endsAt?: string | Date | null,
): string {
  const start = zonedParts(startsAt);
  if (!start) return "";
  const text = `${capitalize(start.weekdayLong)}, ${start.day} de ${start.monthLong} de ${start.year} · ${start.time}`;
  const end = zonedParts(endsAt);
  if (!end) return text;
  return end.dayKey === start.dayKey
    ? `${text} – ${end.time}`
    : `${text} – ${end.time} (${end.weekdayLong})`;
}

/** Formato curto (portaria, listas): "sáb, 10/10 · 19h00". */
export function formatSessionShort(startsAt: string | Date | null | undefined): string {
  const start = zonedParts(startsAt);
  if (!start) return "";
  return `${start.weekdayShort}, ${start.dayPadded}/${start.monthPadded} · ${start.time}`;
}

/** Para assuntos de e-mail: "sáb 10/10 às 19h00". */
export function formatSessionSubject(startsAt: string | Date | null | undefined): string {
  const start = zonedParts(startsAt);
  if (!start) return "";
  return `${start.weekdayShort} ${start.dayPadded}/${start.monthPadded} às ${start.time}`;
}

/** Interpreta data/hora sem fuso (vinda do formulário) como horário de Brasília. */
export function parseEventInputValue(value: string) {
  const trimmed = value.trim();
  if (LOCAL_INPUT_PATTERN.test(trimmed)) {
    const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    return new Date(`${withSeconds}${EVENT_UTC_OFFSET}`);
  }
  return new Date(trimmed);
}
