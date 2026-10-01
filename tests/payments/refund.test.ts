import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertTeam: vi.fn(),
  sendRefundEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeam: mocks.alertTeam }));
vi.mock("@/lib/email/send-refund", () => ({ sendRefundEmail: mocks.sendRefundEmail }));

import { ActionError } from "@/lib/action-result";
import type { SupabaseAdmin } from "@/lib/domain/orders";
import type { PaymentProvider } from "@/lib/payments/provider";
import {
  notifyBuyerRefunded,
  refundPaidOrder,
  syncOrderRefunded,
} from "@/lib/payments/refund";

const orderId = "00000000-0000-4000-8000-000000000010";
const refundId = "00000000-0000-4000-8000-0000000000aa";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";

type TableData = Record<string, unknown>;

function makeAdmin(rpcResults: Record<string, unknown>, tables: TableData = {}) {
  const rpc = vi.fn(async (name: string) => {
    const result = rpcResults[name];
    if (result instanceof Error) return { data: null, error: { message: result.message } };
    return { data: result ?? null, error: null };
  });
  const updates: Array<{ table: string; values: unknown }> = [];
  const from = vi.fn((table: string) => {
    const data = tables[table] ?? null;
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "order", "limit"]) {
      chain[method] = () => chain;
    }
    chain.update = (values: unknown) => {
      updates.push({ table, values });
      return chain;
    };
    chain.maybeSingle = async () => ({ data, error: null });
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: Array.isArray(data) ? data : [], error: null });
    return chain;
  });
  return { admin: { rpc, from } as unknown as SupabaseAdmin, rpc, from, updates };
}

function makeProvider(overrides: Partial<PaymentProvider> = {}) {
  return {
    name: "mercadopago",
    createPayment: vi.fn(),
    findOrderPayment: vi.fn().mockResolvedValue({ kind: "none" }),
    parseWebhook: vi.fn(),
    refundOrder: vi.fn().mockResolvedValue({ status: "refunded", providerRefundId: "REF1" }),
    ...overrides,
  } satisfies PaymentProvider;
}

const begun = {
  refund_id: refundId,
  idempotency_key: refundId,
  amount_cents: 5000,
  provider_order_id: "ORD1",
  already_requested: false,
};

const emailTables = {
  orders: {
    buyer_email: "comprador@example.com",
    buyer_name: "Comprador Teste",
    public_token: "token-publico",
    event_id: "evento-1",
    created_at: "2026-09-30T15:00:00.000Z",
  },
  events: { name: "Festa Teste", starts_at: "2026-12-01T23:00:00.000Z" },
  order_refunds: { amount_cents: 5000 },
  tickets: [{ buyer_name: "Comprador Teste", kind: "inteira" }],
};

const input = { orderId, staffUserId, reason: "Comprador pediu cancelamento" };

describe("refundPaidOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendRefundEmail.mockResolvedValue("sent");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("estorna com a chave do banco, conclui e avisa o comprador uma vez", async () => {
    const { admin, rpc } = makeAdmin(
      { begin_order_refund: [begun], complete_order_refund: "completed" },
      emailTables,
    );
    const provider = makeProvider();

    await expect(refundPaidOrder(admin, provider, input)).resolves.toEqual({
      status: "refunded",
      emailSent: true,
    });
    expect(rpc).toHaveBeenCalledWith("begin_order_refund", {
      p_order_id: orderId,
      p_staff_user_id: staffUserId,
      p_reason: input.reason,
    });
    expect(provider.refundOrder).toHaveBeenCalledWith({
      providerOrderId: "ORD1",
      idempotencyKey: refundId,
    });
    expect(rpc).toHaveBeenCalledWith("complete_order_refund", {
      p_refund_id: refundId,
      p_provider_refund_id: "REF1",
    });
    expect(mocks.sendRefundEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendRefundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 5000, buyerEmail: "comprador@example.com" }),
    );
  });

  it("segundo clique reusa o mesmo estorno e a mesma chave; não reenvia e-mail", async () => {
    const { admin } = makeAdmin(
      {
        begin_order_refund: [{ ...begun, already_requested: true }],
        complete_order_refund: "noop",
      },
      emailTables,
    );
    const provider = makeProvider();

    await expect(refundPaidOrder(admin, provider, input)).resolves.toEqual({
      status: "refunded",
      emailSent: true,
    });
    expect(provider.refundOrder).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: refundId }),
    );
    expect(mocks.sendRefundEmail).not.toHaveBeenCalled();
  });

  it("recusa do provedor desfaz o estorno, avisa a equipe e mostra motivo claro", async () => {
    const { admin, rpc } = makeAdmin({
      begin_order_refund: [begun],
      fail_order_refund: "failed",
    });
    const provider = makeProvider({
      refundOrder: vi
        .fn()
        .mockResolvedValue({ status: "rejected", code: "insufficient_money_for_refund" }),
    });

    const result = refundPaidOrder(admin, provider, input);
    await expect(result).rejects.toBeInstanceOf(ActionError);
    await expect(result).rejects.toThrow(/saldo insuficiente/);
    expect(rpc).toHaveBeenCalledWith("fail_order_refund", {
      p_refund_id: refundId,
      p_error_code: "insufficient_money_for_refund",
    });
    expect(rpc).not.toHaveBeenCalledWith("complete_order_refund", expect.anything());
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      admin,
      "estorno_falhou",
      orderId,
      expect.stringContaining("insufficient_money_for_refund"),
    );
    expect(mocks.sendRefundEmail).not.toHaveBeenCalled();
  });

  it("resposta incerta deixa em processamento, sem concluir nem desfazer", async () => {
    const { admin, rpc } = makeAdmin({ begin_order_refund: [begun] });
    const provider = makeProvider({
      refundOrder: vi.fn().mockResolvedValue({ status: "pending" }),
    });

    await expect(refundPaidOrder(admin, provider, input)).resolves.toEqual({
      status: "processing",
    });
    expect(rpc).not.toHaveBeenCalledWith("complete_order_refund", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("fail_order_refund", expect.anything());
  });

  it.each([
    ["ESTORNO_CHECK_IN: Há ingresso com entrada registrada.", /entrada registrada/],
    ["ESTORNO_PROVEDOR: indisponível", /indisponível para este pedido/],
    ["ESTORNO_PRAZO: encerrado", /180 dias/],
    ["ESTORNO_JA_FEITO: já", /já foi estornado/],
  ])("bloqueio do banco (%s) vira mensagem clara sem chamar o provedor", async (message, expected) => {
    const { admin } = makeAdmin({ begin_order_refund: new Error(message) });
    const provider = makeProvider();
    const result = refundPaidOrder(admin, provider, input);
    await expect(result).rejects.toBeInstanceOf(ActionError);
    await expect(result).rejects.toThrow(expected);
    expect(provider.refundOrder).not.toHaveBeenCalled();
  });

  it("erro inesperado do banco não vira mensagem para a tela", async () => {
    const { admin } = makeAdmin({ begin_order_refund: new Error("connection refused") });
    const result = refundPaidOrder(admin, makeProvider(), input);
    await expect(result).rejects.not.toBeInstanceOf(ActionError);
  });

  it("pedido antigo sem ID da cobrança: busca pela referência e grava", async () => {
    const { admin, updates } = makeAdmin(
      {
        begin_order_refund: [{ ...begun, provider_order_id: null }],
        complete_order_refund: "completed",
      },
      emailTables,
    );
    const provider = makeProvider({
      findOrderPayment: vi
        .fn()
        .mockResolvedValue({ kind: "paid", amountCents: 5000, providerOrderId: "ORD-ANTIGO" }),
    });

    await refundPaidOrder(admin, provider, input);
    expect(provider.findOrderPayment).toHaveBeenCalledWith({
      id: orderId,
      createdAt: emailTables.orders.created_at,
    });
    expect(updates).toContainEqual({
      table: "orders",
      values: { provider_order_id: "ORD-ANTIGO" },
    });
    expect(provider.refundOrder).toHaveBeenCalledWith(
      expect.objectContaining({ providerOrderId: "ORD-ANTIGO" }),
    );
  });

  it("pedido antigo sem cobrança encontrada desfaz o estorno", async () => {
    const { admin, rpc } = makeAdmin(
      { begin_order_refund: [{ ...begun, provider_order_id: null }], fail_order_refund: "failed" },
      emailTables,
    );
    const provider = makeProvider();

    await expect(refundPaidOrder(admin, provider, input)).rejects.toThrow(
      /Não encontramos o pagamento/,
    );
    expect(rpc).toHaveBeenCalledWith("fail_order_refund", {
      p_refund_id: refundId,
      p_error_code: "provider_order_not_found",
    });
    expect(provider.refundOrder).not.toHaveBeenCalled();
  });

  it("valor cobrado diferente do pedido não estorna pelo site", async () => {
    const { admin, rpc } = makeAdmin(
      { begin_order_refund: [{ ...begun, provider_order_id: null }], fail_order_refund: "failed" },
      emailTables,
    );
    const provider = makeProvider({
      findOrderPayment: vi
        .fn()
        .mockResolvedValue({ kind: "paid", amountCents: 100, providerOrderId: "ORD-X" }),
    });

    await expect(refundPaidOrder(admin, provider, input)).rejects.toBeInstanceOf(ActionError);
    expect(rpc).toHaveBeenCalledWith("fail_order_refund", {
      p_refund_id: refundId,
      p_error_code: "provider_amount_mismatch",
    });
    expect(provider.refundOrder).not.toHaveBeenCalled();
  });
});

describe("syncOrderRefunded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendRefundEmail.mockResolvedValue("sent");
  });

  it("conclui o estorno pedido pelo site e avisa o comprador", async () => {
    const { admin, rpc } = makeAdmin({ sync_order_refunded: "completed" }, emailTables);
    await expect(syncOrderRefunded(admin, orderId, "mercadopago", "ORD1")).resolves.toBe(
      "completed",
    );
    expect(rpc).toHaveBeenCalledWith("sync_order_refunded", {
      p_provider: "mercadopago",
      p_external_id: orderId,
      p_provider_order_id: "ORD1",
    });
    expect(rpc).not.toHaveBeenCalledWith("mark_order_paid_by_external", expect.anything());
    expect(mocks.sendRefundEmail).toHaveBeenCalledTimes(1);
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it("estorno feito fora do site alerta a equipe", async () => {
    const { admin } = makeAdmin({ sync_order_refunded: "external" }, emailTables);
    await syncOrderRefunded(admin, orderId, "mercadopago", "ORD1");
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      admin,
      "estorno_externo",
      orderId,
      expect.stringContaining("fora do site"),
    );
  });

  it("estorno de outra cobrança não mexe no pedido nem avisa o comprador", async () => {
    const { admin } = makeAdmin({ sync_order_refunded: "other_order" }, emailTables);
    await syncOrderRefunded(admin, orderId, "mercadopago", "ORD2");
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      admin,
      "estorno_externo",
      orderId,
      expect.any(String),
    );
    expect(mocks.sendRefundEmail).not.toHaveBeenCalled();
  });

  it("aviso repetido não faz nada", async () => {
    const { admin } = makeAdmin({ sync_order_refunded: "noop" }, emailTables);
    await expect(syncOrderRefunded(admin, orderId, "mercadopago")).resolves.toBe("noop");
    expect(mocks.alertTeam).not.toHaveBeenCalled();
    expect(mocks.sendRefundEmail).not.toHaveBeenCalled();
  });

  it("falha do banco lança para o provedor reenviar o aviso", async () => {
    const { admin } = makeAdmin({ sync_order_refunded: new Error("db fora") });
    await expect(syncOrderRefunded(admin, orderId, "mercadopago")).rejects.toThrow();
  });
});

describe("notifyBuyerRefunded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("e-mail que não sai alerta a equipe e devolve false", async () => {
    mocks.sendRefundEmail.mockResolvedValue("failed");
    const { admin } = makeAdmin({}, emailTables);
    await expect(notifyBuyerRefunded(admin, orderId)).resolves.toBe(false);
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      admin,
      "email_estorno_nao_enviado",
      orderId,
      expect.any(String),
    );
  });
});
