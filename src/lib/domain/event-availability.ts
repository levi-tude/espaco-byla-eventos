import "server-only";

import { computeAvailability, type EventAvailability } from "@/lib/domain/availability";
import type { SupabaseAdmin } from "@/lib/domain/orders";

/**
 * Lotação considerando reservas ativas. `event_occupied_count` só executa com
 * service_role. Em falha devolve `null`: a tela perde a dica, mas a RPC do
 * checkout continua barrando acima da lotação.
 */
export async function loadEventAvailability(
  admin: SupabaseAdmin,
  event: { id: string; capacity: number },
): Promise<EventAvailability | null> {
  const [occupied, sold] = await Promise.all([
    admin.rpc("event_occupied_count", { p_event_id: event.id }),
    admin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .in("status", ["pago", "check_in"]),
  ]);

  if (occupied.error || sold.error) {
    console.error("[disponibilidade] Falha ao consultar a lotação do evento.");
    return null;
  }

  return computeAvailability({
    capacity: event.capacity,
    sold: sold.count ?? 0,
    occupied: Number(occupied.data ?? 0),
  });
}
