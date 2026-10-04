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

/** Sessão com a situação de venda (`event_sessions_summary`). */
export type SessionSaleSummary = SessionSummary & {
  /** Chave da equipe para esta sessão (a do evento vale à parte). */
  salesOpen: boolean;
  /** Evento e sessão abertos, sessão ativa e antes de início + 5 min. */
  selling: boolean;
  soldOut: boolean;
  /** Lugares livres (vendidos e reservas ativas já descontados). */
  remaining: number;
  /** Menor preço à venda e não esgotado nesta sessão; `null` = nenhum. */
  minPriceCents: number | null;
};

export type EventSessionsSummary = {
  /** Menor preço entre as sessões vendendo e com lugar. */
  minPriceCents: number | null;
  sessions: SessionSaleSummary[];
};

/** "Últimos N" aparece com até 20 lugares (mesmo limite dos avisos de lotação). */
export const SESSION_LOW_REMAINING = 20;

function toCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function toPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

/** Lê o JSON de `event_sessions_summary`; entradas inválidas são ignoradas. */
export function parseEventSessionsSummary(value: unknown): EventSessionsSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
  const sessions = rawSessions.flatMap((raw): SessionSaleSummary[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.starts_at !== "string") return [];
    return [
      {
        id: item.id,
        name: typeof item.name === "string" ? item.name : null,
        startsAt: item.starts_at,
        endsAt: typeof item.ends_at === "string" ? item.ends_at : null,
        status: item.status === "cancelada" ? "cancelada" : "ativa",
        salesOpen: item.sales_open !== false,
        selling: item.selling === true,
        soldOut: item.sold_out === true,
        remaining: toCount(item.remaining),
        minPriceCents: toPrice(item.min_price_cents),
      },
    ];
  });
  sessions.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { minPriceCents: toPrice(data.min_price_cents), sessions };
}

/** Terminou: passou do término ou, sem término, 4 h depois do início. */
export function isSessionFinished(
  session: Pick<SessionSummary, "startsAt" | "endsAt">,
  now = Date.now(),
): boolean {
  const start = Date.parse(session.startsAt);
  if (!Number.isFinite(start)) return false;
  const endParsed = session.endsAt ? Date.parse(session.endsAt) : Number.NaN;
  const end = Number.isFinite(endParsed) ? endParsed : start + 4 * HOUR_MS;
  return now > end;
}

/** Sessões que o comprador vê: ativas e ainda não terminadas, em ordem de horário. */
export function buyerVisibleSessions<T extends SessionSaleSummary>(
  sessions: readonly T[],
  now = Date.now(),
): T[] {
  return sessions
    .filter((session) => session.status === "ativa" && !isSessionFinished(session, now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export type SessionAvailabilityBadge =
  | { kind: "sold_out"; label: string }
  | { kind: "closed"; label: string }
  | { kind: "low"; label: string }
  | { kind: "open"; label: null };

/** Selo da sessão para o comprador: "Esgotada", "Vendas encerradas" ou "Últimos N". */
export function sessionAvailabilityBadge(session: SessionSaleSummary): SessionAvailabilityBadge {
  if (session.soldOut) return { kind: "sold_out", label: "Esgotada" };
  if (!session.selling) return { kind: "closed", label: "Vendas encerradas" };
  if (session.remaining <= SESSION_LOW_REMAINING) {
    return { kind: "low", label: `Últimos ${session.remaining}` };
  }
  return { kind: "open", label: null };
}

/** A sessão aceita compra agora (vendendo e com lugar). */
export function sessionIsBuyable(session: SessionSaleSummary): boolean {
  return session.status === "ativa" && session.selling && !session.soldOut && session.remaining > 0;
}

/**
 * Sessão marcada para o comprador: a pedida em `?sessao=` (se ele pode vê-la);
 * senão a única do evento ou a única vendendo. `null` = ele escolhe.
 */
export function pickBuyerSession<T extends SessionSaleSummary>(
  visible: readonly T[],
  requested: unknown,
): T | null {
  if (typeof requested === "string") {
    const found = visible.find((session) => session.id === requested);
    if (found) return found;
  }
  if (visible.length === 1) return visible[0];
  const buyable = visible.filter(sessionIsBuyable);
  return buyable.length === 1 ? buyable[0] : null;
}

/** Sessões que aparecem como chips na home: futuras, vendendo ou esgotadas. */
export function homeChipSessions<T extends SessionSaleSummary>(
  sessions: readonly T[],
  now = Date.now(),
): T[] {
  return sessions
    .filter(
      (session) =>
        session.status === "ativa" &&
        Date.parse(session.startsAt) > now &&
        (session.selling || session.soldOut),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

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
