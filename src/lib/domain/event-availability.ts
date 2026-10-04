import "server-only";

import {
  type CategoryAvailability,
  computeAvailability,
  type EventAvailabilityWithTypes,
  type QuotaKind,
  type TypeAvailability,
} from "@/lib/domain/availability";
import type { SupabaseAdmin } from "@/lib/domain/orders";
import { type EventSessionsSummary, parseEventSessionsSummary } from "@/lib/domain/sessions";

function toCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function toOptionalCount(value: unknown): number | null {
  return value === null || value === undefined ? null : toCount(value);
}

function parseCategory(value: unknown): CategoryAvailability {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    quota: toOptionalCount(item.quota),
    sold: toCount(item.sold),
    taken: toCount(item.taken),
    remaining: toOptionalCount(item.remaining),
  };
}

function parseCategories(value: unknown): Record<QuotaKind, CategoryAvailability> {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { inteira: parseCategory(item.inteira), meia: parseCategory(item.meia) };
}

function parseTypes(value: unknown): TypeAvailability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.ticket_type_id !== "string") return [];
    return [
      {
        ticketTypeId: item.ticket_type_id,
        unitsTaken: toCount(item.units_taken),
        unitsSold: toCount(item.units_sold),
        maxUnits: toOptionalCount(item.max_units),
        remainingUnits: toOptionalCount(item.remaining_units),
        hasSales: item.has_sales === true,
        priceCents: toOptionalPrice(item.price_cents),
        onSale: item.on_sale === undefined ? null : item.on_sale === true,
      },
    ];
  });
}

function toOptionalPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function parseAvailability(data: unknown): EventAvailabilityWithTypes | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const result = data as Record<string, unknown>;
  const sold = toCount(result.sold);
  return {
    ...computeAvailability({
      capacity: toCount(result.capacity),
      sold,
      occupied: sold + toCount(result.held),
    }),
    categories: parseCategories(result.categories),
    types: parseTypes(result.types),
    selling: typeof result.selling === "boolean" ? result.selling : null,
  };
}

/**
 * Disponibilidade de uma sessão: lotação, cotas e cada tipo com o preço, o
 * "à venda" e o limite DESTA sessão. Em falha devolve `null` (a RPC do checkout
 * continua barrando).
 */
export async function loadSessionAvailability(
  admin: SupabaseAdmin,
  sessionId: string,
): Promise<EventAvailabilityWithTypes | null> {
  const { data, error } = await admin.rpc("session_availability", {
    p_session_id: sessionId,
  });
  const parsed = error ? null : parseAvailability(data);
  if (!parsed) console.error("[disponibilidade] Falha ao consultar a lotação da sessão.");
  return parsed;
}

/** Sessões do evento com a situação de venda, numa chamada só. `null` em falha. */
export async function loadEventSessions(
  admin: SupabaseAdmin,
  eventId: string,
): Promise<EventSessionsSummary | null> {
  const { data, error } = await admin.rpc("event_sessions_summary", {
    p_event_id: eventId,
  });
  const parsed = error ? null : parseEventSessionsSummary(data);
  if (!parsed) console.error("[disponibilidade] Falha ao consultar as sessões do evento.");
  return parsed;
}

/**
 * Lotação considerando reservas ativas, cotas por categoria e a situação de cada tipo à venda.
 * `event_availability` só executa com service_role. Em falha devolve `null`: a
 * tela perde a dica, mas a RPC do checkout continua barrando acima dos limites.
 */
export async function loadEventAvailability(
  admin: SupabaseAdmin,
  event: { id: string },
): Promise<EventAvailabilityWithTypes | null> {
  const { data, error } = await admin.rpc("event_availability", {
    p_event_id: event.id,
  });

  const parsed = error ? null : parseAvailability(data);
  if (!parsed) console.error("[disponibilidade] Falha ao consultar a lotação do evento.");
  return parsed;
}
