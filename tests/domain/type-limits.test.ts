import { describe, expect, it } from "vitest";

import {
  limitedTypesFromRpcItems,
  limitPeople,
  type LimitedType,
  typeLimitsError,
  typeLimitsSummary,
} from "@/lib/domain/type-limits";

const noQuotas = { inteiraQuota: null, meiaQuota: null };
const type = (o: Partial<LimitedType>): LimitedType => ({
  name: "Inteira",
  kind: "inteira",
  peoplePerUnit: 1,
  maxUnits: null,
  ...o,
});

describe("limites dos tipos em ingressos", () => {
  it("converte os itens da função do banco (tipos prontos e da equipe)", () => {
    expect(
      limitedTypesFromRpcItems([
        { preset: "casadinha", price_cents: 9000, max_units: 3 },
        { preset: "meia", price_cents: 2500, max_units: null },
        { id: null, name: "Mesa", people_per_unit: 6, price_cents: 30000, max_units: 2 },
      ]),
    ).toEqual([
      { name: "Casadinha", kind: "inteira", peoplePerUnit: 2, maxUnits: 3 },
      { name: "Meia-entrada", kind: "meia", peoplePerUnit: 1, maxUnits: null },
      { name: "Mesa", kind: "inteira", peoplePerUnit: 6, maxUnits: 2 },
    ]);
  });

  it("conta o limite em pessoas", () => {
    expect(limitPeople(type({ peoplePerUnit: 2, maxUnits: 3 }))).toBe(6);
    expect(limitPeople(type({}))).toBeNull();
  });

  it("aceita limites que cabem no total e nas cotas", () => {
    expect(
      typeLimitsError(10, { inteiraQuota: 6, meiaQuota: 4 }, [
        type({ maxUnits: 2 }),
        type({ name: "Casadinha", peoplePerUnit: 2, maxUnits: 2 }),
        type({ name: "Meia-entrada", kind: "meia", maxUnits: 4 }),
        type({ name: "Pacote família", peoplePerUnit: 4 }),
      ]),
    ).toBeNull();
    expect(typeLimitsError(10, noQuotas, [type({ maxUnits: 10 })])).toBeNull();
  });

  it("recusa limite acima do total (caso do dono: 50 com total 10)", () => {
    expect(typeLimitsError(10, noQuotas, [type({ maxUnits: 50 })])).toBe(
      "O limite de “Inteira” (50) passa do total da sessão (10). Diminua o limite ou aumente o total.",
    );
  });

  it("pacote conta as pessoas de cada unidade", () => {
    expect(
      typeLimitsError(5, noQuotas, [type({ name: "Casadinha", peoplePerUnit: 2, maxUnits: 3 })]),
    ).toBe(
      "O limite de “Casadinha” (3 × 2 pessoas = 6 ingressos) passa do total da sessão (5). Diminua o limite ou aumente o total.",
    );
  });

  it("recusa limite acima da cota da categoria", () => {
    expect(
      typeLimitsError(20, { inteiraQuota: null, meiaQuota: 3 }, [
        type({ name: "Meia-entrada", kind: "meia", maxUnits: 4 }),
      ]),
    ).toBe(
      "O limite de “Meia-entrada” (4) passa da quantidade de meias (3). Diminua o limite ou aumente a quantidade de meias.",
    );
  });

  it("recusa a soma dos limites acima do total", () => {
    expect(
      typeLimitsError(10, noQuotas, [
        type({ maxUnits: 8 }),
        type({ name: "Meia-entrada", kind: "meia", maxUnits: 6 }),
        type({ name: "Casadinha", peoplePerUnit: 2 }),
      ]),
    ).toBe("A soma dos limites dos tipos (14 ingressos) passa do total (10). Diminua algum limite ou aumente o total.");
  });

  it("recusa a soma dos limites da categoria acima da cota", () => {
    expect(
      typeLimitsError(20, { inteiraQuota: 5, meiaQuota: null }, [
        type({ maxUnits: 3 }),
        type({ name: "Casadinha", peoplePerUnit: 2, maxUnits: 2 }),
        type({ name: "Meia-entrada", kind: "meia", maxUnits: 10 }),
      ]),
    ).toBe(
      "A soma dos limites das inteiras (7 ingressos) passa da quantidade de inteiras (5). Diminua algum limite ou aumente a quantidade de inteiras.",
    );
  });

  it("resumo ao vivo mostra o que os tipos sem limite dividem", () => {
    expect(typeLimitsSummary(10, [type({})])).toBeNull();
    expect(
      typeLimitsSummary(10, [type({ name: "Casadinha", peoplePerUnit: 2, maxUnits: 3 }), type({})]),
    ).toBe("Limites dos tipos: 6 de 10 ingressos. Os tipos sem limite dividem os 4 que sobram.");
    expect(typeLimitsSummary(10, [type({ maxUnits: 10 })])).toBe(
      "Limites dos tipos: 10 de 10 ingressos. Tudo distribuído entre os tipos.",
    );
    expect(typeLimitsSummary(10, [type({ maxUnits: 7 })])).toBe(
      "Limites dos tipos: 7 de 10 ingressos. Sobram 3 que nenhum tipo pode vender (só cortesias).",
    );
    expect(typeLimitsSummary(Number.NaN, [type({ maxUnits: 7 })])).toBeNull();
  });
});
