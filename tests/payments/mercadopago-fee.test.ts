import { afterEach, describe, expect, it, vi } from "vitest";

import { MercadoPagoPaymentProvider } from "@/lib/payments/mercadopago";

const orderId = "00000000-0000-4000-8000-000000000099";
const API = "https://api.mercadopago.com";
const buyerEmail = "comprador@example.com";

const order = {
  id: orderId,
  createdAt: "2026-10-01T15:00:00.000Z",
  providerOrderId: "ORD01ABC" as string | null,
  totalCents: 5250,
};

const payment = {
  id: 123456789,
  status: "approved",
  external_reference: orderId,
  transaction_amount: 52.5,
  transaction_details: { net_received_amount: 49.89 },
  fee_details: [{ type: "mercadopago_fee", amount: 2.61, fee_payer: "collector" }],
  money_release_date: "2026-11-20T10:00:00.000-04:00",
  payer: { email: buyerEmail },
};

const expectedFee = {
  grossCents: 5250,
  feeCents: 261,
  breakdown: [{ type: "mercadopago_fee", cents: 261 }],
  releaseDate: "2026-11-20",
  refunded: false,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

type Route = (init: RequestInit | undefined) => unknown;

/** Responde por caminho (`/v1/payments/search`, `/v1/orders/ORD…`, `/v1/payments/123`). */
function apiMock(routes: Record<string, Route>) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const route = routes[url.pathname];
    if (!route) throw new Error(`rota inesperada: ${url.pathname}`);
    return route(init);
  });
}

function makeProvider(fetchMock: ReturnType<typeof vi.fn>, accessToken = "APP_USR-TOKEN") {
  return new MercadoPagoPaymentProvider({
    accessToken,
    fetch: fetchMock as unknown as typeof fetch,
  });
}

function options() {
  return { signal: new AbortController().signal };
}

function calledPaths(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MercadoPagoPaymentProvider.findPaymentFee — busca pelo pedido", () => {
  it("busca pagamentos pela referência do pedido com o token e o sinal recebido", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [payment] }),
    });
    const signal = new AbortController().signal;

    await expect(makeProvider(fetchMock).findPaymentFee(order, { signal })).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(`${API}/v1/payments/search`);
    expect(parsed.searchParams.get("external_reference")).toBe(orderId);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer APP_USR-TOKEN");
    expect(init.signal).toBe(signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignora pagamentos de outro pedido que a busca devolver", async () => {
    const other = { ...payment, id: 999, external_reference: "outro-pedido" };
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [other, payment] }),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });
  });

  it("escolhe o aprovado quando também há tentativa recusada", async () => {
    const rejected = { ...payment, id: 1, status: "rejected" };
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [rejected, payment] }),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });
  });

  it("devolve ambíguo com dois pagamentos aprovados do mesmo valor", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () =>
        jsonResponse({ results: [payment, { ...payment, id: 2 }] }),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "ambiguous",
    });
  });

  it("devolve erro de leitura quando o pagamento escolhido vem com valores inválidos", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () =>
        jsonResponse({
          results: [{ ...payment, transaction_details: { net_received_amount: 80 } }],
        }),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "parse",
    });
  });

  it("devolve erro de leitura quando a busca não traz a lista de resultados", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ resultado: "x" }),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "parse",
    });
  });

  it("devolve erro HTTP quando a busca falha no servidor", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ message: "erro" }, 500),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "http",
    });
  });

  it("devolve tempo esgotado quando a consulta é abortada", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("Abortado", "AbortError");
      return jsonResponse({ results: [payment] });
    });
    controller.abort();

    await expect(
      makeProvider(fetchMock).findPaymentFee(order, { signal: controller.signal }),
    ).resolves.toEqual({ kind: "error", code: "timeout" });
  });

  it("devolve tempo esgotado quando o tempo limite estoura", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("Tempo esgotado", "TimeoutError");
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "timeout",
    });
  });

  it("não consulta nada sem credencial configurada", async () => {
    const fetchMock = vi.fn();

    await expect(
      makeProvider(fetchMock, "").findPaymentFee(order, options()),
    ).resolves.toEqual({ kind: "error", code: "http" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MercadoPagoPaymentProvider.findPaymentFee — pela cobrança do pedido", () => {
  it("sem resultado na busca, segue a referência do pagamento da cobrança", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () =>
        jsonResponse({
          id: "ORD01ABC",
          external_reference: orderId,
          transactions: { payments: [{ id: "PAY01ABC", reference_id: "123456789" }] },
        }),
      "/v1/payments/123456789": () => jsonResponse(payment),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });
    expect(calledPaths(fetchMock)).toEqual([
      "/v1/payments/search",
      "/v1/orders/ORD01ABC",
      "/v1/payments/123456789",
    ]);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer APP_USR-TOKEN");
    }
  });

  it("usa o id do pagamento quando a cobrança não traz reference_id", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () =>
        jsonResponse({ id: "ORD01ABC", transactions: { payments: [{ id: "PAY01ABC" }] } }),
      "/v1/payments/PAY01ABC": () => jsonResponse(payment),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });
  });

  it("escolhe o aprovado entre as tentativas da cobrança", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () =>
        jsonResponse({
          id: "ORD01ABC",
          transactions: {
            payments: [
              { id: "PAY01", reference_id: "111" },
              { id: "PAY02", reference_id: "123456789" },
            ],
          },
        }),
      "/v1/payments/111": () => jsonResponse({ ...payment, id: 111, status: "rejected" }),
      "/v1/payments/123456789": () => jsonResponse(payment),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });
  });

  it("devolve não encontrado com busca vazia e sem cobrança conhecida", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
    });

    await expect(
      makeProvider(fetchMock).findPaymentFee({ ...order, providerOrderId: null }, options()),
    ).resolves.toEqual({ kind: "not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devolve não encontrado quando a busca e a cobrança respondem 404", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({}, 404),
      "/v1/orders/ORD01ABC": () => jsonResponse({}, 404),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "not_found",
    });
  });

  it("devolve não encontrado quando o pagamento da cobrança responde 404", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () =>
        jsonResponse({ id: "ORD01ABC", transactions: { payments: [{ reference_id: "777" }] } }),
      "/v1/payments/777": () => jsonResponse({}, 404),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "not_found",
    });
  });

  it("referência que o pagamento recusa (400) conta como não achado e segue para a próxima", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () =>
        jsonResponse({
          id: "ORD01ABC",
          transactions: {
            payments: [{ id: "PAY01ABC" }, { id: "PAY02", reference_id: "123456789" }],
          },
        }),
      "/v1/payments/PAY01ABC": () => jsonResponse({ message: "invalid id" }, 400),
      "/v1/payments/123456789": () => jsonResponse(payment),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "found",
      fee: expectedFee,
    });
  });

  it("devolve não encontrado quando a única referência da cobrança responde 400", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () =>
        jsonResponse({ id: "ORD01ABC", transactions: { payments: [{ id: "PAY01ABC" }] } }),
      "/v1/payments/PAY01ABC": () => jsonResponse({}, 400),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "not_found",
    });
  });

  it("400 na busca pela referência do pedido continua sendo erro HTTP", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({}, 400),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "http",
    });
  });

  it("devolve erro HTTP quando a cobrança falha no servidor", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
      "/v1/orders/ORD01ABC": () => jsonResponse({}, 500),
    });

    await expect(makeProvider(fetchMock).findPaymentFee(order, options())).resolves.toEqual({
      kind: "error",
      code: "http",
    });
  });

  it("não consulta cobrança com identificador fora do formato", async () => {
    const fetchMock = apiMock({
      "/v1/payments/search": () => jsonResponse({ results: [] }),
    });

    await expect(
      makeProvider(fetchMock).findPaymentFee({ ...order, providerOrderId: "../x?y" }, options()),
    ).resolves.toEqual({ kind: "not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("MercadoPagoPaymentProvider.findPaymentFee — registros", () => {
  it("nunca registra a resposta do banco de pagamento nem dados do comprador", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const scenarios = [
      apiMock({ "/v1/payments/search": () => jsonResponse({ results: [payment] }) }),
      apiMock({
        "/v1/payments/search": () =>
          jsonResponse({ results: [payment, { ...payment, id: 2 }] }),
      }),
      apiMock({
        "/v1/payments/search": () =>
          jsonResponse({ results: [{ ...payment, transaction_amount: "x" }] }),
      }),
      apiMock({ "/v1/payments/search": () => jsonResponse({ payer: payment.payer }, 500) }),
    ];

    for (const fetchMock of scenarios) {
      await makeProvider(fetchMock).findPaymentFee(order, options());
    }

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(buyerEmail);
    expect(logged).not.toContain("fee_details");
    expect(logged).not.toContain("net_received_amount");
    expect(logged).not.toContain("APP_USR-TOKEN");
  });
});
