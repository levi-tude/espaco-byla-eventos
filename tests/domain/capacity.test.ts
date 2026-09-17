import { describe, expect, it } from "vitest";
import { assertCapacityAvailable } from "@/lib/domain/capacity";

describe("capacity", () => {
  it("permite até o limite", () => {
    expect(() => assertCapacityAvailable(98, 100, 2)).not.toThrow();
  });
  it("bloqueia acima do limite", () => {
    expect(() => assertCapacityAvailable(99, 100, 2)).toThrow(/capacidade/i);
  });
});
