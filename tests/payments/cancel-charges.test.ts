import { describe, expect, it, vi } from "vitest";

import { MercadoPagoPaymentProvider } from "@/lib/payments/mercadopago";

const orderId = "00000000-0000-4000-8000-000000000099";
const orderRef = { id: orderId, createdAt: "2026-10-01T15:00:00.000Z" };
const API = "https://api.mercadopago.com";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

type Route = (init: RequestInit | undefined) => unknown;

/** Responde por "MÉTODO caminho"; a busca é `GET /v1/orders`. Cada rota pode ser uma fila. */
function apiMock(routes: Record<string, Route | Route[]>) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const route = routes[key];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) throw new Error(`rota inesperada: ${key}`);
    return handler(init);
  });
}

function makeProvider(fetchMock: ReturnType<typeof vi.fn>) {
  return new MercadoPagoPaymentProvider({
    accessToken: "APP_USR-TOKEN",
    fetch: fetchMock as unknown as typeof fetch,
  });
}

const pixOrder = {
  id: "ORDPIX1",
  status: "action_required",
  status_detail: "waiting_transfer",
  external_reference: orderId,
  transactions: {
    payments: [{ id: "PAYPIX1", payment_method: { id: "pix", type: "bank_transfer" } }],
  },
};

const paidOrder = {
  id: "ORDPIX1",
  status: "processed",
  status_detail: "accredited",
  external_reference: orderId,
  total_amount: "25.00",
  total_paid_amount: "25.00",
  transactions: { payments: [{ id: "PAYPIX1", status: "processed" }] },
};

const cancelledOrder = { ...pixOrder, status: "canceled", status_detail: "canceled_transaction" };

function cancelCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/cancel"));
}

describe("MercadoPagoPaymentProvider.cancelPendingCharges", () => {
  it("sem cobrança no Mercado Pago não cancela nada", async () => {
    const fetchMock = apiMock({ "GET /v1/orders": () => jsonResponse({ data: [] }) });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "cleared",
    });
    expect(cancelCalls(fetchMock)).toHaveLength(0);
  });

  it("PIX gerado é cancelado com POST /cancel e chave de idempotência", async () => {
    const fetchMock = apiMock({
      "GET /v1/orders": () => jsonResponse({ data: [pixOrder] }),
      "GET /v1/orders/ORDPIX1": () => jsonResponse(pixOrder),
      "POST /v1/orders/ORDPIX1/cancel": () => jsonResponse(cancelledOrder),
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "cleared",
    });
    const [[url, init]] = cancelCalls(fetchMock) as [string, RequestInit][];
    expect(url).toBe(`${API}/v1/orders/ORDPIX1/cancel`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer APP_USR-TOKEN");
    expect(headers["X-Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("pagamento aprovado é devolvido como pago e nada é cancelado", async () => {
    const fetchMock = apiMock({
      "GET /v1/orders": () => jsonResponse({ data: [paidOrder] }),
      "GET /v1/orders/ORDPIX1": () => jsonResponse(paidOrder),
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "paid",
      amountCents: 2500,
      providerOrderId: "ORDPIX1",
      providerPaymentId: "PAYPIX1",
    });
    expect(cancelCalls(fetchMock)).toHaveLength(0);
  });

  it("cartão em análise impede a troca, mesmo com PIX em aberto", async () => {
    const reviewing = {
      id: "ORDCARD1",
      status: "processing",
      status_detail: "in_review",
      external_reference: orderId,
      transactions: { payments: [{ id: "PAYCARD1", payment_method: { id: "master" } }] },
    };
    const fetchMock = apiMock({
      "GET /v1/orders": () => jsonResponse({ data: [pixOrder, reviewing] }),
      "GET /v1/orders/ORDPIX1": () => jsonResponse(pixOrder),
      "GET /v1/orders/ORDCARD1": () => jsonResponse(reviewing),
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "processing",
    });
    expect(cancelCalls(fetchMock)).toHaveLength(0);
  });

  it("orders já encerradas são ignoradas sem consulta extra", async () => {
    const fetchMock = apiMock({
      "GET /v1/orders": () =>
        jsonResponse({
          data: [
            { id: "ORD1", status: "expired", external_reference: orderId },
            { id: "ORD2", status: "failed", external_reference: orderId },
            { id: "ORD3", status: "canceled", external_reference: orderId },
            { id: "ORD9", status: "action_required", external_reference: "outro-pedido" },
          ],
        }),
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "cleared",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("corrida: o PIX foi pago antes do cancelamento → confirma em vez de cancelar", async () => {
    const fetchMock = apiMock({
      "GET /v1/orders": () => jsonResponse({ data: [pixOrder] }),
      "GET /v1/orders/ORDPIX1": [() => jsonResponse(pixOrder), () => jsonResponse(paidOrder)],
      "POST /v1/orders/ORDPIX1/cancel": () =>
        jsonResponse({ errors: [{ code: "cannot_cancel_order" }] }, 409),
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toMatchObject({
      kind: "paid",
      amountCents: 2500,
      providerOrderId: "ORDPIX1",
    });
  });

  it("resposta perdida, mas a reconsulta mostra a order cancelada → segue", async () => {
    const fetchMock = apiMock({
      "GET /v1/orders": () => jsonResponse({ data: [pixOrder] }),
      "GET /v1/orders/ORDPIX1": [() => jsonResponse(pixOrder), () => jsonResponse(cancelledOrder)],
      "POST /v1/orders/ORDPIX1/cancel": () => {
        throw new Error("timeout");
      },
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "cleared",
    });
  });

  it("sem confirmar que o PIX deixou de valer, não autoriza a troca", async () => {
    const fetchMock = apiMock({
      "GET /v1/orders": () => jsonResponse({ data: [pixOrder] }),
      "GET /v1/orders/ORDPIX1": [() => jsonResponse(pixOrder), () => jsonResponse(pixOrder)],
      "POST /v1/orders/ORDPIX1/cancel": () => jsonResponse({ message: "erro" }, 500),
    });

    await expect(makeProvider(fetchMock).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("busca fora do ar ou sem credencial: não autoriza a troca", async () => {
    const down = apiMock({ "GET /v1/orders": () => jsonResponse({}, 503) });
    await expect(makeProvider(down).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "unavailable",
    });

    const offline = apiMock({
      "GET /v1/orders": () => {
        throw new Error("rede");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(makeProvider(offline).cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "unavailable",
    });

    const noToken = new MercadoPagoPaymentProvider({
      accessToken: "",
      fetch: down as unknown as typeof fetch,
    });
    await expect(noToken.cancelPendingCharges(orderRef)).resolves.toEqual({
      kind: "unavailable",
    });
  });
});
