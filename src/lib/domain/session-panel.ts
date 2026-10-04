import type { EventAvailabilityWithTypes } from "@/lib/domain/availability";

/** Situação dos pedidos de cada sessão (remover × cancelar, aviso de horário). */
export type SessionOrderStats = {
  hasOrders: boolean;
  /** Pago, aguardando decisão ou reserva ativa (mesma regra do banco). */
  liveOrders: boolean;
  paidOrders: number;
};

const EMPTY_STATS: SessionOrderStats = { hasOrders: false, liveOrders: false, paidOrders: 0 };

export function sessionOrderStats(
  orders: readonly { session_id: string; status: string; expires_at: string | null }[],
  now = Date.now(),
): Map<string, SessionOrderStats> {
  const stats = new Map<string, SessionOrderStats>();
  for (const order of orders) {
    const current = stats.get(order.session_id) ?? { ...EMPTY_STATS };
    current.hasOrders = true;
    if (order.status === "pago") current.paidOrders += 1;
    const activeHold =
      order.status === "pendente" &&
      order.expires_at !== null &&
      Date.parse(order.expires_at) > now;
    if (order.status === "pago" || order.status === "aguardando_decisao" || activeHold) {
      current.liveOrders = true;
    }
    stats.set(order.session_id, current);
  }
  return stats;
}

export function orderStatsFor(
  stats: ReadonlyMap<string, SessionOrderStats>,
  sessionId: string,
): SessionOrderStats {
  return stats.get(sessionId) ?? EMPTY_STATS;
}

/**
 * Sessão aberta no painel: a única, ou a pedida em `?sessao=`; `null` = "Todas".
 * Id desconhecido também cai em "Todas".
 */
export function selectPanelSession<T extends { id: string }>(
  sessions: readonly T[],
  requested: string | string[] | undefined,
): T | null {
  if (sessions.length === 1) return sessions[0];
  if (typeof requested !== "string") return null;
  return sessions.find((session) => session.id === requested) ?? null;
}

/** Soma da disponibilidade das sessões (aba "Todas"); `null` se faltar alguma. */
export function sumAvailability(
  list: readonly (EventAvailabilityWithTypes | null)[],
): EventAvailabilityWithTypes | null {
  if (!list.length || list.some((item) => item === null)) return null;
  const items = list as EventAvailabilityWithTypes[];
  const sumCategory = (kind: "inteira" | "meia") => {
    const categories = items.map((item) => item.categories[kind]);
    const allQuotas = categories.every((category) => category.quota !== null);
    return {
      quota: allQuotas ? categories.reduce((total, c) => total + (c.quota ?? 0), 0) : null,
      sold: categories.reduce((total, c) => total + c.sold, 0),
      taken: categories.reduce((total, c) => total + c.taken, 0),
      remaining: allQuotas ? categories.reduce((total, c) => total + (c.remaining ?? 0), 0) : null,
    };
  };
  const types = new Map<string, EventAvailabilityWithTypes["types"][number]>();
  for (const item of items) {
    for (const type of item.types) {
      const current = types.get(type.ticketTypeId);
      types.set(
        type.ticketTypeId,
        current
          ? {
              ...current,
              unitsTaken: current.unitsTaken + type.unitsTaken,
              unitsSold: current.unitsSold + type.unitsSold,
              hasSales: current.hasSales || type.hasSales,
            }
          : { ...type },
      );
    }
  }
  return {
    capacity: items.reduce((total, item) => total + item.capacity, 0),
    sold: items.reduce((total, item) => total + item.sold, 0),
    held: items.reduce((total, item) => total + item.held, 0),
    remaining: items.reduce((total, item) => total + item.remaining, 0),
    categories: { inteira: sumCategory("inteira"), meia: sumCategory("meia") },
    types: [...types.values()],
    selling: items.some((item) => item.selling === true),
  };
}
