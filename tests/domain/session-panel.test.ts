import { describe, expect, it } from "vitest";

import type { EventAvailabilityWithTypes } from "@/lib/domain/availability";
import {
  orderStatsFor,
  selectPanelSession,
  sessionOrderStats,
  sumAvailability,
} from "@/lib/domain/session-panel";

const NOW = Date.parse("2026-10-10T12:00:00Z");

describe("pedidos por sessão no painel", () => {
  it("conta pagos e marca vendas que impedem a remoção", () => {
    const stats = sessionOrderStats(
      [
        { session_id: "a", status: "pago", expires_at: null },
        { session_id: "a", status: "pago", expires_at: null },
        { session_id: "b", status: "expirado", expires_at: "2026-10-10T11:00:00Z" },
        { session_id: "c", status: "pendente", expires_at: "2026-10-10T12:10:00Z" },
        { session_id: "d", status: "pendente", expires_at: "2026-10-10T11:50:00Z" },
        { session_id: "e", status: "aguardando_decisao", expires_at: null },
      ],
      NOW,
    );
    expect(orderStatsFor(stats, "a")).toEqual({ hasOrders: true, liveOrders: true, paidOrders: 2 });
    expect(orderStatsFor(stats, "b")).toEqual({ hasOrders: true, liveOrders: false, paidOrders: 0 });
    expect(orderStatsFor(stats, "c").liveOrders).toBe(true);
    expect(orderStatsFor(stats, "d").liveOrders).toBe(false);
    expect(orderStatsFor(stats, "e").liveOrders).toBe(true);
    expect(orderStatsFor(stats, "z")).toEqual({ hasOrders: false, liveOrders: false, paidOrders: 0 });
  });
});

describe("aba de sessão do painel", () => {
  const sessions = [{ id: "a" }, { id: "b" }];

  it("sessão única abre sempre a própria sessão", () => {
    expect(selectPanelSession([{ id: "a" }], undefined)).toEqual({ id: "a" });
  });

  it("várias sessões: a pedida, ou “Todas”", () => {
    expect(selectPanelSession(sessions, "b")).toEqual({ id: "b" });
    expect(selectPanelSession(sessions, undefined)).toBeNull();
    expect(selectPanelSession(sessions, "x")).toBeNull();
    expect(selectPanelSession(sessions, ["a", "b"])).toBeNull();
  });
});

function availability(overrides: Partial<EventAvailabilityWithTypes>): EventAvailabilityWithTypes {
  return {
    capacity: 50,
    sold: 10,
    held: 2,
    remaining: 38,
    categories: {
      inteira: { quota: null, sold: 6, taken: 7, remaining: null },
      meia: { quota: 20, sold: 4, taken: 5, remaining: 15 },
    },
    types: [
      { ticketTypeId: "t1", unitsTaken: 7, unitsSold: 6, maxUnits: null, remainingUnits: null, hasSales: true },
    ],
    selling: false,
    ...overrides,
  };
}

describe("aba “Todas”", () => {
  it("soma lotação, vendidos, cotas e tipos das sessões", () => {
    const total = sumAvailability([
      availability({}),
      availability({
        selling: true,
        categories: {
          inteira: { quota: 30, sold: 1, taken: 1, remaining: 29 },
          meia: { quota: 20, sold: 0, taken: 0, remaining: 20 },
        },
        types: [
          { ticketTypeId: "t1", unitsTaken: 1, unitsSold: 1, maxUnits: 5, remainingUnits: 4, hasSales: false },
        ],
      }),
    ]);
    expect(total).toMatchObject({ capacity: 100, sold: 20, held: 4, remaining: 76, selling: true });
    expect(total?.categories.inteira).toEqual({ quota: null, sold: 7, taken: 8, remaining: null });
    expect(total?.categories.meia).toEqual({ quota: 40, sold: 4, taken: 5, remaining: 35 });
    expect(total?.types[0]).toMatchObject({ unitsTaken: 8, unitsSold: 7, hasSales: true });
  });

  it("sem a contagem de alguma sessão, não inventa total", () => {
    expect(sumAvailability([availability({}), null])).toBeNull();
    expect(sumAvailability([])).toBeNull();
  });
});
