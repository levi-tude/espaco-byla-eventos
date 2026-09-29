import { describe, expect, it, vi } from "vitest";
import { MercadoPagoPaymentProvider } from "@/lib/payments/mercadopago";

const orderId = "00000000-0000-4000-8000-000000000099";

const cardInput = {
  orderId,
  amountCents: 2500,
  description: "Ingressos — Show de teste",
  paymentMethodId: "master",
  cardToken: "card-token-1",
  installments: 1,
  issuerId: "24",
  payer: {
    email: "comprador@example.com",
    identification: { type: "CPF", number: "12345678909" },
  },
};

const pixInput = {
  orderId,
  amountCents: 1,
  description: "Ingressos — Show de teste",
  paymentMethodId: "pix",
  payer: { email: "comprador@example.com" },
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function makeProvider(fetchMock: ReturnType<typeof vi.fn>, appUrl = "https://eventos.example") {
  return new MercadoPagoPaymentProvider({
    accessToken: "TEST-TOKEN",
    appUrl,
    fetch: fetchMock as unknown as typeof fetch,
  });
}

describe("MercadoPagoPaymentProvider.createPayment", () => {
  it("cobra o cartão com valor em reais, pedido como referência e chave de idempotência", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 555, status: "approved" }));

    await expect(makeProvider(fetchMock).createPayment(cardInput)).resolves.toEqual({
      status: "approved",
      paymentId: "555",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/payments");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TEST-TOKEN");
    expect(headers["X-Idempotency-Key"]).toBeTruthy();

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      transaction_amount: 25,
      token: "card-token-1",
      installments: 1,
      issuer_id: "24",
      payment_method_id: "master",
      external_reference: orderId,
      notification_url: "https://eventos.example/api/payments/webhook",
      payer: {
        email: "comprador@example.com",
        identification: { type: "CPF", number: "12345678909" },
      },
    });
  });

  it("devolve QR Code do PIX quando o pagamento fica pendente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 777,
        status: "pending",
        date_of_expiration: "2026-09-24T15:00:00.000-03:00",
        point_of_interaction: {
          transaction_data: { qr_code: "000201PIX", qr_code_base64: "aW1n" },
        },
      }),
    );

    await expect(makeProvider(fetchMock).createPayment(pixInput)).resolves.toEqual({
      status: "pending",
      paymentId: "777",
      pix: {
        qrCode: "000201PIX",
        qrCodeBase64: "aW1n",
        expiresAt: "2026-09-24T15:00:00.000-03:00",
      },
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.transaction_amount).toBe(0.01);
    expect(body.payment_method_id).toBe("pix");
    expect(body.token).toBeUndefined();
    expect(body.date_of_expiration).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
  });

  it("traduz recusa do cartão para mensagem ao comprador", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 888,
        status: "rejected",
        status_detail: "cc_rejected_insufficient_amount",
      }),
    );

    await expect(makeProvider(fetchMock).createPayment(cardInput)).resolves.toEqual({
      status: "rejected",
      paymentId: "888",
      reason: "Cartão sem limite suficiente. Tente outro cartão ou pague com PIX.",
    });
  });

  it("não envia notification_url quando o site não tem https público", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 1, status: "approved" }));

    await makeProvider(fetchMock, "http://localhost:3000").createPayment(cardInput);

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.notification_url).toBeUndefined();
  });

  it("explica erro de credencial quando o Mercado Pago recusa a chamada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { status: 401, message: "Unauthorized use of live credentials" },
        false,
      ),
    );

    await expect(makeProvider(fetchMock).createPayment(cardInput)).rejects.toThrow(
      /Mercado Pago recusou o pagamento: Unauthorized use of live credentials/,
    );
  });
});

describe("MercadoPagoPaymentProvider.findOrderPayment", () => {
  it("encontra pagamento aprovado do pedido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { id: 2, status: "rejected", external_reference: orderId },
          { id: 1, status: "approved", external_reference: orderId },
        ],
      }),
    );

    await expect(makeProvider(fetchMock).findOrderPayment(orderId)).resolves.toEqual({
      kind: "paid",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${orderId}&sort=date_created&criteria=desc`,
    );
  });

  it("recupera PIX pendente ainda válido para mostrar o mesmo QR", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: 3,
            status: "pending",
            payment_method_id: "pix",
            external_reference: orderId,
            date_of_expiration: future,
            point_of_interaction: {
              transaction_data: { qr_code: "PIXCODE", qr_code_base64: "QR64" },
            },
          },
        ],
      }),
    );

    await expect(makeProvider(fetchMock).findOrderPayment(orderId)).resolves.toEqual({
      kind: "pending_pix",
      pix: { qrCode: "PIXCODE", qrCodeBase64: "QR64", expiresAt: future },
    });
  });

  it("ignora PIX expirado", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: 4,
            status: "pending",
            payment_method_id: "pix",
            external_reference: orderId,
            date_of_expiration: past,
            point_of_interaction: {
              transaction_data: { qr_code: "OLD", qr_code_base64: "OLD64" },
            },
          },
        ],
      }),
    );

    await expect(makeProvider(fetchMock).findOrderPayment(orderId)).resolves.toEqual({
      kind: "none",
    });
  });
});

describe("MercadoPagoPaymentProvider.parseWebhook", () => {
  it("consulta o pagamento e marca como pago quando approved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 123, status: "approved", external_reference: orderId }),
    );

    const request = new Request("https://eventos.example/api/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: "123" } }),
    });

    await expect(makeProvider(fetchMock).parseWebhook(request)).resolves.toEqual({
      kind: "paid",
      externalId: orderId,
    });
  });
});
