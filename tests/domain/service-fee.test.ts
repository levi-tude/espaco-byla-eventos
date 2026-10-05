import { describe, expect, it } from "vitest";

import {
  effectiveFeeTerms,
  formatPricePlusFee,
  orderFeeBreakdown,
  priceWithFeeLabel,
  SERVICE_FEE_OFF,
  serviceFeeForPrice,
} from "@/lib/domain/service-fee";

const ON = { enabled: true, rateBps: 500, minCents: 100 };
const plain = (text: string) => text.replace(/\s/g, " ");

// Mesma tabela usada em scripts/db-tests/service-fee.mjs contra a função SQL.
const FEE_EXAMPLES: [number, number][] = [
  [2500, 125],
  [5000, 250],
  [9000, 450],
  [1000, 100],
  [2490, 125],
  [3330, 167],
  [800, 100],
  [1, 100],
  [2000, 100],
  [2010, 101],
];

describe("serviceFeeForPrice", () => {
  it.each(FEE_EXAMPLES)("preço %i → taxa %i", (price, fee) => {
    expect(serviceFeeForPrice(price, ON)).toBe(fee);
  });

  it("cortesia e preço inválido não pagam taxa", () => {
    expect(serviceFeeForPrice(0, ON)).toBe(0);
    expect(serviceFeeForPrice(-100, ON)).toBe(0);
    expect(serviceFeeForPrice(10.5, ON)).toBe(0);
  });

  it("taxa desligada = 0", () => {
    expect(serviceFeeForPrice(5000, SERVICE_FEE_OFF)).toBe(0);
    expect(serviceFeeForPrice(5000, { ...ON, enabled: false })).toBe(0);
  });
});

describe("orderFeeBreakdown", () => {
  it("2 inteiras + 1 meia = R$ 125,00 + R$ 6,25", () => {
    expect(
      orderFeeBreakdown(
        [
          { unitPriceCents: 5000, quantity: 2 },
          { unitPriceCents: 2500, quantity: 1 },
          { unitPriceCents: 9000, quantity: 0 },
        ],
        ON,
      ),
    ).toEqual({ ticketsCents: 12500, feeCents: 625, totalCents: 13125 });
  });

  it("a taxa é por unidade (Casadinha conta uma vez por unidade)", () => {
    expect(orderFeeBreakdown([{ unitPriceCents: 9000, quantity: 3 }], ON).feeCents).toBe(1350);
  });

  it("desligada: total = ingressos", () => {
    expect(orderFeeBreakdown([{ unitPriceCents: 5000, quantity: 2 }], SERVICE_FEE_OFF)).toEqual({
      ticketsCents: 10000,
      feeCents: 0,
      totalCents: 10000,
    });
  });
});

describe("textos", () => {
  it("preço + taxa", () => {
    expect(plain(formatPricePlusFee(5000, 250))).toBe("R$ 50,00 + R$ 2,50 de taxa");
    expect(plain(priceWithFeeLabel(1000, ON))).toBe("R$ 10,00 + R$ 1,00 de taxa");
  });

  it("sem taxa mostra só o preço", () => {
    expect(plain(formatPricePlusFee(5000, 0))).toBe("R$ 50,00");
    expect(plain(priceWithFeeLabel(5000, SERVICE_FEE_OFF))).toBe("R$ 50,00");
  });

  it("termos efetivos enviados ao banco", () => {
    expect(effectiveFeeTerms(ON)).toEqual({ rateBps: 500, minCents: 100 });
    expect(effectiveFeeTerms({ ...ON, enabled: false })).toEqual({ rateBps: 0, minCents: 0 });
  });
});
