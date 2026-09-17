import { describe, expect, it } from "vitest";
import { canEnter, countsTowardCapacity } from "@/lib/domain/status";

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
});
