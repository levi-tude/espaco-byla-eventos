import { describe, expect, it } from "vitest";

import {
  mirrorPrices,
  normalizeSessions,
  type SessionInput,
  sessionsDbErrorMessage,
  type SessionTypeInfo,
} from "@/lib/domain/session-editor";

const types: SessionTypeInfo[] = [
  { name: "Inteira", kind: "inteira", peoplePerUnit: 1 },
  { name: "Meia-entrada", kind: "meia", peoplePerUnit: 1 },
  { name: "Casadinha", kind: "inteira", peoplePerUnit: 2 },
];

function session(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    id: null,
    name: "",
    startsAt: "2026-10-10T19:00",
    endsAt: "",
    capacity: 100,
    inteiraQuota: null,
    meiaQuota: null,
    prices: [
      { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
      { typeIndex: 1, priceCents: 2500, maxUnits: null, onSale: true },
      { typeIndex: 2, priceCents: null, maxUnits: null, onSale: false },
    ],
    ...overrides,
  };
}

describe("normalizeSessions", () => {
  it("converte o horário de Brasília e monta o formato do banco", () => {
    const result = normalizeSessions(
      [session({ name: " Matinê ", endsAt: "2026-10-10T21:30", meiaQuota: 40 })],
      types,
    );
    expect(result).toEqual({
      ok: true,
      items: [
        {
          id: null,
          name: "Matinê",
          starts_at: "2026-10-10T22:00:00.000Z",
          ends_at: "2026-10-11T00:30:00.000Z",
          capacity: 100,
          inteira_quota: null,
          meia_quota: 40,
          prices: [
            { type_index: 0, price_cents: 5000, max_units: null, on_sale: true },
            { type_index: 1, price_cents: 2500, max_units: null, on_sale: true },
            { type_index: 2, price_cents: null, max_units: null, on_sale: false },
          ],
        },
      ],
    });
  });

  it("sessão única: mensagem sem rótulo de sessão", () => {
    expect(normalizeSessions([session({ capacity: 0 })], types)).toEqual({
      ok: false,
      error: "Informe um total de ingressos válido.",
    });
  });

  it("várias sessões: mensagem com número e horário da sessão", () => {
    const result = normalizeSessions(
      [session(), session({ startsAt: "2026-10-10T20:30", inteiraQuota: 80, meiaQuota: 30 })],
      types,
    );
    expect(result).toEqual({
      ok: false,
      error: "Sessão 2 (sáb, 10/10 · 20h30): Inteiras + meias não podem passar do total de ingressos (100).",
    });
  });

  it("recusa horário repetido, término antes do início e início vazio", () => {
    expect(normalizeSessions([session(), session()], types)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Duas sessões não podem começar no mesmo horário."),
    });
    expect(normalizeSessions([session({ endsAt: "2026-10-10T18:00" })], types)).toEqual({
      ok: false,
      error: "O término precisa ser depois do início.",
    });
    expect(normalizeSessions([session(), session({ startsAt: "" })], types)).toEqual({
      ok: false,
      error: "Sessão 2: Informe a data e o horário de início.",
    });
  });

  it("tipo à venda exige preço; pelo menos um tipo à venda", () => {
    expect(
      normalizeSessions(
        [session({ prices: [{ typeIndex: 0, priceCents: null, maxUnits: null, onSale: true }] })],
        types,
      ),
    ).toEqual({ ok: false, error: "Informe o preço de “Inteira” (ex.: 45,00)." });
    expect(
      normalizeSessions(
        [session({ prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: false }] })],
        types,
      ),
    ).toEqual({ ok: false, error: "Deixe pelo menos um tipo à venda." });
  });

  it("limites por sessão contam pessoas (type-limits)", () => {
    const result = normalizeSessions(
      [
        session({
          capacity: 10,
          prices: [
            { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
            { typeIndex: 2, priceCents: 9000, maxUnits: 6, onSale: true },
          ],
        }),
      ],
      types,
    );
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("“Casadinha”") });
  });

  it("limite de tipo fora da venda não conta", () => {
    const result = normalizeSessions(
      [
        session({
          capacity: 10,
          prices: [
            { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
            { typeIndex: 2, priceCents: 9000, maxUnits: 6, onSale: false },
          ],
        }),
      ],
      types,
    );
    expect(result.ok).toBe(true);
  });

  it("recusa entrada malformada", () => {
    expect(normalizeSessions([], types).ok).toBe(false);
    expect(normalizeSessions(Array.from({ length: 21 }, (_, i) => session({ startsAt: `2026-10-${String(i + 1).padStart(2, "0")}T19:00` })), types)).toEqual({
      ok: false,
      error: "Cadastre no máximo 20 sessões.",
    });
    expect(normalizeSessions([session({ id: "x" })], types).ok).toBe(false);
    expect(
      normalizeSessions(
        [session({ prices: [{ typeIndex: 5, priceCents: 5000, maxUnits: null, onSale: true }] })],
        types,
      ).ok,
    ).toBe(false);
    expect(normalizeSessions([session({ name: "x".repeat(61) })], types).ok).toBe(false);
  });
});

describe("mirrorPrices", () => {
  it("usa o primeiro preço encontrado nas sessões", () => {
    const result = normalizeSessions(
      [
        session({ prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }] }),
        session({
          startsAt: "2026-10-10T20:30",
          prices: [
            { typeIndex: 0, priceCents: 6000, maxUnits: null, onSale: true },
            { typeIndex: 1, priceCents: 3000, maxUnits: null, onSale: true },
          ],
        }),
      ],
      types,
    );
    if (!result.ok) throw new Error(result.error);
    expect(mirrorPrices(result.items, 3)).toEqual([5000, 3000, null]);
  });
});

describe("sessionsDbErrorMessage", () => {
  const labels = ["Sessão 1 (sáb, 10/10 · 19h00)", "Sessão 2 (sáb, 10/10 · 20h30)"];

  it("traduz lotação, cota e limite abaixo do ocupado com a sessão", () => {
    expect(sessionsDbErrorMessage("SESSAO_LOTACAO_MENOR:2:7", labels)).toBe(
      "Sessão 2 (sáb, 10/10 · 20h30): O total não pode ser menor que 7 (já vendidos ou reservados).",
    );
    expect(sessionsDbErrorMessage("SESSAO_COTA_MENOR:1:meia:3", labels)).toBe(
      "Sessão 1 (sáb, 10/10 · 19h00): A quantidade de meias não pode ser menor que 3 (já vendidos ou reservados).",
    );
    expect(sessionsDbErrorMessage("SESSAO_LIMITE_MENOR:1:2:Casadinha", [""])).toBe(
      "O limite de “Casadinha” não pode ser menor que 2 (já vendidos ou reservados).",
    );
  });

  it("sessão removida com vendas usa o rótulo conhecido", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(sessionsDbErrorMessage(`SESSAO_COM_VENDAS:${id}`, labels, new Map([[id, "sáb, 10/10 · 19h00"]]))).toBe(
      "A sessão sáb, 10/10 · 19h00 tem vendas e não pode ser removida. Recarregue a página.",
    );
  });

  it("demais códigos e desconhecido", () => {
    expect(sessionsDbErrorMessage("SESSAO_HORARIO_REPETIDO:2", labels)).toContain("Já existe uma sessão neste horário.");
    expect(sessionsDbErrorMessage("SESSAO_DESATUALIZADA: x", labels)).toContain("Recarregue a página");
    expect(sessionsDbErrorMessage("outra coisa", labels)).toBeNull();
  });
});
