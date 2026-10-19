import { describe, expect, it } from "vitest";

import {
  dualMethodTotals,
  effectiveFeeTerms,
  formatFeePercent,
  formatPricePlusFee,
  orderFeeBreakdown,
  PIX_OFF_LABEL,
  pixSavingsLabel,
  priceWithFeeLabel,
  receiptFeeDisplay,
  SERVICE_FEE_OFF,
  serviceFeeForPrice,
  serviceFeeForPriceAtRate,
} from "@/lib/domain/service-fee";
import { TERMS_SERVICE_FEE } from "@/lib/legal/terms";

const ON = {
  enabled: true,
  rateBps: 500,
  minCents: 100,
  cardRateBps: 500,
  pixRateBps: 500,
  perMethodEnabled: false,
};
const plain = (text: string) => text.replace(/\s/g, " ");

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

  it("taxa comercial de 7% (700 pontos-base) com mínimo de R$ 1,00", () => {
    const commercial = { ...ON, rateBps: 700, cardRateBps: 700, pixRateBps: 700 };
    expect(serviceFeeForPrice(5000, commercial)).toBe(350);
    expect(serviceFeeForPrice(1000, commercial)).toBe(100);
    expect(serviceFeeForPrice(0, commercial)).toBe(0);
  });

  it("cartão 10% e Pix 5,56% (termos) com arredondamento meio-para-cima", () => {
    expect(serviceFeeForPriceAtRate(2500, 1000, 100)).toBe(250);
    expect(serviceFeeForPriceAtRate(2500, 556, 100)).toBe(139);
    expect(serviceFeeForPriceAtRate(5000, 1000, 100)).toBe(500);
    expect(serviceFeeForPriceAtRate(5000, 556, 100)).toBe(278);
    expect(serviceFeeForPriceAtRate(10000, 1000, 100)).toBe(1000);
    expect(serviceFeeForPriceAtRate(10000, 556, 100)).toBe(556);
    expect(serviceFeeForPriceAtRate(800, 1000, 100)).toBe(100);
    expect(serviceFeeForPriceAtRate(1000, 556, 100)).toBe(100);
  });

  it("meia e quantidade: taxa por unidade", () => {
    const dual = {
      enabled: true,
      rateBps: 1000,
      minCents: 100,
      cardRateBps: 1000,
      pixRateBps: 556,
      perMethodEnabled: true,
    };
    const lines = [
      { unitPriceCents: 5000, quantity: 1 },
      { unitPriceCents: 2500, quantity: 1 },
    ];
    const { pix, card, savingsCents } = dualMethodTotals(lines, dual);
    expect(card.feeCents).toBe(500 + 250);
    expect(pix.feeCents).toBe(278 + 139);
    expect(card.totalCents).toBe(5000 + 2500 + 750);
    expect(pix.totalCents).toBe(5000 + 2500 + 417);
    expect(savingsCents).toBe(card.totalCents - pix.totalCents);
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

  it("com duas taxas a linha do preço usa só a taxa do cartão", () => {
    const dual = {
      enabled: true,
      rateBps: 1000,
      minCents: 100,
      cardRateBps: 1000,
      pixRateBps: 556,
      perMethodEnabled: true,
    };
    expect(plain(priceWithFeeLabel(5000, dual))).toBe("R$ 50,00 + R$ 5,00 de taxa");
  });

  it("sem taxa mostra só o preço", () => {
    expect(plain(formatPricePlusFee(5000, 0))).toBe("R$ 50,00");
    expect(plain(priceWithFeeLabel(5000, SERVICE_FEE_OFF))).toBe("R$ 50,00");
  });

  it("termos efetivos enviados ao banco", () => {
    expect(effectiveFeeTerms(ON)).toEqual({ rateBps: 500, minCents: 100 });
    expect(effectiveFeeTerms({ ...ON, enabled: false })).toEqual({ rateBps: 0, minCents: 0 });
  });

  it("rótulo de economia no Pix é só o selo (sem 5,56%)", () => {
    expect(pixSavingsLabel(222)).toBe(PIX_OFF_LABEL);
    expect(PIX_OFF_LABEL).toBe("4% de desconto");
    expect(formatFeePercent(556)).toBe("5,56");
    expect(formatFeePercent(1000)).toBe("10");
  });

  it("recibo: cartão mostra taxa cheia; Pix acrescenta Desconto Pix", () => {
    const items = [{ unitPriceCents: 5000, quantity: 1 }];
    const base = {
      ticketsSubtotalCents: 5000,
      serviceFeeRateBps: 1000,
      serviceFeeMinCents: 100,
      cardRateBpsSnapshot: 1000,
      items,
    };
    expect(
      receiptFeeDisplay({
        ...base,
        paymentMethod: "card",
        totalCents: 5500,
        serviceFeeCents: 500,
      }),
    ).toEqual({ feeCents: 500, pixDiscountCents: 0 });
    expect(
      receiptFeeDisplay({
        ...base,
        paymentMethod: "pix",
        totalCents: 5278,
        serviceFeeCents: 278,
      }),
    ).toEqual({ feeCents: 500, pixDiscountCents: 222 });
  });
});

describe("alinhamento com Termos", () => {
  it("TERMS_SERVICE_FEE bate com as taxas que serão ligadas (10% / 5,56%)", () => {
    expect(TERMS_SERVICE_FEE).toEqual({
      cardRateBps: 1000,
      pixRateBps: 556,
      minCents: 100,
    });
  });
});
