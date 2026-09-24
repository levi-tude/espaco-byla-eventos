import { describe, expect, it, vi } from "vitest";
import { MercadoPagoPaymentProvider } from "@/lib/payments/mercadopago";

const paymentInput = {
  orderId: "00000000-0000-4000-8000-000000000099",
  amountCents: 1,
  description: "Ingressos — Show de teste",
  buyerEmail: "comprador@example.com",
  successUrl: "https://eventos.example/pedidos/token",
  failureUrl: "https://eventos.example/eventos/show/checkout",
};

describe("MercadoPagoPaymentProvider.createPayment", () => {
  it("cria preferência com external_reference e unit_price em reais", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "pref-test",
        sandbox_init_point: "https://sandbox.mercadopago.com/checkout/v1/redirect?pref_id=pref-test",
        init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test",
      }),
    });
    const provider = new MercadoPagoPaymentProvider({
      accessToken: "TEST-TOKEN",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    const result = await provider.createPayment(paymentInput);

    expect(result).toEqual({
      externalId: paymentInput.orderId,
      checkoutUrl:
        "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      external_reference: string;
      items: Array<{ unit_price: number }>;
      notification_url: string;
    };
    expect(body.external_reference).toBe(paymentInput.orderId);
    expect(body.items[0]?.unit_price).toBe(0.01);
    expect(body.notification_url).toBe(
      "https://eventos.example/api/payments/webhook",
    );
  });
});

describe("MercadoPagoPaymentProvider.confirmPayment", () => {
  it("confirma pagamento aprovado pelo id retornado no redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 179491423319,
        status: "approved",
        external_reference: paymentInput.orderId,
      }),
    });
    const provider = new MercadoPagoPaymentProvider({
      accessToken: "TEST-TOKEN",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    await expect(provider.confirmPayment("179491423319")).resolves.toEqual({
      kind: "paid",
      externalId: paymentInput.orderId,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payments/179491423319",
      expect.objectContaining({
        headers: { Authorization: "Bearer TEST-TOKEN" },
      }),
    );
  });

  it("ignora quando o pagamento não está approved", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 1,
        status: "pending",
        external_reference: paymentInput.orderId,
      }),
    });
    const provider = new MercadoPagoPaymentProvider({
      accessToken: "TEST-TOKEN",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    await expect(provider.confirmPayment("1")).resolves.toEqual({
      kind: "ignored",
      externalId: paymentInput.orderId,
    });
  });
});

describe("MercadoPagoPaymentProvider.parseWebhook", () => {
  it("consulta o pagamento e marca como pago quando approved", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 123,
        status: "approved",
        external_reference: paymentInput.orderId,
      }),
    });
    const provider = new MercadoPagoPaymentProvider({
      accessToken: "TEST-TOKEN",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    const request = new Request(
      "https://eventos.example/api/payments/webhook",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "payment",
          data: { id: "123" },
        }),
      },
    );

    await expect(provider.parseWebhook(request)).resolves.toEqual({
      kind: "paid",
      externalId: paymentInput.orderId,
    });
  });
});
