import { describe, expect, it, vi } from "vitest";

import {
  cancelOrderIfPending,
  markOrderPaidIfPending,
  type SupabaseAdmin,
} from "@/lib/domain/orders";

function createAdminMock(results: Array<{ data: string | null; error: unknown }>) {
  const rpc = vi.fn();
  for (const result of results) rpc.mockResolvedValueOnce(result);
  return {
    admin: { rpc } as unknown as SupabaseAdmin,
    rpc,
  };
}

describe("markOrderPaidIfPending", () => {
  it.each([
    "updated",
    "repaired",
    "noop",
    "needs_decision_capacity",
    "needs_decision_cancelled",
  ] as const)("devolve o resultado transacional %s", async (outcome) => {
    const { admin, rpc } = createAdminMock([{ data: outcome, error: null }]);

    await expect(
      markOrderPaidIfPending(admin, "payment-1", "mercadopago"),
    ).resolves.toBe(outcome);
    expect(rpc).toHaveBeenCalledWith("mark_order_paid_by_external", {
      p_external_id: "payment-1",
      p_provider: "mercadopago",
      p_provider_order_id: null,
      p_provider_payment_id: null,
    });
  });

  it("repassa os IDs do Mercado Pago para o banco", async () => {
    const { admin, rpc } = createAdminMock([{ data: "updated", error: null }]);

    await markOrderPaidIfPending(admin, "order-1", "mercadopago", {
      providerOrderId: "ORD01",
      providerPaymentId: "PAY01",
    });
    expect(rpc).toHaveBeenCalledWith("mark_order_paid_by_external", {
      p_external_id: "order-1",
      p_provider: "mercadopago",
      p_provider_order_id: "ORD01",
      p_provider_payment_id: "PAY01",
    });
  });

  it.each(["cancelled_capacity", "qualquer", null])(
    "trata resposta desconhecida (%s) como erro",
    async (data) => {
      const { admin } = createAdminMock([{ data, error: null }]);

      await expect(
        markOrderPaidIfPending(admin, "payment-1", "mercadopago"),
      ).rejects.toThrow("Resposta inválida");
    },
  );

  it("cancela pedido e ingressos na mesma RPC", async () => {
    const { admin, rpc } = createAdminMock([
      { data: "updated", error: null },
    ]);

    await expect(
      cancelOrderIfPending(admin, "order-1", "mercadopago"),
    ).resolves.toBe("updated");
    expect(rpc).toHaveBeenCalledWith("cancel_order_by_external", {
      p_external_id: "order-1",
      p_provider: "mercadopago",
    });
  });
});
