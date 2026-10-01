import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseWebhook: vi.fn(),
  confirmOrderPaid: vi.fn(),
  syncOrderRefunded: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago", parseWebhook: mocks.parseWebhook }),
}));
vi.mock("@/lib/payments/confirm-order", () => ({ confirmOrderPaid: mocks.confirmOrderPaid }));
vi.mock("@/lib/payments/refund", () => ({ syncOrderRefunded: mocks.syncOrderRefunded }));

import { POST } from "@/app/api/payments/webhook/route";

const orderId = "00000000-0000-4000-8000-000000000010";

function webhookRequest() {
  return new Request("https://eventos.example/api/payments/webhook?data.id=ORD1&type=order", {
    method: "POST",
    body: JSON.stringify({ type: "order", data: { id: "ORD1" } }),
  });
}

describe("POST /api/payments/webhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aviso de estorno registra o estorno e nunca confirma pagamento", async () => {
    mocks.parseWebhook.mockResolvedValue({
      kind: "refunded",
      externalId: orderId,
      providerOrderId: "ORD1",
    });
    mocks.syncOrderRefunded.mockResolvedValue("completed");

    const response = await POST(webhookRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "completed" });
    expect(mocks.syncOrderRefunded).toHaveBeenCalledWith({}, orderId, "mercadopago", "ORD1");
    expect(mocks.confirmOrderPaid).not.toHaveBeenCalled();
  });

  it("aviso de pagamento segue para a confirmação", async () => {
    mocks.parseWebhook.mockResolvedValue({
      kind: "paid",
      externalId: orderId,
      amountCents: 5000,
      providerOrderId: "ORD1",
    });
    mocks.confirmOrderPaid.mockResolvedValue("updated");

    await POST(webhookRequest());
    expect(mocks.confirmOrderPaid).toHaveBeenCalled();
    expect(mocks.syncOrderRefunded).not.toHaveBeenCalled();
  });

  it("assinatura inválida é recusada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.parseWebhook.mockResolvedValue({ kind: "invalid_signature" });
    const response = await POST(webhookRequest());
    expect(response.status).toBe(401);
    expect(mocks.syncOrderRefunded).not.toHaveBeenCalled();
  });
});
