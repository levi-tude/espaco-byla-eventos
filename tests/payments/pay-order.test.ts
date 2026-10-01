import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  confirmOrderPaid: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({
  checkBotId: async () => ({ isBot: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({
    name: "mercadopago",
    createPayment: mocks.createPayment,
    findOrderPayment: mocks.findOrderPayment,
  }),
}));
vi.mock("@/lib/payments/confirm-order", () => ({
  confirmOrderPaid: mocks.confirmOrderPaid,
}));

import { checkOrderPayment, payOrder } from "@/app/pedidos/[publicToken]/actions";

const orderId = "00000000-0000-4000-8000-000000000010";
const extendedUntil = "2026-10-01T16:02:00.000Z";
const pix = {
  qrCode: "000201PIX",
  qrCodeBase64: "aW1n",
  expiresAt: "2026-10-01T16:00:00.000Z",
};

function pendingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    event_id: "00000000-0000-4000-8000-000000000001",
    status: "pendente",
    total_cents: 100,
    buyer_email: "comprador@example.com",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date().toISOString(),
    hold_extended_at: null,
    ...overrides,
  };
}

function useOrder(order: Record<string, unknown>) {
  mocks.from.mockImplementation((table: string) => {
    const data = table === "orders" ? order : { name: "Show" };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error: null }),
      single: async () => ({ data, error: null }),
    };
    return chain;
  });
}

const pixSubmission = { paymentMethodId: "pix" };
const cardSubmission = {
  paymentMethodId: "master",
  paymentType: "credit_card",
  cardToken: "tok",
  installments: 1,
};

describe("pagamento com reserva de 15 min e PIX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOrderPayment.mockResolvedValue({ kind: "none" });
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "extend_order_hold_for_pix"
        ? { data: extendedUntil, error: null }
        : { data: true, error: null },
    );
  });

  it("ao gerar o PIX estende a reserva até o vencimento dele", async () => {
    useOrder(pendingOrder());
    mocks.createPayment.mockResolvedValue({ status: "pending", paymentId: "ORD1", pix });

    await expect(payOrder("token", pixSubmission)).resolves.toEqual({
      status: "pix",
      pix,
      holdExpiresAt: extendedUntil,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("extend_order_hold_for_pix", {
      p_order_id: orderId,
      p_pix_expires_at: pix.expiresAt,
    });
  });

  it("PIX já gerado é reaproveitado e a reserva acompanha", async () => {
    useOrder(pendingOrder());
    mocks.findOrderPayment.mockResolvedValue({ kind: "pending_pix", pix });

    await expect(payOrder("token", pixSubmission)).resolves.toEqual({
      status: "pix",
      pix,
      holdExpiresAt: extendedUntil,
    });
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("sem data do PIX, usa os 30 min pedidos ao Mercado Pago", async () => {
    useOrder(pendingOrder());
    mocks.createPayment.mockResolvedValue({
      status: "pending",
      paymentId: "ORD1",
      pix: { ...pix, expiresAt: undefined },
    });

    await payOrder("token", pixSubmission);
    const [, args] = mocks.rpc.mock.calls.find(
      ([fn]) => fn === "extend_order_hold_for_pix",
    )!;
    const minutes = (Date.parse(args.p_pix_expires_at) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it("depois que o PIX estendeu a reserva, não gera outro PIX", async () => {
    useOrder(pendingOrder({ hold_extended_at: new Date().toISOString() }));

    const result = await payOrder("token", pixSubmission);
    expect(result).toEqual({
      status: "rejected",
      message: "O PIX deste pedido venceu. Pague com cartão ou faça uma nova compra.",
    });
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("cartão continua possível dentro da reserva", async () => {
    useOrder(pendingOrder({ hold_extended_at: new Date().toISOString() }));
    mocks.createPayment.mockResolvedValue({
      status: "approved",
      paymentId: "ORD2",
      providerOrderId: "ORD2",
      providerPaymentId: "PAY2",
    });
    mocks.confirmOrderPaid.mockResolvedValue("updated");

    await expect(payOrder("token", cardSubmission)).resolves.toEqual({ status: "paid" });
    expect(mocks.confirmOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
      100,
      { providerOrderId: "ORD2", providerPaymentId: "PAY2" },
    );
  });

  it("reserva vencida não gera cobrança", async () => {
    useOrder(pendingOrder({ expires_at: new Date(Date.now() - 1000).toISOString() }));

    const result = await payOrder("token", cardSubmission);
    expect(result.status).toBe("unavailable");
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("pagamento aprovado sem vaga não mostra ingressos", async () => {
    useOrder(pendingOrder());
    mocks.createPayment.mockResolvedValue({ status: "approved", paymentId: "ORD3" });
    mocks.confirmOrderPaid.mockResolvedValue("needs_decision_capacity");

    await expect(payOrder("token", cardSubmission)).resolves.toEqual({
      status: "unavailable",
      message:
        "Recebemos seu pagamento. Nossa equipe vai conferir o pedido e avisar você por e-mail.",
    });
  });

  it("pedido aguardando decisão não aceita novo pagamento", async () => {
    useOrder(pendingOrder({ status: "aguardando_decisao" }));

    const result = await payOrder("token", cardSubmission);
    expect(result.status).toBe("unavailable");
    expect(mocks.findOrderPayment).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
});

describe("checkOrderPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOrderPayment.mockResolvedValue({ kind: "none" });
  });

  it("pago sem vaga sai da tela de pagamento", async () => {
    useOrder(pendingOrder());
    mocks.findOrderPayment.mockResolvedValue({ kind: "paid", amountCents: 100 });
    mocks.confirmOrderPaid.mockResolvedValue("needs_decision_capacity");

    await expect(checkOrderPayment("token")).resolves.toBe("unavailable");
  });

  it("pedido expirado ainda confirma pagamento que chegou", async () => {
    useOrder(pendingOrder({ status: "expirado" }));
    mocks.findOrderPayment.mockResolvedValue({
      kind: "paid",
      amountCents: 100,
      providerOrderId: "ORD9",
    });
    mocks.confirmOrderPaid.mockResolvedValue("updated");

    await expect(checkOrderPayment("token")).resolves.toBe("paid");
    expect(mocks.confirmOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
      100,
      expect.objectContaining({ providerOrderId: "ORD9" }),
    );
  });

  it("pedido expirado sem pagamento deixa de aguardar", async () => {
    useOrder(pendingOrder({ status: "expirado" }));
    await expect(checkOrderPayment("token")).resolves.toBe("unavailable");
  });

  it("pendente sem pagamento continua aguardando", async () => {
    useOrder(pendingOrder());
    await expect(checkOrderPayment("token")).resolves.toBe("pending");
  });

  it("pedido aguardando decisão não consulta o Mercado Pago", async () => {
    useOrder(pendingOrder({ status: "aguardando_decisao" }));
    await expect(checkOrderPayment("token")).resolves.toBe("unavailable");
    expect(mocks.findOrderPayment).not.toHaveBeenCalled();
  });
});
