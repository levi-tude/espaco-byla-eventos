import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integração com mock do Mercado Pago: totals Pix/cartão e FORMA_MUDOU
 * quando o método do Brick diverge do gravado no pedido.
 */

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

import { payOrder } from "@/app/pedidos/[publicToken]/actions";
import { serviceFeeForPriceAtRate } from "@/lib/domain/service-fee";

const orderId = "00000000-0000-4000-8000-000000000099";

function useOrder(order: Record<string, unknown>) {
  mocks.from.mockImplementation((table: string) => {
    const data =
      table === "orders"
        ? order
        : table === "event_sessions"
          ? { status: "ativa" }
          : { name: "Show" };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error: null }),
      single: async () => ({ data, error: null }),
    };
    return chain;
  });
}

describe("taxa por forma de pagamento (mock MP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOrderPayment.mockResolvedValue({ kind: "none" });
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "extend_order_hold_for_pix"
        ? { data: new Date().toISOString(), error: null }
        : { data: true, error: null },
    );
  });

  it("exemplos R$ 25 / 50 / 100 com 10% cartão e 5,56% Pix", () => {
    expect(serviceFeeForPriceAtRate(2500, 1000, 100)).toBe(250);
    expect(serviceFeeForPriceAtRate(2500, 556, 100)).toBe(139);
    expect(2500 + 250).toBe(2750);
    expect(2500 + 139).toBe(2639);

    expect(serviceFeeForPriceAtRate(5000, 1000, 100)).toBe(500);
    expect(serviceFeeForPriceAtRate(5000, 556, 100)).toBe(278);
    expect(5000 + 500).toBe(5500);
    expect(5000 + 278).toBe(5278);

    expect(serviceFeeForPriceAtRate(10000, 1000, 100)).toBe(1000);
    expect(serviceFeeForPriceAtRate(10000, 556, 100)).toBe(556);
    expect(10000 + 1000).toBe(11000);
    expect(10000 + 556).toBe(10556);
  });

  it("Pix cobra o total Pix (R$ 52,78) e cartão o total cartão (R$ 55,00)", async () => {
    useOrder({
      id: orderId,
      event_id: "00000000-0000-4000-8000-000000000001",
      status: "pendente",
      total_cents: 5278,
      buyer_email: "a@testuser.com",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      created_at: new Date().toISOString(),
      hold_extended_at: null,
      payment_method: "pix",
    });
    mocks.createPayment.mockResolvedValue({ status: "pending", paymentId: "ORD-PIX", pix: {
      qrCode: "x",
      qrCodeBase64: "y",
    } });

    await payOrder("token", { paymentMethodId: "pix" });
    expect(mocks.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 5278, paymentMethodId: "pix" }),
    );

    mocks.createPayment.mockClear();
    useOrder({
      id: orderId,
      event_id: "00000000-0000-4000-8000-000000000001",
      status: "pendente",
      total_cents: 5500,
      buyer_email: "a@testuser.com",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      created_at: new Date().toISOString(),
      hold_extended_at: null,
      payment_method: "card",
    });
    mocks.createPayment.mockResolvedValue({ status: "approved", paymentId: "ORD-CARD" });
    mocks.confirmOrderPaid.mockResolvedValue("updated");

    await payOrder("token", {
      paymentMethodId: "master",
      paymentType: "credit_card",
      cardToken: "tok",
      installments: 1,
    });
    expect(mocks.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 5500 }),
    );
  });

  it("método divergente → FORMA_MUDOU (não chama o MP)", async () => {
    useOrder({
      id: orderId,
      event_id: "00000000-0000-4000-8000-000000000001",
      status: "pendente",
      total_cents: 5278,
      buyer_email: "a@testuser.com",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      created_at: new Date().toISOString(),
      hold_extended_at: null,
      payment_method: "pix",
    });

    const result = await payOrder("token", {
      paymentMethodId: "master",
      paymentType: "credit_card",
      cardToken: "tok",
      installments: 1,
    });
    expect(result.status).toBe("rejected");
    expect(result).toMatchObject({
      message: expect.stringMatching(/forma de pagamento/i),
    });
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
});
