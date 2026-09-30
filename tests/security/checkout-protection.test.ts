import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isBot: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  createPayment: vi.fn(),
  findOrderPayment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({
  checkBotId: async () => ({ isBot: mocks.isBot() }),
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
vi.mock("@/lib/payments/confirm-order", () => ({ confirmOrderPaid: vi.fn() }));

import { startCheckout } from "@/app/eventos/[slug]/checkout/actions";
import { checkOrderPayment, payOrder } from "@/app/pedidos/[publicToken]/actions";
import { BOT_BLOCKED_MESSAGE } from "@/lib/security/bot";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const checkoutInput = {
  slug: "show",
  items: [{ kind: "inteira" as const, qty: 2 }],
  buyer: { name: "Comprador", email: "comprador@example.com" },
};

const pendingOrder = {
  id: "00000000-0000-4000-8000-000000000010",
  event_id: "00000000-0000-4000-8000-000000000001",
  status: "pendente",
  total_cents: 100,
  buyer_email: "comprador@example.com",
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  created_at: new Date().toISOString(),
};

function selectResult(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
    single: async () => ({ data, error: null }),
  };
  return chain;
}

const cardSubmission = {
  paymentMethodId: "master",
  paymentType: "credit_card",
  cardToken: "tok",
  installments: 1,
};

describe("proteção do checkout e do pagamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBot.mockReturnValue(false);
    mocks.findOrderPayment.mockResolvedValue({ kind: "none" });
  });

  it("robô não cria pedido", async () => {
    mocks.isBot.mockReturnValue(true);
    expect(await startCheckout(checkoutInput)).toEqual({ error: BOT_BLOCKED_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("acima do limite de tentativas não reserva ingressos", async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "consume_rate_limit" ? { data: false, error: null } : { data: null, error: null },
    );
    expect(await startCheckout(checkoutInput)).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_checkout_order", expect.anything());
  });

  it("guarda só hash do IP e do e-mail no limite", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await startCheckout(checkoutInput);
    const [, args] = mocks.rpc.mock.calls[0];
    expect(args.p_key_hash).toBe(hashRateLimitKey("203.0.113.7"));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("203.0.113.7");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("comprador@example.com");
  });

  it("falha ao consultar o limite bloqueia (falha fechada)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    expect(await startCheckout(checkoutInput)).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_checkout_order", expect.anything());
  });

  it("robô não chega a tentar pagamento", async () => {
    mocks.isBot.mockReturnValue(true);
    const result = await payOrder("token-publico", cardSubmission);
    expect(result.status).toBe("rejected");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("acima do limite de tentativas de cartão não chama o Mercado Pago", async () => {
    mocks.from.mockImplementation(() => selectResult(pendingOrder));
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await payOrder("token-publico", cardSubmission);
    expect(result).toEqual({ status: "rejected", message: RATE_LIMIT_MESSAGE });
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it("robô consultando pagamento não gera chamada ao Mercado Pago", async () => {
    mocks.isBot.mockReturnValue(true);
    expect(await checkOrderPayment("token-publico")).toBe("pending");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.findOrderPayment).not.toHaveBeenCalled();
  });
});
