import { describe, expect, it } from "vitest";

import {
  type EditorTicketType,
  initialTicketTypesState,
  limitedTypesFromState,
  parsePriceCents,
  ticketTypesFromState,
} from "@/components/equipe/TicketTypesEditor";

function saved(overrides: Partial<EditorTicketType>): EditorTicketType {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    preset: "inteira",
    name: "Inteira",
    priceCents: 5000,
    peoplePerUnit: 1,
    maxUnits: null,
    hasSales: false,
    unitsSold: 0,
    unitsTaken: 0,
    ...overrides,
  };
}

describe("limites na tela para o resumo ao vivo", () => {
  it("lê os tipos marcados e os novos; limite ainda inválido conta como vazio", () => {
    const state = initialTicketTypesState();
    state.presets.inteira.maxUnits = "50";
    state.presets.meia.maxUnits = "abc";
    state.presets.casadinha = { checked: true, price: "", maxUnits: "3" };
    state.customs.push({ key: "k", id: null, name: " ", peoplePerUnit: 6, price: "", maxUnits: "2" });
    expect(limitedTypesFromState(state)).toEqual([
      { name: "Inteira", kind: "inteira", peoplePerUnit: 1, maxUnits: 50 },
      { name: "Meia-entrada", kind: "meia", peoplePerUnit: 1, maxUnits: null },
      { name: "Casadinha", kind: "inteira", peoplePerUnit: 2, maxUnits: 3 },
      { name: "tipo novo", kind: "inteira", peoplePerUnit: 6, maxUnits: 2 },
    ]);
  });
});

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

describe("formulário de tipos", () => {
  it("evento novo: Inteira e Meia marcadas sem preço, pacotes desmarcados", () => {
    const state = initialTicketTypesState();
    expect(state.presets.inteira).toEqual({ checked: true, price: "", maxUnits: "" });
    expect(state.presets.meia.checked).toBe(true);
    expect(state.presets.casadinha.checked).toBe(false);
    expect(state.presets.familia.checked).toBe(false);
    expect(state.customs).toEqual([]);
    expect(ticketTypesFromState(state)).toEqual({
      ok: false,
      error: "Informe o preço de “Inteira” (ex.: 45,00).",
    });
  });

  it("evento existente mantém Inteira/Meia com preços e deixa Casadinha e Família desmarcadas", () => {
    const state = initialTicketTypesState([
      saved({}),
      saved({
        id: "20000000-0000-4000-8000-000000000002",
        preset: "meia",
        name: "Meia-entrada",
        priceCents: 2500,
      }),
    ]);
    expect(state.presets.inteira).toEqual({ checked: true, price: "50,00", maxUnits: "" });
    expect(state.presets.meia).toEqual({ checked: true, price: "25,00", maxUnits: "" });
    expect(state.presets.casadinha.checked).toBe(false);
    expect(state.presets.familia.checked).toBe(false);
    expect(ticketTypesFromState(state)).toEqual({
      ok: true,
      types: [
        { preset: "inteira", priceCents: 5000, maxUnits: null },
        { preset: "meia", priceCents: 2500, maxUnits: null },
      ],
    });
  });

  it("tipo desmarcado não vai para a venda; marcado exige preço", () => {
    const state = initialTicketTypesState([saved({})]);
    state.presets.familia = { checked: true, price: "", maxUnits: "" };
    expect(ticketTypesFromState(state)).toEqual({
      ok: false,
      error: "Informe o preço de “Pacote família” (ex.: 45,00).",
    });
    state.presets.familia = { checked: true, price: "160", maxUnits: "5" };
    expect(ticketTypesFromState(state)).toEqual({
      ok: true,
      types: [
        { preset: "inteira", priceCents: 5000, maxUnits: null },
        { preset: "familia", priceCents: 16000, maxUnits: 5 },
      ],
    });
  });

  it("tipo criado pela equipe mantém id, pessoas e limite", () => {
    const customId = "30000000-0000-4000-8000-000000000001";
    const state = initialTicketTypesState([
      saved({}),
      saved({
        id: customId,
        preset: null,
        name: "Mesa",
        priceCents: 30000,
        peoplePerUnit: 6,
        maxUnits: 10,
      }),
    ]);
    expect(ticketTypesFromState(state)).toEqual({
      ok: true,
      types: [
        { preset: "inteira", priceCents: 5000, maxUnits: null },
        {
          preset: null,
          id: customId,
          name: "Mesa",
          peoplePerUnit: 6,
          priceCents: 30000,
          maxUnits: 10,
        },
      ],
    });
  });

  it("limite inválido é recusado", () => {
    const state = initialTicketTypesState([saved({})]);
    state.presets.inteira.maxUnits = "0";
    expect(ticketTypesFromState(state)).toEqual({
      ok: false,
      error: "Informe um limite válido para “Inteira” ou deixe em branco.",
    });
  });
});
