import { describe, expect, it } from "vitest";

import {
  normalizeTicketTypes,
  orderItemName,
  ticketTypeLabel,
  ticketTypesErrorMessage,
  unitContentsLabel,
} from "@/lib/domain/ticket-types";

const CUSTOM_ID = "30000000-0000-4000-8000-000000000001";

function custom(overrides: Record<string, unknown> = {}) {
  return {
    preset: null,
    id: null,
    name: "Camarote",
    peoplePerUnit: 1,
    priceCents: 12000,
    maxUnits: null,
    ...overrides,
  };
}

describe("nome do tipo nos ingressos", () => {
  it("pacote mostra o tipo e a categoria", () => {
    expect(ticketTypeLabel("Casadinha", "inteira")).toBe("Casadinha — Inteira");
    expect(ticketTypeLabel("Pacote família", "inteira")).toBe("Pacote família — Inteira");
  });

  it("quando o nome é a própria categoria, mostra só a categoria", () => {
    expect(ticketTypeLabel("Inteira", "inteira")).toBe("Inteira");
    expect(ticketTypeLabel("Meia-entrada", "meia")).toBe("Meia-entrada");
  });

  it("ingresso antigo, sem item de pedido, continua com a categoria", () => {
    expect(ticketTypeLabel(null, "cortesia")).toBe("Cortesia");
    expect(ticketTypeLabel(orderItemName(null), "meia")).toBe("Meia-entrada");
  });

  it("lê o nome do item vindo como objeto ou lista", () => {
    expect(orderItemName({ name: "Casadinha" })).toBe("Casadinha");
    expect(orderItemName([{ name: "Casadinha" }])).toBe("Casadinha");
    expect(orderItemName([])).toBeNull();
  });

  it("explica o conteúdo do pacote", () => {
    expect(unitContentsLabel(2, "inteira")).toBe("2 ingressos inteira");
    expect(unitContentsLabel(1, "meia")).toBe("1 ingresso meia-entrada");
  });
});

describe("validação dos tipos do evento", () => {
  it("tipos prontos levam só preço e limite; nome e pessoas vêm do banco", () => {
    expect(
      normalizeTicketTypes([
        { preset: "inteira", priceCents: 5000, maxUnits: null },
        { preset: "casadinha", priceCents: 9000, maxUnits: 20, name: "Outro", peoplePerUnit: 9 },
      ]),
    ).toEqual({
      ok: true,
      items: [
        { preset: "inteira", price_cents: 5000, max_units: null },
        { preset: "casadinha", price_cents: 9000, max_units: 20 },
      ],
    });
  });

  it("tipo novo leva nome, pessoas, preço e limite", () => {
    expect(
      normalizeTicketTypes([custom({ id: CUSTOM_ID, name: "  Mesa  ", peoplePerUnit: 6, maxUnits: 5 })]),
    ).toEqual({
      ok: true,
      items: [
        { id: CUSTOM_ID, name: "Mesa", people_per_unit: 6, price_cents: 12000, max_units: 5 },
      ],
    });
  });

  it("exige pelo menos um tipo marcado", () => {
    expect(normalizeTicketTypes([])).toEqual({
      ok: false,
      error: "Marque pelo menos um tipo de ingresso para vender.",
    });
    expect(normalizeTicketTypes(null)).toMatchObject({ ok: false });
  });

  it("tipo marcado precisa de preço válido", () => {
    for (const priceCents of [0, -100, 10.5, "5000", null]) {
      expect(normalizeTicketTypes([{ preset: "familia", priceCents, maxUnits: null }])).toEqual({
        ok: false,
        error: "Informe um preço válido para “Pacote família”.",
      });
    }
  });

  it("limite é opcional, mas quando informado precisa ser inteiro positivo", () => {
    expect(normalizeTicketTypes([custom({ maxUnits: 0 })])).toEqual({
      ok: false,
      error: "Informe um limite válido para “Camarote” ou deixe em branco.",
    });
    expect(normalizeTicketTypes([custom({ maxUnits: undefined })])).toMatchObject({ ok: true });
  });

  it("tipo novo vale de 1 a 10 pessoas", () => {
    expect(normalizeTicketTypes([custom({ peoplePerUnit: 11 })])).toEqual({
      ok: false,
      error: "Informe de 1 a 10 pessoas para “Camarote”.",
    });
    expect(normalizeTicketTypes([custom({ peoplePerUnit: 0 })])).toMatchObject({ ok: false });
  });

  it.each(["Inteira", "meia-entrada", "CASADINHA", "Pacote familia", "Cortesia"])(
    "nome reservado “%s” não vale para tipo novo",
    (name) => {
      expect(normalizeTicketTypes([custom({ name })])).toEqual({
        ok: false,
        error: `O nome “${name}” é de um tipo pronto. Use outro nome para o tipo novo.`,
      });
    },
  );

  it("recusa tipo pronto repetido, preset desconhecido, nome repetido e id adulterado", () => {
    const inteira = { preset: "inteira", priceCents: 5000, maxUnits: null };
    expect(normalizeTicketTypes([inteira, inteira])).toMatchObject({ ok: false });
    expect(normalizeTicketTypes([{ ...inteira, preset: "vip" }])).toMatchObject({ ok: false });
    expect(normalizeTicketTypes([custom(), custom({ name: "camarote" })])).toEqual({
      ok: false,
      error: "Há dois tipos com o nome “camarote”.",
    });
    expect(normalizeTicketTypes([custom({ id: "1; drop table" })])).toMatchObject({ ok: false });
    expect(
      normalizeTicketTypes([custom({ id: CUSTOM_ID }), custom({ id: CUSTOM_ID, name: "Mesa" })]),
    ).toMatchObject({ ok: false });
  });

  it("no máximo 20 tipos", () => {
    const many = Array.from({ length: 21 }, (_, i) => custom({ name: `Tipo ${i}` }));
    expect(normalizeTicketTypes(many)).toEqual({
      ok: false,
      error: "Cadastre no máximo 20 tipos de ingresso.",
    });
  });
});

describe("erros do banco ao salvar tipos", () => {
  it("traduz cada recusa para a equipe", () => {
    expect(ticketTypesErrorMessage("TIPOS_PESSOAS_COM_VENDAS:Mesa")).toBe(
      "“Mesa” já tem vendas, então o número de pessoas não pode mudar. Crie um tipo novo se precisar.",
    );
    expect(ticketTypesErrorMessage("TIPOS_LIMITE_MENOR:7:Casadinha")).toBe(
      "O limite de “Casadinha” não pode ser menor que 7 (já vendidos ou reservados).",
    );
    expect(ticketTypesErrorMessage("TIPOS_NOME_RESERVADO:Inteira")).toContain("tipo pronto");
    expect(ticketTypesErrorMessage("TIPOS_DESATUALIZADO")).toContain("Recarregue a página");
    expect(ticketTypesErrorMessage("TIPOS_OUTRO")).toBe(
      "Confira os tipos de ingresso e tente de novo.",
    );
  });

  it("ignora erros que não são do editor de tipos", () => {
    expect(ticketTypesErrorMessage("CAPACIDADE_MENOR:10")).toBeNull();
    expect(ticketTypesErrorMessage(undefined)).toBeNull();
  });
});
