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

/** Interpreta data/hora sem fuso (vinda do formulário) como horário de Brasília. */
export function parseEventInputValue(value: string) {
  const trimmed = value.trim();
  if (LOCAL_INPUT_PATTERN.test(trimmed)) {
    const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    return new Date(`${withSeconds}${EVENT_UTC_OFFSET}`);
  }
  return new Date(trimmed);
}
