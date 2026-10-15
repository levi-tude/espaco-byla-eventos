import { describe, expect, it } from "vitest";

import { parsePaymentFee, pickPaymentForOrder } from "@/lib/payments/fee";

const approved = {
  id: 123456789,
  status: "approved",
  external_reference: "00000000-0000-4000-8000-000000000099",
  transaction_amount: 52.5,
  transaction_details: { net_received_amount: 49.89 },
  fee_details: [{ type: "mercadopago_fee", amount: 2.61, fee_payer: "collector" }],
  money_release_date: "2026-11-20T10:00:00.000-04:00",
};

describe("parsePaymentFee", () => {
  it("lê bruto, tarifa do vendedor, detalhamento e data de liberação em centavos", () => {
    expect(parsePaymentFee(approved)).toEqual({
      grossCents: 5250,
      feeCents: 261,
      breakdown: [{ type: "mercadopago_fee", cents: 261 }],
      releaseDate: "2026-11-20",
      refunded: false,
    });
  });

  it("arredonda valores quebrados para o centavo mais próximo", () => {
    const fee = parsePaymentFee({ ...approved, transaction_amount: 52.499999 });
    expect(fee?.grossCents).toBe(5250);
    expect(fee?.feeCents).toBe(261);
  });

  it("deixa a tarifa paga pelo comprador fora do detalhamento", () => {
    const fee = parsePaymentFee({
      ...approved,
      fee_details: [
        { type: "mercadopago_fee", amount: 2.61, fee_payer: "collector" },
        { type: "financing_fee", amount: 3.1, fee_payer: "payer" },
      ],
    });
    expect(fee?.breakdown).toEqual([{ type: "mercadopago_fee", cents: 261 }]);
  });

  it("guarda o detalhamento sempre em centavos inteiros, no máximo 10 itens", () => {
    const fee = parsePaymentFee({
      ...approved,
      fee_details: Array.from({ length: 12 }, () => ({
        type: "mercadopago_fee",
        amount: 0.215,
        fee_payer: "collector",
      })),
    });
    expect(fee?.breakdown).toHaveLength(10);
    for (const item of fee?.breakdown ?? []) {
      expect(Number.isInteger(item.cents)).toBe(true);
    }
  });

  it("ignora itens do detalhamento com valor inválido e limpa o tipo", () => {
    const fee = parsePaymentFee({
      ...approved,
      fee_details: [
        { type: "application_fee", amount: -1, fee_payer: "collector" },
        { type: "mercadopago_fee", amount: "2.61", fee_payer: "collector" },
        { type: "Tarifa <script>", amount: 1, fee_payer: "collector" },
        { type: "a".repeat(60), amount: 0.5, fee_payer: "collector" },
      ],
    });
    expect(fee?.breakdown).toEqual([
      { type: "outro", cents: 100 },
      { type: "a".repeat(40), cents: 50 },
    ]);
  });

  it("devolve detalhamento vazio quando o pagamento não traz fee_details", () => {
    expect(parsePaymentFee({ ...approved, fee_details: undefined })?.breakdown).toEqual([]);
  });

  it.each([
    ["líquido maior que o bruto", { ...approved, transaction_details: { net_received_amount: 60 } }],
    ["bruto negativo", { ...approved, transaction_amount: -52.5 }],
    ["líquido negativo", { ...approved, transaction_details: { net_received_amount: -1 } }],
    ["bruto NaN", { ...approved, transaction_amount: Number.NaN }],
    ["bruto infinito", { ...approved, transaction_amount: Number.POSITIVE_INFINITY }],
    ["bruto em texto", { ...approved, transaction_amount: "52.50" }],
    ["líquido em texto", { ...approved, transaction_details: { net_received_amount: "49.89" } }],
    ["sem líquido", { ...approved, transaction_details: {} }],
    ["sem transaction_details", { ...approved, transaction_details: null }],
    ["tarifa igual ao bruto (líquido zero)", { ...approved, transaction_details: { net_received_amount: 0 } }],
  ])("recusa pagamento com %s", (_label, payment) => {
    expect(parsePaymentFee(payment)).toBeNull();
  });

  it.each([null, undefined, "pagamento", 42, []])("recusa entrada que não é objeto (%s)", (value) => {
    expect(parsePaymentFee(value)).toBeNull();
  });

  it("deixa a data de liberação vazia quando ausente ou fora do formato", () => {
    expect(parsePaymentFee({ ...approved, money_release_date: null })?.releaseDate).toBeNull();
    expect(parsePaymentFee({ ...approved, money_release_date: "20/11/2026" })?.releaseDate).toBeNull();
    expect(parsePaymentFee({ ...approved, money_release_date: 20261120 })?.releaseDate).toBeNull();
  });

  it.each(["2026-02-31T10:00:00.000-04:00", "2026-13-01", "2026-00-10", "2026-04-31", "2027-02-29"])(
    "deixa a data de liberação vazia quando não existe no calendário (%s)",
    (release) => {
      expect(parsePaymentFee({ ...approved, money_release_date: release })?.releaseDate).toBeNull();
    },
  );

  it("aceita 29 de fevereiro em ano bissexto", () => {
    expect(
      parsePaymentFee({ ...approved, money_release_date: "2028-02-29T10:00:00.000-04:00" })
        ?.releaseDate,
    ).toBe("2028-02-29");
  });

  it.each(["refunded", "charged_back"])("marca estornado quando o status é %s", (status) => {
    expect(parsePaymentFee({ ...approved, status })?.refunded).toBe(true);
  });

  it("marca estornado quando o valor estornado cobre o bruto", () => {
    expect(
      parsePaymentFee({ ...approved, transaction_amount_refunded: 52.5 })?.refunded,
    ).toBe(true);
    expect(
      parsePaymentFee({ ...approved, transaction_amount_refunded: 10 })?.refunded,
    ).toBe(false);
  });
});

describe("pickPaymentForOrder", () => {
  it("escolhe o pagamento aprovado e ignora o recusado", () => {
    const rejected = { ...approved, id: 1, status: "rejected" };
    expect(pickPaymentForOrder([rejected, approved], 5250)).toBe(approved);
  });

  it("devolve ambíguo com dois pagamentos aprovados de mesmo valor", () => {
    const other = { ...approved, id: 2 };
    expect(pickPaymentForOrder([approved, other], 5250)).toBe("ambiguous");
  });

  it("prefere o pagamento com o valor do pedido quando há mais de um aprovado", () => {
    const smaller = { ...approved, id: 3, transaction_amount: 10 };
    expect(pickPaymentForOrder([smaller, approved], 5250)).toBe(approved);
  });

  it("considera o pagamento já estornado (consulta depois do estorno)", () => {
    const refunded = { ...approved, status: "refunded" };
    expect(pickPaymentForOrder([refunded], 5250)).toBe(refunded);
  });

  it("devolve o único aprovado mesmo com valor diferente (o banco recusa e alerta)", () => {
    const different = { ...approved, transaction_amount: 40 };
    expect(pickPaymentForOrder([different], 5250)).toBe(different);
  });

  it("devolve ambíguo com dois aprovados e nenhum com o valor do pedido", () => {
    const first = { ...approved, id: 4, transaction_amount: 40 };
    const second = { ...approved, id: 5, transaction_amount: 30 };
    expect(pickPaymentForOrder([first, second], 5250)).toBe("ambiguous");
  });

  it("devolve null sem pagamento aprovado", () => {
    expect(pickPaymentForOrder([], 5250)).toBeNull();
    expect(
      pickPaymentForOrder(
        [
          { ...approved, status: "pending" },
          { ...approved, status: "cancelled" },
          null,
          "texto",
        ],
        5250,
      ),
    ).toBeNull();
  });
});
