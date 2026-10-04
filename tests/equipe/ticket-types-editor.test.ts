import { describe, expect, it } from "vitest";

import {
  draftTypesFromState,
  type EditorTicketType,
  initialTicketTypesState,
  parsePriceCents,
  savedTypeKey,
  ticketTypesFromState,
} from "@/components/equipe/TicketTypesEditor";

function saved(overrides: Partial<EditorTicketType>): EditorTicketType {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    preset: "inteira",
    name: "Inteira",
    peoplePerUnit: 1,
    hasSales: false,
    unitsSold: 0,
    unitsTaken: 0,
    ...overrides,
  };
}

describe("preço digitado pela equipe", () => {
  it.each([
    ["45", 4500],
    ["45,5", 4550],
    ["45,50", 4550],
    ["45.50", 4550],
    [" 1234,00 ", 123400],
  ])("“%s” vira %i centavos", (value, cents) => {
    expect(parsePriceCents(value)).toBe(cents);
  });

  it.each(["", "0", "0,00", "abc", "-5", "45,505", "1.234,00"])("“%s” é inválido", (value) => {
    expect(parsePriceCents(value)).toBeNull();
  });
});

describe("tipos do evento (o preço fica nas sessões)", () => {
  it("evento novo: Inteira e Meia marcadas, pacotes desmarcados", () => {
    const state = initialTicketTypesState();
    expect(state.presets.inteira).toEqual({ checked: true });
    expect(state.presets.meia.checked).toBe(true);
    expect(state.presets.casadinha.checked).toBe(false);
    expect(state.presets.familia.checked).toBe(false);
    expect(state.customs).toEqual([]);
    expect(ticketTypesFromState(state)).toEqual({
      ok: true,
      types: [
        { preset: "inteira", priceCents: 0, maxUnits: null },
        { preset: "meia", priceCents: 0, maxUnits: null },
      ],
    });
  });

  it("chaves dos tipos ligam o tipo ao preço de cada sessão, na ordem enviada", () => {
    const customId = "30000000-0000-4000-8000-000000000001";
    const state = initialTicketTypesState([
      saved({}),
      saved({ id: customId, preset: null, name: "Mesa", peoplePerUnit: 6 }),
    ]);
    state.presets.casadinha.checked = true;
    expect(draftTypesFromState(state)).toEqual([
      { key: "preset:inteira", name: "Inteira", kind: "inteira", peoplePerUnit: 1 },
      { key: "preset:casadinha", name: "Casadinha", kind: "inteira", peoplePerUnit: 2 },
      { key: `custom:${customId}`, name: "Mesa", kind: "inteira", peoplePerUnit: 6 },
    ]);
    expect(savedTypeKey({ id: customId, preset: null })).toBe(`custom:${customId}`);
    expect(savedTypeKey({ id: customId, preset: "meia" })).toBe("preset:meia");
  });

  it("tipo criado pela equipe mantém id e pessoas; nome vazio é recusado", () => {
    const customId = "30000000-0000-4000-8000-000000000001";
    const state = initialTicketTypesState([
      saved({}),
      saved({ id: customId, preset: null, name: "Mesa", peoplePerUnit: 6 }),
    ]);
    expect(ticketTypesFromState(state)).toEqual({
      ok: true,
      types: [
        { preset: "inteira", priceCents: 0, maxUnits: null },
        { preset: null, id: customId, name: "Mesa", peoplePerUnit: 6, priceCents: 0, maxUnits: null },
      ],
    });
    state.customs[0].name = "  ";
    expect(ticketTypesFromState(state)).toEqual({
      ok: false,
      error: "Informe o nome de cada tipo novo.",
    });
  });

  it("sem nenhum tipo marcado, pede pelo menos um", () => {
    const state = initialTicketTypesState();
    state.presets.inteira.checked = false;
    state.presets.meia.checked = false;
    expect(ticketTypesFromState(state)).toEqual({
      ok: false,
      error: "Marque pelo menos um tipo de ingresso para vender.",
    });
  });
});
