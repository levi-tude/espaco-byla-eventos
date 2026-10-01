import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MercadoPagoPaymentProvider } from "@/lib/payments/mercadopago";

const orderId = "00000000-0000-4000-8000-000000000099";
const orderRef = { id: orderId, createdAt: "2026-09-30T15:00:00.000Z" };

const cardInput = {
  orderId,
  amountCents: 2500,
  description: "Ingressos — Show de teste",
  paymentMethodId: "master",
  cardToken: "card-token-1",
  cardType: "debit_card" as const,
  installments: 1,
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

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeProvider(fetchMock: ReturnType<typeof vi.fn>) {
  return new MercadoPagoPaymentProvider({
    accessToken: "APP_USR-TOKEN",
    fetch: fetchMock as unknown as typeof fetch,
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(String((fetchMock.mock.calls[call] as [string, RequestInit])[1].body));
}

describe("MercadoPagoPaymentProvider.createPayment", () => {
  it("cria order com valor em reais, pedido como referência e chave de idempotência", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "ORD1", status: "processed" }));

    await expect(makeProvider(fetchMock).createPayment(cardInput)).resolves.toEqual({
      status: "approved",
      paymentId: "ORD1",
      providerOrderId: "ORD1",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/orders");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer APP_USR-TOKEN");
    expect(headers["X-Idempotency-Key"]).toBeTruthy();

    expect(sentBody(fetchMock)).toEqual({
      type: "online",
      processing_mode: "automatic",
      external_reference: orderId,
      total_amount: "25.00",
      description: "Ingressos — Show de teste",
      payer: {
        email: "comprador@example.com",
        identification: { type: "CPF", number: "12345678909" },
      },
      transactions: {
        payments: [
          {
            amount: "25.00",
            payment_method: {
              id: "master",
              type: "debit_card",
              token: "card-token-1",
              installments: 1,
              statement_descriptor: "ESPACO BYLA",
            },
          },
        ],
      },
    });
  });

  it("devolve QR Code do PIX quando a order aguarda pagamento", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ORD2",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              status: "action_required",
              date_of_expiration: "2026-09-30T15:30:00.000-03:00",
              payment_method: {
                id: "pix",
                type: "bank_transfer",
                qr_code: "000201PIX",
                qr_code_base64: "aW1n",
              },
            },
          ],
        },
      }),
    );

    await expect(makeProvider(fetchMock).createPayment(pixInput)).resolves.toEqual({
      status: "pending",
      paymentId: "ORD2",
      pix: {
        qrCode: "000201PIX",
        qrCodeBase64: "aW1n",
        expiresAt: "2026-09-30T15:30:00.000-03:00",
      },
    });

    const payment = sentBody(fetchMock).transactions.payments[0];
    expect(payment).toEqual({
      amount: "0.01",
      expiration_time: "PT30M",
      payment_method: { id: "pix", type: "bank_transfer" },
    });
  });

  it("traduz cartão recusado (HTTP 402) para mensagem ao comprador", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            id: "ORD3",
            status: "failed",
            transactions: {
              payments: [{ status: "failed", status_detail: "insufficient_amount" }],
            },
          },
          errors: [
            {
              code: "failed",
              message: "The following transactions failed",
              details: ["PAY01ABC: insufficient_amount"],
            },
          ],
        },
        402,
      ),
    );

    await expect(makeProvider(fetchMock).createPayment(cardInput)).resolves.toEqual({
      status: "rejected",
      paymentId: "ORD3",
      reason: "Cartão sem limite suficiente. Tente outro cartão ou pague com PIX.",
    });
  });

  it("lê o motivo da recusa em errors[].details quando a order vem sem detalhe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { errors: [{ code: "failed", details: ["PAY01XYZ: card_disabled"] }] },
        402,
      ),
    );

    await expect(makeProvider(fetchMock).createPayment(cardInput)).resolves.toEqual({
      status: "rejected",
      reason: "Cartão desativado. Ative com o seu banco ou use outro cartão.",
    });
  });

  it("usa mensagem genérica quando o motivo da recusa é desconhecido", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [{ code: "failed" }] }, 402));

    await expect(makeProvider(fetchMock).createPayment(cardInput)).resolves.toEqual({
      status: "rejected",
      reason: "Pagamento recusado. Tente outro cartão ou pague com PIX.",
    });
  });

  it("explica erro de credencial quando o Mercado Pago recusa a chamada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          errors: [
            {
              code: "invalid_credentials",
              message: "Test credentials are not supported",
            },
          ],
        },
        401,
      ),
    );

    await expect(makeProvider(fetchMock).createPayment(cardInput)).rejects.toThrow(
      /Mercado Pago recusou o pagamento: Test credentials are not supported/,
    );
  });
});

describe("MercadoPagoPaymentProvider.findOrderPayment", () => {
  it("busca orders do pedido no intervalo de datas e reconhece pagamento aprovado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "ORD5", status: "failed", external_reference: orderId },
          {
            id: "ORD4",
            status: "processed",
            external_reference: orderId,
            total_amount: "25.00",
            total_paid_amount: "25.00",
          },
        ],
      }),
    );

    await expect(makeProvider(fetchMock).findOrderPayment(orderRef)).resolves.toEqual({
      kind: "paid",
      amountCents: 2500,
      providerOrderId: "ORD4",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.mercadopago.com/v1/orders");
    expect(url.searchParams.get("external_reference")).toBe(orderId);
    expect(url.searchParams.get("begin_date")).toBe("2026-09-30T14:50:00.000Z");
    expect(Date.parse(url.searchParams.get("end_date")!)).toBeGreaterThan(Date.now());
  });

  it("confirma na order completa e devolve os IDs da order e do pagamento", async () => {
    const summary = {
      id: "ORD4",
      status: "processed",
      external_reference: orderId,
      total_amount: "25.00",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [summary] }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...summary,
          status_detail: "accredited",
          total_paid_amount: "25.00",
          transactions: { payments: [{ id: "PAY01", status: "processed" }] },
        }),
      );

    await expect(makeProvider(fetchMock).findOrderPayment(orderRef)).resolves.toEqual({
      kind: "paid",
      amountCents: 2500,
      providerOrderId: "ORD4",
      providerPaymentId: "PAY01",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.mercadopago.com/v1/orders/ORD4");
  });

  it("não considera paga a order que a consulta completa mostra estornada", async () => {
    const summary = {
      id: "ORD4",
      status: "processed",
      external_reference: orderId,
      total_amount: "25.00",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [summary] }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...summary,
          transactions: { refunds: [{ id: "REF01", status: "processed" }] },
        }),
      );

    await expect(makeProvider(fetchMock).findOrderPayment(orderRef)).resolves.toEqual({
      kind: "none",
    });
  });

  it("recupera PIX pendente consultando a order completa quando a busca vem sem QR", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const pendingPix = {
      id: "ORD6",
      status: "action_required",
      external_reference: orderId,
      transactions: {
        payments: [
          { date_of_expiration: future, payment_method: { id: "pix", type: "bank_transfer" } },
        ],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [pendingPix] }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...pendingPix,
          transactions: {
            payments: [
              {
                date_of_expiration: future,
                payment_method: {
                  id: "pix",
                  type: "bank_transfer",
                  qr_code: "PIXCODE",
                  qr_code_base64: "QR64",
                },
              },
            ],
          },
        }),
      );

    await expect(makeProvider(fetchMock).findOrderPayment(orderRef)).resolves.toEqual({
      kind: "pending_pix",
      pix: { qrCode: "PIXCODE", qrCodeBase64: "QR64", expiresAt: future },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.mercadopago.com/v1/orders/ORD6");
  });

  it("ignora PIX expirado", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "ORD7",
            status: "action_required",
            external_reference: orderId,
            transactions: {
              payments: [
                {
                  date_of_expiration: past,
                  payment_method: {
                    id: "pix",
                    qr_code: "OLD",
                    qr_code_base64: "OLD64",
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    await expect(makeProvider(fetchMock).findOrderPayment(orderRef)).resolves.toEqual({
      kind: "none",
    });
  });

  it("ignora PIX cuja order completa mostra que já expirou", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const summary = {
      id: "ORD9",
      status: "action_required",
      external_reference: orderId,
      transactions: { payments: [{ payment_method: { id: "pix", type: "bank_transfer" } }] },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [summary] }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...summary,
          transactions: {
            payments: [
              {
                date_of_expiration: past,
                payment_method: { id: "pix", qr_code: "OLD", qr_code_base64: "OLD64" },
              },
            ],
          },
        }),
      );

    await expect(makeProvider(fetchMock).findOrderPayment(orderRef)).resolves.toEqual({
      kind: "none",
    });
  });
});

describe("MercadoPagoPaymentProvider.parseWebhook", () => {
  it("consulta a order avisada e marca como pago quando processed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ORD8",
        status: "processed",
        external_reference: orderId,
        total_amount: "0.01",
      }),
    );

    const request = new Request(
      "https://eventos.example/api/payments/webhook?data.id=ORD8&type=order",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "order.processed", type: "order", data: { id: "ORD8" } }),
      },
    );

    await expect(makeProvider(fetchMock).parseWebhook(request)).resolves.toEqual({
      kind: "paid",
      externalId: orderId,
      amountCents: 1,
      providerOrderId: "ORD8",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.mercadopago.com/v1/orders/ORD8");
  });

  it.each([
    ["processed/refunded", { status: "processed", status_detail: "refunded" }],
    ["refunded/refunded", { status: "refunded", status_detail: "refunded" }],
  ])("não trata order estornada (%s) como paga", async (_caso, state) => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: "ORD8", external_reference: orderId, total_amount: "0.01", ...state }),
    );
    const request = new Request(
      "https://eventos.example/api/payments/webhook?data.id=ORD8&type=order",
      { method: "POST", body: JSON.stringify({ type: "order", data: { id: "ORD8" } }) },
    );

    await expect(makeProvider(fetchMock).parseWebhook(request)).resolves.toEqual({
      kind: "ignored",
      externalId: orderId,
    });
  });

  it("ignora avisos que não são de order sem consultar a API", async () => {
    const fetchMock = vi.fn();
    const request = new Request("https://eventos.example/api/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: "123" } }),
    });

    await expect(makeProvider(fetchMock).parseWebhook(request)).resolves.toEqual({
      kind: "ignored",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MercadoPagoPaymentProvider.parseWebhook com chave secreta", () => {
  const secret = "segredo-de-teste";
  const url = "https://eventos.example/api/payments/webhook?data.id=ORD01ABC&type=order";
  const body = JSON.stringify({ type: "order", data: { id: "ORD01ABC" } });

  function signedRequest(signature: string, requestId = "req-123") {
    return new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-signature": signature,
      },
      body,
    });
  }

  function makeSignedProvider(fetchMock: ReturnType<typeof vi.fn>) {
    return new MercadoPagoPaymentProvider({
      accessToken: "APP_USR-TOKEN",
      webhookSecret: secret,
      fetch: fetchMock as unknown as typeof fetch,
    });
  }

  const ts = "1790804351";
  // Formato observado no aviso real de Orders: data.id como veio (maiúsculas).
  const validV1 = createHmac("sha256", secret)
    .update(`id:ORD01ABC;request-id:req-123;ts:${ts};`)
    .digest("hex");

  it("aceita assinatura no formato antigo (data.id em minúsculas)", async () => {
    const legacyV1 = createHmac("sha256", secret)
      .update(`id:ord01abc;request-id:req-123;ts:${ts};`)
      .digest("hex");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: "ORD01ABC", status: "failed", external_reference: orderId }),
    );
    await expect(
      makeSignedProvider(fetchMock).parseWebhook(signedRequest(`ts=${ts},v1=${legacyV1}`)),
    ).resolves.toEqual({ kind: "ignored", externalId: orderId });
  });

  it("aceita aviso com assinatura correta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "ORD01ABC",
        status: "processed",
        external_reference: orderId,
        total_amount: "10.00",
      }),
    );
    await expect(
      makeSignedProvider(fetchMock).parseWebhook(signedRequest(`ts=${ts},v1=${validV1}`)),
    ).resolves.toEqual({
      kind: "paid",
      externalId: orderId,
      amountCents: 1000,
      providerOrderId: "ORD01ABC",
    });
  });

  it.each([
    ["assinatura alterada", `ts=${ts},v1=${"0".repeat(64)}`, "req-123"],
    ["outro request-id", `ts=${ts},v1=${validV1}`, "req-999"],
    ["sem assinatura", "", "req-123"],
    ["formato inválido", "v1=abc", "req-123"],
  ])("recusa aviso com %s sem consultar a API", async (_caso, signature, requestId) => {
    const fetchMock = vi.fn();
    await expect(
      makeSignedProvider(fetchMock).parseWebhook(signedRequest(signature, requestId)),
    ).resolves.toEqual({ kind: "invalid_signature" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
