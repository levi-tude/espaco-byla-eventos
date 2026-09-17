import { describe, expect, it, vi } from "vitest";
import { PagBankPaymentProvider } from "@/lib/payments/pagbank";

const paymentInput = {
  orderId: "00000000-0000-4000-8000-000000000001",
  amountCents: 5000,
  description: "Ingressos — Show de teste",
  buyerEmail: "comprador@example.com",
  successUrl: "https://eventos.example/pedidos/token",
  failureUrl: "https://eventos.example/eventos/show/checkout",
};

describe("PagBankPaymentProvider.createPayment", () => {
  it("envia reference_id e x-idempotency-key com o orderId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "CHEC_TEST",
        links: [{ rel: "PAY", href: "https://pagamento.example/pay" }],
      }),
    });
    const provider = new PagBankPaymentProvider({
      token: "token-ficticio",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    await provider.createPayment(paymentInput);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox.api.pagseguro.com/checkouts");
    expect(init.headers).toMatchObject({
      "x-idempotency-key": paymentInput.orderId,
    });
    const body = JSON.parse(String(init.body));
    expect(body.reference_id).toBe(paymentInput.orderId);
    expect(body.items[0].reference_id).toBe(paymentInput.orderId);
  });
});

describe("PagBankPaymentProvider.reconcileCheckout", () => {
  it("reenvia o checkout idempotente e devolve a URL quando encontrado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "CHEC_TEST",
        links: [{ rel: "PAY", href: "https://pagamento.example/pay" }],
      }),
    });
    const provider = new PagBankPaymentProvider({
      token: "token-ficticio",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    await expect(provider.reconcileCheckout(paymentInput)).resolves.toEqual({
      externalId: paymentInput.orderId,
      checkoutUrl: "https://pagamento.example/pay",
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "x-idempotency-key": paymentInput.orderId,
      }),
    });
  });

  it("retorna null quando o PagBank não devolve checkout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error_messages: [{ description: "Checkout indisponível" }],
      }),
    });
    const provider = new PagBankPaymentProvider({
      token: "token-ficticio",
      appUrl: "https://eventos.example",
      fetch: fetchMock,
    });

    await expect(provider.reconcileCheckout(paymentInput)).resolves.toBeNull();
  });
});
