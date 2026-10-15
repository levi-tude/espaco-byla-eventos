import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertTeam: vi.fn(),
  getPaymentProvider: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeam: mocks.alertTeam }));
vi.mock("@/lib/payments/provider", () => ({ getPaymentProvider: mocks.getPaymentProvider }));

import type { SupabaseAdmin } from "@/lib/domain/orders";
import {
  captureMissingFees,
  captureOrderFee,
  capturePaymentFee,
  isFeeCaptureEnabled,
} from "@/lib/payments/capture-fee";
import type { PaymentProvider } from "@/lib/payments/provider";
import type { PaymentFeeLookup } from "@/lib/payments/types";

const orderId = "0a1b2c3d-0000-4000-8000-000000000010";
const buyerEmail = "comprador@example.com";

const orderRow = {
  id: orderId,
  created_at: "2026-10-01T15:00:00.000Z",
  provider_order_id: "ORD01ABC",
  total_cents: 5250,
  status: "pago",
};

const foundFee: PaymentFeeLookup = {
  kind: "found",
  fee: {
    grossCents: 5250,
    feeCents: 261,
    breakdown: [{ type: "mercadopago_fee", cents: 261 }],
    releaseDate: "2026-11-20",
    refunded: false,
  },
};

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type RpcHandler = (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

function makeAdmin(options: {
  order?: Record<string, unknown> | null;
  orderError?: { message: string } | null;
  rpc?: Record<string, RpcHandler>;
  orders?: Record<string, Record<string, unknown>>;
} = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const handler = options.rpc?.[name];
    if (!handler) return { data: null, error: { message: `rpc inesperada: ${name}` } };
    return handler(args);
  });
  const from = vi.fn((table: string) => {
    let id: unknown;
    const chain = {
      select: () => chain,
      eq: (_column: string, value: unknown) => {
        id = value;
        return chain;
      },
      maybeSingle: async () => {
        if (table !== "orders") return { data: null, error: { message: "tabela inesperada" } };
        if (options.orderError) return { data: null, error: options.orderError };
        const data =
          options.orders?.[String(id)] ?? (options.order === undefined ? orderRow : options.order);
        return { data, error: null };
      },
    };
    return chain;
  });
  return { admin: { rpc, from } as unknown as SupabaseAdmin, rpc, from };
}

function makeProvider(
  findPaymentFee: PaymentProvider["findPaymentFee"] = vi.fn(async () => foundFee),
) {
  return {
    name: "mercadopago",
    createPayment: vi.fn(),
    findOrderPayment: vi.fn(),
    parseWebhook: vi.fn(),
    refundOrder: vi.fn(),
    cancelPendingCharges: vi.fn(),
    findPaymentFee: vi.fn(findPaymentFee),
  } satisfies PaymentProvider;
}

const saved: RpcHandler = () => ({ data: "salvo", error: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PAYMENT_FEE_CAPTURE", "on");
  mocks.alertTeam.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isFeeCaptureEnabled", () => {
  it.each([
    ["on", true],
    [" on ", true],
    ["", false],
    ["off", false],
    ["ON", false],
    ["true", false],
    ["1", false],
  ])("PAYMENT_FEE_CAPTURE=%j → %s", (value, expected) => {
    vi.stubEnv("PAYMENT_FEE_CAPTURE", value);
    expect(isFeeCaptureEnabled()).toBe(expected);
  });

  it("fica desligada quando a variável não existe", () => {
    vi.stubEnv("PAYMENT_FEE_CAPTURE", undefined);
    expect(isFeeCaptureEnabled()).toBe(false);
  });
});

describe("capturePaymentFee desligada", () => {
  it.each([undefined, "", "off"])(
    "PAYMENT_FEE_CAPTURE=%j: devolve ignorado sem tocar no banco nem no provedor",
    async (value) => {
      vi.stubEnv("PAYMENT_FEE_CAPTURE", value);
      const { admin, rpc, from } = makeAdmin({ rpc: { record_payment_fee: saved } });
      const provider = makeProvider();

      await expect(capturePaymentFee(admin, provider, orderId)).resolves.toBe("ignorado");
      expect(from).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(provider.findPaymentFee).not.toHaveBeenCalled();
    },
  );
});

describe("capturePaymentFee ligada", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("tarifa achada: grava pelo banco com bruto, tarifa, detalhamento e liberação", async () => {
    const { admin, rpc } = makeAdmin({ rpc: { record_payment_fee: saved } });
    const provider = makeProvider();

    await expect(capturePaymentFee(admin, provider, orderId)).resolves.toBe("salvo");
    expect(provider.findPaymentFee).toHaveBeenCalledWith(
      {
        id: orderId,
        createdAt: orderRow.created_at,
        providerOrderId: "ORD01ABC",
        totalCents: 5250,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(rpc).toHaveBeenCalledWith("record_payment_fee", {
      p_order_id: orderId,
      p_gross_cents: 5250,
      p_fee_cents: 261,
      p_breakdown: [{ type: "mercadopago_fee", cents: 261 }],
      p_release_date: "2026-11-20",
      p_after_refund: false,
    });
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it("depois do estorno grava marcando a nova consulta", async () => {
    const { admin, rpc } = makeAdmin({
      order: { ...orderRow, status: "estornado" },
      rpc: { record_payment_fee: saved },
    });

    await expect(
      capturePaymentFee(admin, makeProvider(), orderId, { afterRefund: true }),
    ).resolves.toBe("salvo");
    expect(rpc).toHaveBeenCalledWith(
      "record_payment_fee",
      expect.objectContaining({ p_after_refund: true }),
    );
  });

  it("pedido sem cobrança conhecida vai com providerOrderId nulo", async () => {
    const { admin } = makeAdmin({
      order: { ...orderRow, provider_order_id: null },
      rpc: { record_payment_fee: saved },
    });
    const provider = makeProvider();

    await capturePaymentFee(admin, provider, orderId);
    expect(provider.findPaymentFee).toHaveBeenCalledWith(
      expect.objectContaining({ providerOrderId: null }),
      expect.anything(),
    );
  });

  it.each([
    ["manual", "manual"],
    ["ignorado", "ignorado"],
  ])("banco responde %s: devolve %s", async (answer, expected) => {
    const { admin } = makeAdmin({ rpc: { record_payment_fee: () => ({ data: answer, error: null }) } });
    await expect(capturePaymentFee(admin, makeProvider(), orderId)).resolves.toBe(expected);
  });

  it("resposta desconhecida do banco vira falhou", async () => {
    const { admin } = makeAdmin({ rpc: { record_payment_fee: () => ({ data: "outra", error: null }) } });
    await expect(capturePaymentFee(admin, makeProvider(), orderId)).resolves.toBe("falhou");
  });

  it("não encontrada: registra a tentativa com not_found", async () => {
    const { admin, rpc } = makeAdmin({
      rpc: { record_payment_fee_failure: () => ({ data: 1, error: null }) },
    });
    const provider = makeProvider(async () => ({ kind: "not_found" }));

    await expect(capturePaymentFee(admin, provider, orderId)).resolves.toBe("nao_encontrada");
    expect(rpc).toHaveBeenCalledWith("record_payment_fee_failure", {
      p_order_id: orderId,
      p_code: "not_found",
    });
    expect(rpc).not.toHaveBeenCalledWith("record_payment_fee", expect.anything());
  });

  it.each(["timeout", "http", "parse", "ambiguous"] as const)(
    "erro %s do provedor: registra a tentativa com o código e devolve falhou",
    async (code) => {
      const { admin, rpc } = makeAdmin({
        rpc: { record_payment_fee_failure: () => ({ data: 1, error: null }) },
      });
      const provider = makeProvider(async () => ({ kind: "error", code }));

      await expect(capturePaymentFee(admin, provider, orderId)).resolves.toBe("falhou");
      expect(rpc).toHaveBeenCalledWith("record_payment_fee_failure", {
        p_order_id: orderId,
        p_code: code,
      });
    },
  );

  it("banco recusa o valor (TARIFA_VALOR): avisa a equipe, registra a tentativa e devolve falhou", async () => {
    const { admin, rpc } = makeAdmin({
      rpc: {
        record_payment_fee: () => ({
          data: null,
          error: { message: "TARIFA_VALOR: bruto diferente do total do pedido." },
        }),
        record_payment_fee_failure: () => ({ data: 1, error: null }),
      },
    });

    await expect(capturePaymentFee(admin, makeProvider(), orderId)).resolves.toBe("falhou");
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      admin,
      "valor_divergente",
      orderId,
      expect.stringContaining("tarifa"),
    );
    expect(rpc).toHaveBeenCalledWith("record_payment_fee_failure", {
      p_order_id: orderId,
      p_code: "valor",
    });
  });

  it("outro erro do banco ao gravar devolve falhou sem alerta de valor", async () => {
    const { admin } = makeAdmin({
      rpc: {
        record_payment_fee: () => ({ data: null, error: { message: "connection refused" } }),
        record_payment_fee_failure: () => ({ data: 1, error: null }),
      },
    });

    await expect(capturePaymentFee(admin, makeProvider(), orderId)).resolves.toBe("falhou");
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it.each([
    ["cortesia (total zero)", { ...orderRow, total_cents: 0 }],
    ["pedido pendente", { ...orderRow, status: "pendente" }],
    ["pedido cancelado", { ...orderRow, status: "cancelado" }],
    ["pedido inexistente", null],
  ])("%s: devolve ignorado sem consultar o provedor", async (_caso, order) => {
    const { admin, rpc } = makeAdmin({ order });
    const provider = makeProvider();

    await expect(capturePaymentFee(admin, provider, orderId)).resolves.toBe("ignorado");
    expect(provider.findPaymentFee).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falha ao ler o pedido devolve falhou sem consultar o provedor", async () => {
    const { admin } = makeAdmin({ orderError: { message: "fora" } });
    const provider = makeProvider();

    await expect(capturePaymentFee(admin, provider, orderId)).resolves.toBe("falhou");
    expect(provider.findPaymentFee).not.toHaveBeenCalled();
  });

  it("provedor que passa do tempo limite (padrão 5 s) é abortado e vira falhou", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const provider = makeProvider((_order, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const { admin, rpc } = makeAdmin({
      rpc: { record_payment_fee_failure: () => ({ data: 1, error: null }) },
    });

    let settled = false;
    const result = capturePaymentFee(admin, provider, orderId).then((outcome) => {
      settled = true;
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("falhou");
    expect(signal?.aborted).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_payment_fee_failure", {
      p_order_id: orderId,
      p_code: "timeout",
    });
  });

  it("respeita o tempo limite informado", async () => {
    vi.useFakeTimers();
    const provider = makeProvider(() => new Promise(() => {}));
    const { admin } = makeAdmin({
      rpc: { record_payment_fee_failure: () => ({ data: 1, error: null }) },
    });

    const result = capturePaymentFee(admin, provider, orderId, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("falhou");
  });

  it.each([
    [
      "provedor lança",
      () =>
        makeProvider(async () => {
          throw new Error(`falha de rede para ${buyerEmail}`);
        }),
      () => makeAdmin({ rpc: { record_payment_fee_failure: () => ({ data: 1, error: null }) } }),
    ],
    [
      "banco lança ao gravar",
      () => makeProvider(),
      () =>
        makeAdmin({
          rpc: {
            record_payment_fee: () => {
              throw new Error(`erro com ${buyerEmail}`);
            },
            record_payment_fee_failure: () => {
              throw new Error(`erro com ${buyerEmail}`);
            },
          },
        }),
    ],
    [
      "leitura do pedido lança",
      () => makeProvider(),
      () => {
        const fake = makeAdmin();
        fake.from.mockImplementation(() => {
          throw new Error(`erro com ${buyerEmail}`);
        });
        return fake;
      },
    ],
  ])("%s: devolve falhou, nunca lança e não registra dados pessoais", async (_caso, provider, admin) => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    await expect(capturePaymentFee(admin().admin, provider(), orderId)).resolves.toBe("falhou");

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(buyerEmail);
    expect(logged).toContain(orderId);
  });
});

describe("captureOrderFee (sem provedor em mãos)", () => {
  it("desligada: não monta o provedor nem toca no banco", async () => {
    vi.stubEnv("PAYMENT_FEE_CAPTURE", "");
    const { admin, rpc, from } = makeAdmin();

    await expect(captureOrderFee(admin, orderId)).resolves.toBe("ignorado");
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ligada: usa o provedor configurado e repassa as opções", async () => {
    const provider = makeProvider();
    mocks.getPaymentProvider.mockReturnValue(provider);
    const { admin, rpc } = makeAdmin({ rpc: { record_payment_fee: saved } });

    await expect(captureOrderFee(admin, orderId, { afterRefund: true })).resolves.toBe("salvo");
    expect(provider.findPaymentFee).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "record_payment_fee",
      expect.objectContaining({ p_after_refund: true }),
    );
  });

  it("provedor mal configurado devolve falhou sem lançar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPaymentProvider.mockImplementation(() => {
      throw new Error("Provedor de pagamento não suportado");
    });
    const { admin } = makeAdmin();

    await expect(captureOrderFee(admin, orderId)).resolves.toBe("falhou");
  });
});

describe("captureMissingFees", () => {
  const ids = Array.from(
    { length: 6 },
    (_, index) => `0a1b2c3d-0000-4000-8000-00000000002${index}`,
  );
  const queue = (count: number, extra: Record<string, unknown> = {}) =>
    ids.slice(0, count).map((id) => ({
      order_id: id,
      created_at: orderRow.created_at,
      provider_order_id: "ORD01ABC",
      after_refund: false,
      attempts: 0,
      ...extra,
    }));
  const ordersById = Object.fromEntries(ids.map((id) => [id, { ...orderRow, id }]));

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("desligada: não toca no banco nem no provedor", async () => {
    vi.stubEnv("PAYMENT_FEE_CAPTURE", "off");
    const { admin, rpc, from } = makeAdmin();
    const provider = makeProvider();

    await expect(captureMissingFees(admin, provider)).resolves.toEqual({
      salvo: 0,
      falhou: 0,
      alertados: 0,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(provider.findPaymentFee).not.toHaveBeenCalled();
  });

  it("pede até 20 pedidos por padrão e conta os salvos", async () => {
    const { admin, rpc } = makeAdmin({
      orders: ordersById,
      rpc: {
        orders_missing_fee: () => ({ data: queue(2), error: null }),
        record_payment_fee: saved,
      },
    });

    await expect(captureMissingFees(admin, makeProvider())).resolves.toEqual({
      salvo: 2,
      falhou: 0,
      alertados: 0,
    });
    expect(rpc).toHaveBeenCalledWith("orders_missing_fee", { p_limit: 20 });
  });

  it("respeita o limite informado", async () => {
    const { admin, rpc } = makeAdmin({
      rpc: { orders_missing_fee: () => ({ data: [], error: null }) },
    });
    await captureMissingFees(admin, makeProvider(), { limit: 5 });
    expect(rpc).toHaveBeenCalledWith("orders_missing_fee", { p_limit: 5 });
  });

  it("pedido estornado da fila é consultado de novo como depois do estorno", async () => {
    const { admin, rpc } = makeAdmin({
      orders: ordersById,
      rpc: {
        orders_missing_fee: () => ({ data: queue(1, { after_refund: true }), error: null }),
        record_payment_fee: saved,
      },
    });

    await captureMissingFees(admin, makeProvider());
    expect(rpc).toHaveBeenCalledWith(
      "record_payment_fee",
      expect.objectContaining({ p_order_id: ids[0], p_after_refund: true }),
    );
  });

  it("na 5ª tentativa sem achar, avisa a equipe com o número do pedido", async () => {
    const attempts: Record<string, number> = { [ids[0]]: 2, [ids[1]]: 5 };
    const { admin } = makeAdmin({
      orders: ordersById,
      rpc: {
        orders_missing_fee: () => ({ data: queue(2), error: null }),
        record_payment_fee_failure: (args) => ({
          data: attempts[String(args.p_order_id)],
          error: null,
        }),
      },
    });
    const provider = makeProvider(async () => ({ kind: "not_found" }));

    await expect(captureMissingFees(admin, provider)).resolves.toEqual({
      salvo: 0,
      falhou: 2,
      alertados: 1,
    });
    expect(mocks.alertTeam).toHaveBeenCalledTimes(1);
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      admin,
      "tarifa_nao_encontrada",
      ids[1],
      "Tarifa do pedido Nº 0A1B2C3D não encontrada; lance pelo extrato na página Repasses.",
    );
  });

  it("para de consultar quando passa do orçamento de tempo (padrão 25 s)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const provider = makeProvider(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return foundFee;
    });
    const { admin } = makeAdmin({
      orders: ordersById,
      rpc: {
        orders_missing_fee: () => ({ data: queue(6), error: null }),
        record_payment_fee: saved,
      },
    });

    await expect(captureMissingFees(admin, provider)).resolves.toEqual({
      salvo: 3,
      falhou: 0,
      alertados: 0,
    });
    expect(provider.findPaymentFee).toHaveBeenCalledTimes(3);
  });

  it("respeita o orçamento informado", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const provider = makeProvider(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return foundFee;
    });
    const { admin } = makeAdmin({
      orders: ordersById,
      rpc: {
        orders_missing_fee: () => ({ data: queue(6), error: null }),
        record_payment_fee: saved,
      },
    });

    await captureMissingFees(admin, provider, { budgetMs: 5_000 });
    expect(provider.findPaymentFee).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["erro do banco", () => ({ data: null, error: { message: "fora" } })],
    [
      "exceção",
      () => {
        throw new Error(`erro com ${buyerEmail}`);
      },
    ],
    ["resposta que não é lista", () => ({ data: "x", error: null })],
  ])("falha ao ler a fila (%s) devolve zeros sem lançar", async (_caso, handler) => {
    const { admin } = makeAdmin({ rpc: { orders_missing_fee: handler as RpcHandler } });
    const provider = makeProvider();

    await expect(captureMissingFees(admin, provider)).resolves.toEqual({
      salvo: 0,
      falhou: 0,
      alertados: 0,
    });
    expect(provider.findPaymentFee).not.toHaveBeenCalled();
  });

  it("um pedido que falha não impede os seguintes", async () => {
    let call = 0;
    const provider = makeProvider(async () => {
      call += 1;
      if (call === 1) throw new Error("rede");
      return foundFee;
    });
    const { admin } = makeAdmin({
      orders: ordersById,
      rpc: {
        orders_missing_fee: () => ({ data: queue(2), error: null }),
        record_payment_fee: saved,
        record_payment_fee_failure: () => ({ data: 1, error: null }),
      },
    });

    await expect(captureMissingFees(admin, provider)).resolves.toEqual({
      salvo: 1,
      falhou: 1,
      alertados: 0,
    });
  });
});
