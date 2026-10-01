import { describe, expect, it } from "vitest";
import { canEnter, countsTowardCapacity, isRecentlyPaid } from "@/lib/domain/status";

describe("status", () => {
  it("só pago pode entrar", () => {
    expect(canEnter("pago")).toBe(true);
    expect(canEnter("nao_pago")).toBe(false);
    expect(canEnter("cancelado")).toBe(false);
    expect(canEnter("check_in")).toBe(false);
  });

  it("pago e cortesia-check_in contam capacidade; nao_pago e cancelado não", () => {
    expect(countsTowardCapacity("pago")).toBe(true);
    expect(countsTowardCapacity("check_in")).toBe(true);
    expect(countsTowardCapacity("nao_pago")).toBe(false);
    expect(countsTowardCapacity("cancelado")).toBe(false);
  });

  it("selo 'Novo' só para pagamento nas últimas 24 h", () => {
    const now = Date.parse("2026-10-01T15:00:00Z");
    expect(isRecentlyPaid("2026-10-01T14:59:00Z", now)).toBe(true);
    expect(isRecentlyPaid("2026-09-30T15:00:01Z", now)).toBe(true);
    expect(isRecentlyPaid("2026-09-30T15:00:00Z", now)).toBe(false);
    expect(isRecentlyPaid(null, now)).toBe(false);
    expect(isRecentlyPaid("data inválida", now)).toBe(false);
  });
});
