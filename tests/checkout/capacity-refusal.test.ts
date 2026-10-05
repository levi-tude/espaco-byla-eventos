import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  availability: { data: null as unknown, error: null as unknown },
  orderError: { message: "" },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago" }),
}));

import { startCheckout } from "@/app/eventos/[slug]/checkout/actions";

const INTEIRA = "20000000-0000-4000-8000-000000000001";
const MEIA = "20000000-0000-4000-8000-000000000002";
const CASADINHA = "20000000-0000-4000-8000-000000000004";

const input = {
  slug: "show",
  items: [{ ticketTypeId: INTEIRA, qty: 5 }],
  buyer: { name: "Comprador", email: "comprador@example.com" },
  acceptedPrivacy: true,
};

function availability(
  remaining: number,
  sold: number,
  held: number,
  casadinhaLeft: number | null,
  inteiraLeft: number | null = null,
) {
  return {
    capacity: sold + held + remaining,
    sold,
    held,
    remaining,
    categories: {
      inteira: {
        quota: inteiraLeft === null ? null : 20,
        sold: 3,
        taken: 3,
        remaining: inteiraLeft,
      },
      meia: { quota: null, sold: 0, taken: 0, remaining: null },
    },
    types: [
      { ticket_type_id: INTEIRA, units_taken: 3, units_sold: 3, max_units: null, remaining_units: null, has_sales: true },
      { ticket_type_id: CASADINHA, units_taken: 2, units_sold: 1, max_units: 3, remaining_units: casadinhaLeft, has_sales: true },
    ],
  };
}

function tableChain(table: string) {
  const data =
    table === "ticket_types"
      ? { name: "Casadinha" }
      : { id: "00000000-0000-4000-8000-000000000001", capacity: 10 };
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };
  return chain;
}

describe("checkout recusado por lotação ou limite do tipo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "consume_rate_limit") return Promise.resolve({ data: true, error: null });
      if (fn === "event_availability") return Promise.resolve(mocks.availability);
      return { single: async () => ({ data: null, error: mocks.orderError }) };
    });
    mocks.from.mockImplementation(tableChain);
  });

  it("lotação: devolve quanto resta para a tela ajustar a seleção", async () => {
    mocks.orderError = { message: "ESGOTADO_EVENTO:2" };
    mocks.availability = { data: availability(2, 6, 2, 1), error: null };

    expect(await startCheckout(input)).toEqual({
      error: "Restam apenas 2 lugares. Ajustamos sua seleção.",
      availability: {
        remaining: 2,
        categoryRemaining: { inteira: null, meia: null },
        typeRemaining: { [INTEIRA]: null, [CASADINHA]: 1 },
      },
    });
  });

  it("cota de inteiras: diz quantas inteiras restam (Casadinha conta 2)", async () => {
    mocks.orderError = { message: "ESGOTADO_CATEGORIA:inteira:1" };
    mocks.availability = { data: availability(30, 3, 0, null, 1), error: null };

    const result = await startCheckout({ ...input, items: [{ ticketTypeId: CASADINHA, qty: 1 }] });
    expect(result).toEqual({
      error: "Resta apenas 1 ingresso inteira. Ajustamos sua seleção.",
      availability: {
        remaining: 30,
        categoryRemaining: { inteira: 1, meia: null },
        typeRemaining: { [INTEIRA]: null, [CASADINHA]: null },
      },
    });
  });

  it("cota de meias esgotada avisa pela categoria", async () => {
    mocks.orderError = { message: "ESGOTADO_CATEGORIA:meia:0" };
    mocks.availability = { data: availability(30, 3, 0, null), error: null };

    const result = await startCheckout({ ...input, items: [{ ticketTypeId: MEIA, qty: 1 }] });
    expect("error" in result && result.error).toBe(
      "Os ingressos meia-entrada esgotaram. Ajustamos sua seleção.",
    );
  });

  it("sem lugares por reservas em andamento explica que vagas podem reabrir", async () => {
    mocks.orderError = { message: "ESGOTADO_EVENTO:0" };
    mocks.availability = { data: availability(0, 7, 3, 1), error: null };

    const result = await startCheckout(input);
    expect(result).toMatchObject({ availability: { remaining: 0 } });
    expect("error" in result && result.error).toMatch(/reservados no momento/);
  });

  it("limite do tipo: diz quantas unidades restam daquele tipo", async () => {
    mocks.orderError = { message: `ESGOTADO_TIPO:${CASADINHA}:1` };
    mocks.availability = { data: availability(5, 3, 2, 1), error: null };

    const result = await startCheckout({
      ...input,
      items: [{ ticketTypeId: CASADINHA, qty: 2 }],
    });
    expect(result).toEqual({
      error: "Resta apenas 1 “Casadinha”. Ajustamos sua seleção.",
      availability: {
        remaining: 5,
        categoryRemaining: { inteira: null, meia: null },
        typeRemaining: { [INTEIRA]: null, [CASADINHA]: 1 },
      },
    });
  });

  it("tipo esgotado avisa pelo nome", async () => {
    mocks.orderError = { message: `ESGOTADO_TIPO:${CASADINHA}:0` };
    mocks.availability = { data: availability(5, 3, 2, 0), error: null };

    const result = await startCheckout({ ...input, items: [{ ticketTypeId: CASADINHA, qty: 1 }] });
    expect("error" in result && result.error).toBe("“Casadinha” esgotou. Ajustamos sua seleção.");
  });

  it("falha ao recalcular continua recusando com mensagem genérica", async () => {
    mocks.orderError = { message: "ESGOTADO_EVENTO:2" };
    mocks.availability = { data: null, error: { message: "fora do ar" } };

    const result = await startCheckout(input);
    expect(result).not.toHaveProperty("availability");
    expect(result).not.toHaveProperty("publicToken");
    expect("error" in result && result.error).not.toMatch(/fora do ar/);
  });

  it("mais de 10 pessoas (pacotes) é recusado pelo banco com mensagem clara", async () => {
    mocks.orderError = { message: "LIMITE_PESSOAS: Selecione de 1 a 10 pessoas por compra." };

    const result = await startCheckout({
      ...input,
      items: [
        { ticketTypeId: CASADINHA, qty: 3 },
        { ticketTypeId: INTEIRA, qty: 5 },
      ],
    });
    expect(result).toEqual({ error: "Selecione no máximo 10 pessoas por compra." });
  });

  it("tipo que saiu da venda pede para atualizar a página", async () => {
    mocks.orderError = { message: "TIPO_INDISPONIVEL: Um dos tipos está indisponível." };

    const result = await startCheckout(input);
    expect("error" in result && result.error).toMatch(/não está mais à venda/);
  });

  it("mais de 10 unidades é recusado antes de tocar no banco", async () => {
    const result = await startCheckout({
      ...input,
      items: [
        { ticketTypeId: INTEIRA, qty: 6 },
        { ticketTypeId: MEIA, qty: 5 },
      ],
    });
    expect(result).toEqual({ error: "Selecione no máximo 10 pessoas por compra." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["id que não é uuid", [{ ticketTypeId: "inteira", qty: 1 }]],
    ["tipo repetido", [{ ticketTypeId: INTEIRA, qty: 1 }, { ticketTypeId: INTEIRA, qty: 1 }]],
    ["quantidade fracionada", [{ ticketTypeId: INTEIRA, qty: 1.5 }]],
    ["quantidade negativa", [{ ticketTypeId: INTEIRA, qty: -1 }]],
  ])("entrada inválida (%s) não chega ao banco", async (_caso, items) => {
    const result = await startCheckout({ ...input, items });
    expect(result).toEqual({ error: "Selecione quantidades válidas de ingressos." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("repassa ao banco os termos da taxa que a tela mostrou", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      fn === "consume_rate_limit"
        ? Promise.resolve({ data: true, error: null })
        : { single: async () => ({ data: { order_id: "pedido" }, error: null }) },
    );

    await startCheckout({ ...input, expectedFee: { rateBps: 500, minCents: 100 } });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_checkout_order",
      expect.objectContaining({ p_expected_fee_rate_bps: 500, p_expected_fee_min_cents: 100 }),
    );
  });

  it("taxa desligada na tela envia 0 e 0 para o banco conferir", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      fn === "consume_rate_limit"
        ? Promise.resolve({ data: true, error: null })
        : { single: async () => ({ data: { order_id: "pedido" }, error: null }) },
    );

    await startCheckout({ ...input, expectedFee: { rateBps: 0, minCents: 0 } });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_checkout_order",
      expect.objectContaining({ p_expected_fee_rate_bps: 0, p_expected_fee_min_cents: 0 }),
    );
  });

  it("sem os termos (tela antiga), não envia a conferência da taxa", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      fn === "consume_rate_limit"
        ? Promise.resolve({ data: true, error: null })
        : { single: async () => ({ data: { order_id: "pedido" }, error: null }) },
    );

    await startCheckout(input);
    const call = mocks.rpc.mock.calls.find(([fn]) => fn === "create_checkout_order");
    expect(call?.[1]).not.toHaveProperty("p_expected_fee_rate_bps");
    expect(call?.[1]).not.toHaveProperty("p_expected_fee_min_cents");
  });

  it.each([
    ["percentual acima do limite", { rateBps: 2001, minCents: 100 }],
    ["percentual negativo", { rateBps: -1, minCents: 100 }],
    ["percentual fracionado", { rateBps: 2.5, minCents: 100 }],
    ["mínimo acima do limite", { rateBps: 500, minCents: 1001 }],
    ["mínimo em texto", { rateBps: 500, minCents: "100" }],
    ["sem objeto", "500"],
    ["nulo", null],
  ])("termos da taxa inválidos (%s) não chegam ao banco", async (_caso, expectedFee) => {
    const result = await startCheckout({
      ...input,
      expectedFee: expectedFee as unknown as { rateBps: number; minCents: number },
    });
    expect(result).toEqual({ error: "Selecione quantidades válidas de ingressos." });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("taxa mudou no banco: avisa e pede para recarregar os valores", async () => {
    mocks.orderError = { message: "TAXA_MUDOU:625" };

    const result = await startCheckout({ ...input, expectedFee: { rateBps: 0, minCents: 0 } });
    expect(result).toEqual({
      error: "Os valores foram atualizados. Confira o total antes de continuar.",
      feeChanged: true,
    });
  });

  it("envia ao banco só o id do tipo e a quantidade (preço e total são do servidor)", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      fn === "consume_rate_limit"
        ? Promise.resolve({ data: true, error: null })
        : { single: async () => ({ data: { order_id: "pedido" }, error: null }) },
    );

    await startCheckout({
      ...input,
      items: [
        { ticketTypeId: CASADINHA, qty: 2 },
        { ticketTypeId: MEIA, qty: 0 },
      ],
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_checkout_order",
      expect.objectContaining({ p_items: [{ ticket_type_id: CASADINHA, qty: 2 }] }),
    );
  });
});
