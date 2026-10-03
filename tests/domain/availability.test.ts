import { describe, expect, it } from "vitest";

import {
  capacityRefusalMessage,
  computeAvailability,
  fitSelection,
  HELD_MESSAGE,
  maxSelectableUnits,
  remainingNotice,
  salesState,
  toCheckoutAvailability,
  typeRefusalMessage,
  typeRemainingNotice,
} from "@/lib/domain/availability";

describe("limite próprio de cada tipo", () => {
  it("avisa só quando o tipo está acabando", () => {
    expect(typeRemainingNotice(null)).toBeNull();
    expect(typeRemainingNotice(21)).toBeNull();
    expect(typeRemainingNotice(20)).toBe("Restam 20");
    expect(typeRemainingNotice(1)).toBe("Resta 1");
    expect(typeRemainingNotice(0)).toBe("Esgotado");
  });

  it("explica a recusa pelo nome do tipo", () => {
    expect(typeRefusalMessage("Casadinha", 0)).toBe("“Casadinha” esgotou. Ajustamos sua seleção.");
    expect(typeRefusalMessage("Casadinha", 3)).toBe(
      "Restam apenas 3 “Casadinha”. Ajustamos sua seleção.",
    );
  });

  it("resume para o checkout só o restante do evento e de cada tipo", () => {
    expect(
      toCheckoutAvailability({
        capacity: 50,
        sold: 10,
        held: 0,
        remaining: 40,
        types: [
          {
            ticketTypeId: "a",
            unitsTaken: 4,
            unitsSold: 4,
            maxUnits: 5,
            remainingUnits: 1,
            hasSales: true,
          },
          {
            ticketTypeId: "b",
            unitsTaken: 0,
            unitsSold: 0,
            maxUnits: null,
            remainingUnits: null,
            hasSales: false,
          },
        ],
      }),
    ).toEqual({ remaining: 40, typeRemaining: { a: 1, b: null } });
  });
});

describe("disponibilidade do evento", () => {
  it("separa vendidos, reservados e restantes", () => {
    expect(computeAvailability({ capacity: 100, sold: 60, occupied: 75 })).toEqual({
      capacity: 100,
      sold: 60,
      held: 15,
      remaining: 25,
    });
  });

  it("restante nunca fica negativo (cortesia acima da lotação)", () => {
    expect(computeAvailability({ capacity: 10, sold: 12, occupied: 12 })).toMatchObject({
      held: 0,
      remaining: 0,
    });
  });

  it("diferencia esgotado de reservado no momento", () => {
    const soldOut = computeAvailability({ capacity: 10, sold: 10, occupied: 10 });
    const held = computeAvailability({ capacity: 10, sold: 7, occupied: 10 });
    const open = computeAvailability({ capacity: 10, sold: 7, occupied: 8 });

    expect(salesState(true, soldOut)).toBe("sold_out");
    expect(salesState(false, soldOut)).toBe("sold_out");
    expect(salesState(true, held)).toBe("held");
    expect(salesState(false, held)).toBe("closed");
    expect(salesState(true, open)).toBe("open");
    expect(salesState(false, open)).toBe("closed");
  });

  it("sem consulta de lotação segue só a chave de venda", () => {
    expect(salesState(true, null)).toBe("open");
    expect(salesState(false, null)).toBe("closed");
  });
});

describe("máximo selecionável por tipo", () => {
  it("limita a 10 pessoas no total da compra, não 10 por tipo", () => {
    expect(maxSelectableUnits({ remaining: 50, peopleSelectedElsewhere: 0 })).toBe(10);
    expect(maxSelectableUnits({ remaining: 50, peopleSelectedElsewhere: 7 })).toBe(3);
    expect(maxSelectableUnits({ remaining: 50, peopleSelectedElsewhere: 10 })).toBe(0);
  });

  it("nunca passa do que resta no evento", () => {
    expect(maxSelectableUnits({ remaining: 2, peopleSelectedElsewhere: 0 })).toBe(2);
    expect(maxSelectableUnits({ remaining: 2, peopleSelectedElsewhere: 1 })).toBe(1);
    expect(maxSelectableUnits({ remaining: 0, peopleSelectedElsewhere: 0 })).toBe(0);
  });

  it("pacote para 2 pessoas com 9 restantes permite no máximo 4", () => {
    expect(
      maxSelectableUnits({ remaining: 9, peopleSelectedElsewhere: 0, peoplePerUnit: 2 }),
    ).toBe(4);
  });

  it("respeita o limite próprio do tipo quando menor", () => {
    expect(
      maxSelectableUnits({
        remaining: 50,
        peopleSelectedElsewhere: 0,
        typeRemainingUnits: 3,
      }),
    ).toBe(3);
  });
});

describe("ajuste da seleção", () => {
  const simple = [
    { id: "inteira", peoplePerUnit: 1, remainingUnits: null },
    { id: "meia", peoplePerUnit: 1, remainingUnits: null },
  ];

  it("reduz na ordem dos tipos até caber no restante", () => {
    expect(fitSelection({ inteira: 3, meia: 4 }, simple, 5)).toEqual({
      inteira: 3,
      meia: 2,
    });
    expect(fitSelection({ inteira: 3, meia: 4 }, simple, 0)).toEqual({
      inteira: 0,
      meia: 0,
    });
  });

  it("aplica o máximo de 10 pessoas por compra mesmo com muitos lugares", () => {
    expect(fitSelection({ inteira: 8, meia: 8 }, simple, 500)).toEqual({
      inteira: 8,
      meia: 2,
    });
  });

  it("mantém a seleção que já cabe", () => {
    expect(fitSelection({ inteira: 1, meia: 1 }, simple, 5)).toEqual({
      inteira: 1,
      meia: 1,
    });
  });

  it("pacotes contam pessoas: 2 famílias (8) + casadinha (2) = 10, a terceira família sai", () => {
    const types = [
      { id: "familia", peoplePerUnit: 4, remainingUnits: null },
      { id: "casadinha", peoplePerUnit: 2, remainingUnits: null },
    ];
    expect(fitSelection({ familia: 3, casadinha: 1 }, types, 50)).toEqual({
      familia: 2,
      casadinha: 1,
    });
  });

  it("respeita o limite próprio do tipo e remove tipos que saíram da venda", () => {
    const types = [{ id: "casadinha", peoplePerUnit: 2, remainingUnits: 1 }];
    expect(fitSelection({ casadinha: 3, arquivado: 2 }, types, 50)).toEqual({ casadinha: 1 });
  });
});

describe("mensagens", () => {
  it("avisa 'Restam N lugares' só com 20 ou menos", () => {
    expect(remainingNotice(21)).toBeNull();
    expect(remainingNotice(20)).toBe("Restam 20 lugares");
    expect(remainingNotice(1)).toBe("Resta 1 lugar");
    expect(remainingNotice(0)).toBeNull();
  });

  it("recusa por lotação informa quanto resta sem detalhes internos", () => {
    expect(
      capacityRefusalMessage(computeAvailability({ capacity: 10, sold: 5, occupied: 7 })),
    ).toBe("Restam apenas 3 lugares. Ajustamos sua seleção.");
    expect(
      capacityRefusalMessage(computeAvailability({ capacity: 10, sold: 5, occupied: 10 })),
    ).toBe(HELD_MESSAGE);
    expect(
      capacityRefusalMessage(computeAvailability({ capacity: 10, sold: 10, occupied: 10 })),
    ).toBe("Os ingressos deste evento esgotaram.");
    expect(capacityRefusalMessage(null)).toMatch(/Diminua a quantidade/);
  });
});
