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
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy";
import { CHECKOUT_ACCEPTANCE_REQUIRED_MESSAGE, TERMS_VERSION } from "@/lib/legal/terms";
import { BOT_BLOCKED_MESSAGE } from "@/lib/security/bot";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const checkoutInput = {
  slug: "show",
  items: [{ ticketTypeId: "20000000-0000-4000-8000-000000000001", qty: 2 }],
  buyer: { name: "Comprador", email: "comprador@example.com" },
  acceptedPrivacy: true,
  acceptedTerms: true,
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

  it.each([
    ["privacidade recusada", { acceptedPrivacy: false }],
    ["privacidade ausente (chamada direta)", { acceptedPrivacy: undefined }],
    ["termos recusados", { acceptedTerms: false }],
    ["termos ausentes (tela antiga ou chamada direta)", { acceptedTerms: undefined }],
    ["termos como texto", { acceptedTerms: "on" }],
  ])("sem aceitar os Termos de compra e a Política de Privacidade (%s) não cria pedido", async (_caso, override) => {
    const result = await startCheckout({
      ...checkoutInput,
      ...(override as Partial<typeof checkoutInput>),
    });
    expect(result).toEqual({ error: CHECKOUT_ACCEPTANCE_REQUIRED_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("pedido criado registra as versões da Política de Privacidade e dos Termos aceitas", async () => {
    mocks.rpc.mockImplementation((fn: string) =>
      fn === "consume_rate_limit"
        ? Promise.resolve({ data: true, error: null })
        : { single: async () => ({ data: { order_id: "pedido" }, error: null }) },
    );
    mocks.from.mockImplementation(() => selectResult({ id: "evento" }));

    const result = await startCheckout(checkoutInput);

    expect(result).toHaveProperty("publicToken");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_checkout_order",
      expect.objectContaining({
        p_privacy_policy_version: PRIVACY_POLICY_VERSION,
        p_terms_version: TERMS_VERSION,
        p_items: [{ ticket_type_id: "20000000-0000-4000-8000-000000000001", qty: 2 }],
      }),
    );
  });

  it("envia a sessão escolhida ao banco", async () => {
    const sessionId = "30000000-0000-4000-8000-000000000001";
    mocks.rpc.mockImplementation((fn: string) =>
      fn === "consume_rate_limit"
        ? Promise.resolve({ data: true, error: null })
        : { single: async () => ({ data: { order_id: "pedido" }, error: null }) },
    );
    mocks.from.mockImplementation(() => selectResult({ id: "evento" }));

    await startCheckout({ ...checkoutInput, sessionId });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "create_checkout_order",
      expect.objectContaining({ p_session_id: sessionId }),
    );
  });

  it("sessão adulterada não chega ao banco", async () => {
    const result = await startCheckout({ ...checkoutInput, sessionId: "../outra" });
    expect(result).toHaveProperty("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
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
