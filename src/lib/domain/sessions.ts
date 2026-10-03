import { formatSessionShort, formatSessionTime } from "@/lib/datetime";

/**
 * A venda de cada sessão fecha sozinha 5 min depois do início. Quem decide é o
 * banco (`session_is_selling` / `session_sales_close_offset`); aqui só para a tela.
 */
export const SESSION_SALES_CLOSE_MINUTES = 5;

const HOUR_MS = 60 * 60 * 1000;

export type SessionStatus = "ativa" | "cancelada";

export type SessionSummary = {
  id: string;
  name: string | null;
  startsAt: string;
  endsAt: string | null;
  status: SessionStatus;
};

export function sessionSalesClosesAt(startsAt: string): Date {
  return new Date(Date.parse(startsAt) + SESSION_SALES_CLOSE_MINUTES * 60_000);
}

/** "Pedido nº A1B2C3D4": 8 primeiros caracteres do id do pedido (nunca o token público). */
export function orderNumber(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Nome da sessão, quando existe (sessão única costuma não ter nome). */
export function sessionName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

export const SALES_CLOSED_MESSAGE = "As vendas desta sessão foram encerradas.";

/** PIX recusado depois do fim da venda: o cartão ainda vale até o fim da reserva. */
export function salesClosedPixMessage(holdExpiresAt: string | null): string {
  const time = holdExpiresAt ? formatSessionTime(holdExpiresAt) : "";
  return time
    ? `${SALES_CLOSED_MESSAGE} Se quiser, pague com cartão até ${time}.`
    : SALES_CLOSED_MESSAGE;
}

/** "Sessão errada — este ingresso é da sessão das 20h30 (sáb, 10/10)", com o nome se houver. */
export function wrongSessionMessage(name: string | null | undefined, startsAt: string | null | undefined): string {
  const named = sessionName(name);
  const time = formatSessionTime(startsAt);
  const short = formatSessionShort(startsAt);
  const date = short.split(" · ")[0];
  if (!time) return named ? `Sessão errada — este ingresso é da sessão “${named}”` : "Sessão errada";
  const when = `${time}${date ? ` (${date})` : ""}`;
  return named
    ? `Sessão errada — este ingresso é da sessão “${named}”, das ${when}`
    : `Sessão errada — este ingresso é da sessão das ${when}`;
}

/**
 * Sessão sugerida ao abrir a portaria: a que está acontecendo (de 2 h antes do
 * início até o término, ou 4 h depois do início sem término); senão a próxima;
 * senão a última. Sessões canceladas não entram.
 */
export function suggestCheckInSession<T extends SessionSummary>(
  sessions: readonly T[],
  now = Date.now(),
): T | null {
  const active = sessions
    .filter((session) => session.status === "ativa" && Number.isFinite(Date.parse(session.startsAt)))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const happening = active.find((session) => {
    const start = Date.parse(session.startsAt);
    const endParsed = session.endsAt ? Date.parse(session.endsAt) : Number.NaN;
    const end = Number.isFinite(endParsed) ? endParsed : start + 4 * HOUR_MS;
    return now >= start - 2 * HOUR_MS && now <= end;
  });
  if (happening) return happening;
  return active.find((session) => Date.parse(session.startsAt) > now) ?? active.at(-1) ?? null;
}
