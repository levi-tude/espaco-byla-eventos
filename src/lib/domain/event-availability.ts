import "server-only";

import {
  computeAvailability,
  type EventAvailabilityWithTypes,
  type TypeAvailability,
} from "@/lib/domain/availability";
import type { SupabaseAdmin } from "@/lib/domain/orders";

function toCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function toOptionalCount(value: unknown): number | null {
  return value === null || value === undefined ? null : toCount(value);
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
      },
    ];
  });
}

/**
 * Lotação considerando reservas ativas, e a situação de cada tipo à venda.
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

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    console.error("[disponibilidade] Falha ao consultar a lotação do evento.");
    return null;
  }

  const result = data as Record<string, unknown>;
  const sold = toCount(result.sold);
  return {
    ...computeAvailability({
      capacity: toCount(result.capacity),
      sold,
      occupied: sold + toCount(result.held),
    }),
    types: parseTypes(result.types),
  };
}
