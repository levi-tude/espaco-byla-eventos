import { describe, expect, it } from "vitest";

import {
  formatSessionChip,
  formatSessionDay,
  formatSessionLabel,
  sessionDayKey,
} from "@/lib/datetime";
import {
  buyerVisibleSessions,
  isSessionFinished,
  parseEventSessionsSummary,
  type SessionSaleSummary,
  sessionAvailabilityBadge,
  sessionIsBuyable,
} from "@/lib/domain/sessions";

// 2026-10-10 é sábado; 19h00 em Brasília = 22h00 UTC.
const SAT_19H = "2026-10-10T22:00:00.000Z";
const SAT_2030 = "2026-10-10T23:30:00.000Z";
const HOUR = 60 * 60 * 1000;

function session(overrides: Partial<SessionSaleSummary> = {}): SessionSaleSummary {
  return {
    id: "s1",
    name: null,
    startsAt: SAT_19H,
    endsAt: null,
    status: "ativa",
    salesOpen: true,
    selling: true,
    soldOut: false,
    remaining: 80,
    minPriceCents: 5000,
    ...overrides,
  };
}

describe("rótulos da sessão", () => {
  it("rótulo com nome e término", () => {
    expect(formatSessionLabel("Matinê", SAT_19H, "2026-10-11T00:30:00.000Z")).toBe(
      "Matinê · sáb, 10/10 · 19h00 – 21h30",
    );
  });

  it("rótulo sem nome nem término", () => {
    expect(formatSessionLabel(null, SAT_19H)).toBe("sáb, 10/10 · 19h00");
    expect(formatSessionLabel("  ", SAT_19H)).toBe("sáb, 10/10 · 19h00");
  });

  it("término no dia seguinte mostra o dia", () => {
    expect(formatSessionLabel(null, SAT_19H, "2026-10-11T04:00:00.000Z")).toBe(
      "sáb, 10/10 · 19h00 – 01h00 (dom)",
    );
  });

  it("dia do grupo e chip da home", () => {
    expect(formatSessionDay(SAT_19H)).toBe("Sábado, 10 de outubro");
    expect(sessionDayKey(SAT_19H)).toBe("2026-10-10");
    expect(sessionDayKey("2026-10-11T02:30:00.000Z")).toBe("2026-10-10");
    expect(formatSessionChip(SAT_2030)).toBe("sáb 10/10 · 20h30");
  });

  it("data inválida não quebra", () => {
    expect(formatSessionLabel(null, "x")).toBe("");
    expect(formatSessionChip(null)).toBe("");
  });
});

describe("parseEventSessionsSummary", () => {
  it("lê o JSON do banco e ordena por horário", () => {
    const parsed = parseEventSessionsSummary({
      min_price_cents: 4000,
      sessions: [
        {
          id: "b",
          name: "Noite",
          starts_at: SAT_2030,
          ends_at: null,
          status: "ativa",
          sales_open: true,
          selling: true,
          sold_out: false,
          remaining: 12,
          min_price_cents: 4000,
        },
        {
          id: "a",
          name: null,
          starts_at: SAT_19H,
          ends_at: null,
          status: "cancelada",
          sales_open: false,
          selling: false,
          sold_out: true,
          remaining: 0,
          min_price_cents: null,
        },
        { id: 3, starts_at: SAT_19H },
      ],
    });
    expect(parsed?.minPriceCents).toBe(4000);
    expect(parsed?.sessions.map((item) => item.id)).toEqual(["a", "b"]);
    expect(parsed?.sessions[0]).toMatchObject({ status: "cancelada", soldOut: true, minPriceCents: null });
    expect(parsed?.sessions[1]).toMatchObject({ name: "Noite", remaining: 12, selling: true });
  });

  it("JSON inválido devolve null", () => {
    expect(parseEventSessionsSummary(null)).toBeNull();
    expect(parseEventSessionsSummary([])).toBeNull();
    expect(parseEventSessionsSummary({})).toEqual({ minPriceCents: null, sessions: [] });
  });
});

describe("sessões para o comprador", () => {
  const start = Date.parse(SAT_19H);

  it("termina no término ou 4 h depois do início", () => {
    expect(isSessionFinished(session(), start + 3 * HOUR)).toBe(false);
    expect(isSessionFinished(session(), start + 5 * HOUR)).toBe(true);
    expect(
      isSessionFinished(session({ endsAt: "2026-10-11T00:00:00.000Z" }), start + 2.5 * HOUR),
    ).toBe(true);
  });

  it("esconde canceladas e terminadas", () => {
    const list = [
      session({ id: "late", startsAt: SAT_2030 }),
      session({ id: "cancelled", status: "cancelada" }),
      session({ id: "old", startsAt: "2026-10-09T22:00:00.000Z" }),
      session({ id: "early" }),
    ];
    expect(buyerVisibleSessions(list, start - HOUR).map((item) => item.id)).toEqual([
      "early",
      "late",
    ]);
  });

  it("selos: esgotada, vendas encerradas, últimos N", () => {
    expect(sessionAvailabilityBadge(session({ soldOut: true, remaining: 0 }))).toEqual({
      kind: "sold_out",
      label: "Esgotada",
    });
    expect(sessionAvailabilityBadge(session({ selling: false }))).toEqual({
      kind: "closed",
      label: "Vendas encerradas",
    });
    expect(sessionAvailabilityBadge(session({ remaining: 20 }))).toEqual({
      kind: "low",
      label: "Últimos 20",
    });
    expect(sessionAvailabilityBadge(session({ remaining: 21 })).kind).toBe("open");
  });

  it("compra só em sessão vendendo e com lugar", () => {
    expect(sessionIsBuyable(session())).toBe(true);
    expect(sessionIsBuyable(session({ remaining: 0 }))).toBe(false);
    expect(sessionIsBuyable(session({ selling: false }))).toBe(false);
    expect(sessionIsBuyable(session({ status: "cancelada" }))).toBe(false);
  });
});
