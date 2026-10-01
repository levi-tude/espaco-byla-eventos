import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  cancelPendingCharges: vi.fn(),
  confirmOrderPaid: vi.fn(),
  isBot: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({
  checkBotId: async () => ({ isBot: mocks.isBot }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({
    name: "mercadopago",
    cancelPendingCharges: mocks.cancelPendingCharges,
  }),
}));
vi.mock("@/lib/payments/confirm-order", () => ({
  confirmOrderPaid: mocks.confirmOrderPaid,
}));

import { changeOrderSelection } from "@/app/pedidos/[publicToken]/actions";

const orderId = "00000000-0000-4000-8000-000000000010";
const token = "4f0c2a8e-1b2c-4d3e-9f00-112233445566";
const checkoutPath = `/eventos/show/checkout?retomar=${token}`;

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    event_id: "00000000-0000-4000-8000-000000000001",
    status: "pendente",
    total_cents: 2500,
    buyer_email: "comprador@example.com",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date().toISOString(),
    hold_extended_at: null,
    ...overrides,
  };
}

/** `orders` devolve em sequência as linhas dadas (a última se repete). */
function useOrders(...rows: Record<string, unknown>[]) {
  const queue = [...rows];
  mocks.from.mockImplementation((table: string) => {
    const data =
      table === "orders" ? (queue.length > 1 ? queue.shift() : queue[0]) : { slug: "show" };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error: null }),
    };
    return chain;
  });
}

function rpcCalls(name: string) {
  return mocks.rpc.mock.calls.filter(([fn]) => fn === name);
}

describe("Alterar seleção", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBot = false;
    mocks.cancelPendingCharges.mockResolvedValue({ kind: "cleared" });
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "cancel_pending_order"
        ? { data: "updated", error: null }
        : { data: true, error: null },
    );
  });

  it("com PIX ativo: cancela no Mercado Pago, depois no banco, e volta preenchido", async () => {
    useOrders(order({ hold_extended_at: new Date().toISOString() }));

    await expect(changeOrderSelection(token)).resolves.toEqual({
      status: "changed",
      checkoutPath,
    });
    expect(mocks.cancelPendingCharges).toHaveBeenCalledWith({
      id: orderId,
      createdAt: expect.any(String),
    });
    expect(rpcCalls("cancel_pending_order")).toEqual([
      ["cancel_pending_order", { p_order_id: orderId, p_reason: "alterado_pelo_comprador" }],
    ]);
    const mpOrder = mocks.cancelPendingCharges.mock.invocationCallOrder[0];
    const dbOrder = mocks.rpc.mock.invocationCallOrder[
      mocks.rpc.mock.calls.findIndex(([fn]) => fn === "cancel_pending_order")
    ];
    expect(mpOrder).toBeLessThan(dbOrder);
  });

  it("sem PIX gerado: só cancela o pedido e libera os lugares", async () => {
    useOrders(order());
    await expect(changeOrderSelection(token)).resolves.toEqual({
      status: "changed",
      checkoutPath,
    });
    expect(rpcCalls("cancel_pending_order")).toHaveLength(1);
  });

  it("pagamento já aprovado: confirma e não cancela", async () => {
    useOrders(order());
    mocks.cancelPendingCharges.mockResolvedValue({
      kind: "paid",
      amountCents: 2500,
      providerOrderId: "ORD1",
      providerPaymentId: "PAY1",
    });
    mocks.confirmOrderPaid.mockResolvedValue("updated");

    await expect(changeOrderSelection(token)).resolves.toEqual({ status: "paid" });
    expect(mocks.confirmOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
      2500,
      expect.objectContaining({ providerOrderId: "ORD1", providerPaymentId: "PAY1" }),
    );
    expect(rpcCalls("cancel_pending_order")).toHaveLength(0);
  });

  it("pago sem vaga ao confirmar: avisa que a equipe vai conferir", async () => {
    useOrders(order());
    mocks.cancelPendingCharges.mockResolvedValue({ kind: "paid", amountCents: 2500 });
    mocks.confirmOrderPaid.mockResolvedValue("needs_decision_capacity");

    const result = await changeOrderSelection(token);
    expect(result).toMatchObject({ status: "unavailable" });
    expect(rpcCalls("cancel_pending_order")).toHaveLength(0);
  });

  it("cartão em análise: recusa sem cancelar", async () => {
    useOrders(order());
    mocks.cancelPendingCharges.mockResolvedValue({ kind: "processing" });

    await expect(changeOrderSelection(token)).resolves.toEqual({
      status: "rejected",
      message: "Seu pagamento está em análise. Aguarde a confirmação.",
    });
    expect(rpcCalls("cancel_pending_order")).toHaveLength(0);
  });

  it("Mercado Pago sem resposta segura: não cancela (falha fechada)", async () => {
    useOrders(order());
    mocks.cancelPendingCharges.mockResolvedValue({ kind: "unavailable" });

    const result = await changeOrderSelection(token);
    expect(result).toMatchObject({ status: "rejected" });
    expect(rpcCalls("cancel_pending_order")).toHaveLength(0);
  });

  it("corrida: pagamento confirmado entre a consulta e o cancelamento → mostra ingressos", async () => {
    useOrders(order(), { status: "pago" });
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "cancel_pending_order" ? { data: "noop", error: null } : { data: true, error: null },
    );

    await expect(changeOrderSelection(token)).resolves.toEqual({ status: "paid" });
  });

  it("corrida: pedido foi para a fila de decisão no meio-tempo → não volta para a escolha", async () => {
    useOrders(order(), { status: "aguardando_decisao" });
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "cancel_pending_order" ? { data: "noop", error: null } : { data: true, error: null },
    );

    const result = await changeOrderSelection(token);
    expect(result).toMatchObject({ status: "unavailable" });
    expect(result).not.toHaveProperty("checkoutPath");
  });

  it("dois cliques: o pedido já cancelado só volta para a escolha, sem nova chamada", async () => {
    useOrders(order({ status: "cancelado" }));

    await expect(changeOrderSelection(token)).resolves.toEqual({
      status: "changed",
      checkoutPath,
    });
    expect(mocks.cancelPendingCharges).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("pedido expirado: confere o Mercado Pago, mas não há lugar a liberar", async () => {
    useOrders(order({ status: "expirado" }));

    await expect(changeOrderSelection(token)).resolves.toEqual({
      status: "changed",
      checkoutPath,
    });
    expect(mocks.cancelPendingCharges).toHaveBeenCalledTimes(1);
    expect(rpcCalls("cancel_pending_order")).toHaveLength(0);
  });

  it.each([
    ["pago", { status: "paid" }],
    ["aguardando_decisao", { status: "unavailable" }],
    ["estornado", { status: "unavailable" }],
  ])("pedido %s não é cancelado", async (status, expected) => {
    useOrders(order({ status }));
    await expect(changeOrderSelection(token)).resolves.toMatchObject(expected);
    expect(mocks.cancelPendingCharges).not.toHaveBeenCalled();
    expect(rpcCalls("cancel_pending_order")).toHaveLength(0);
  });

  it("limite de tentativas: recusa antes de chamar o Mercado Pago", async () => {
    useOrders(order());
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "consume_rate_limit" ? { data: false, error: null } : { data: "updated", error: null },
    );

    const result = await changeOrderSelection(token);
    expect(result).toMatchObject({ status: "rejected" });
    expect(rpcCalls("consume_rate_limit")[0]?.[1]).toMatchObject({
      p_bucket: "selection:order",
      p_limit: 5,
    });
    expect(mocks.cancelPendingCharges).not.toHaveBeenCalled();
  });

  it("robô ou token inválido: recusa antes de tocar no banco", async () => {
    mocks.isBot = true;
    await expect(changeOrderSelection(token)).resolves.toMatchObject({ status: "rejected" });

    mocks.isBot = false;
    await expect(changeOrderSelection("x".repeat(101))).resolves.toMatchObject({
      status: "unavailable",
    });
    await expect(changeOrderSelection("../outro")).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
