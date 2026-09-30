import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markOrderPaidIfPending: vi.fn(),
  sendTicketsEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/domain/orders", () => ({
  markOrderPaidIfPending: mocks.markOrderPaidIfPending,
}));
vi.mock("@/lib/email/send-tickets", () => ({
  sendTicketsEmail: mocks.sendTicketsEmail,
}));

import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import type { SupabaseAdmin } from "@/lib/domain/orders";

const orderId = "00000000-0000-4000-8000-000000000010";

function adminWithOrderTotal(totalCents: number | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: totalCents === null ? null : { total_cents: totalCents },
      error: null,
    }),
  };
  return { from: () => chain } as unknown as SupabaseAdmin;
}

describe("confirmOrderPaid confere o valor pago", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markOrderPaidIfPending.mockResolvedValue("noop");
  });

  it("confirma quando o valor pago é igual ao total do pedido", async () => {
    await confirmOrderPaid(adminWithOrderTotal(5000), orderId, "mercadopago", 5000);
    expect(mocks.markOrderPaidIfPending).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
    );
  });

  it.each([
    ["valor menor", 100],
    ["valor maior", 9000],
    ["valor desconhecido", null],
  ])("não marca como pago com %s", async (_caso, paid) => {
    await expect(
      confirmOrderPaid(adminWithOrderTotal(5000), orderId, "mercadopago", paid),
    ).rejects.toThrow("Valor pago não confere");
    expect(mocks.markOrderPaidIfPending).not.toHaveBeenCalled();
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
  });

  it("não marca como pago se o pedido não existe", async () => {
    await expect(
      confirmOrderPaid(adminWithOrderTotal(null), orderId, "mercadopago", 5000),
    ).rejects.toThrow("Valor pago não confere");
    expect(mocks.markOrderPaidIfPending).not.toHaveBeenCalled();
  });
});
