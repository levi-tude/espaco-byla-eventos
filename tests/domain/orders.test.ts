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
  it.each(["updated", "repaired", "noop"] as const)(
    "devolve o resultado transacional %s",
    async (outcome) => {
      const { admin, rpc } = createAdminMock([{ data: outcome, error: null }]);

      await expect(
        markOrderPaidIfPending(admin, "payment-1", "pagbank"),
      ).resolves.toBe(outcome);
      expect(rpc).toHaveBeenCalledWith("mark_order_paid_by_external", {
        p_external_id: "payment-1",
        p_provider: "pagbank",
      });
    },
  );

  it("propaga recusa por capacidade como erro operacional", async () => {
    const { admin } = createAdminMock([
      { data: "cancelled_capacity", error: null },
    ]);

    await expect(
      markOrderPaidIfPending(admin, "payment-1", "pagbank"),
    ).rejects.toThrow("capacidade");
  });

  it("cancela pedido e ingressos na mesma RPC", async () => {
    const { admin, rpc } = createAdminMock([
      { data: "updated", error: null },
    ]);

    await expect(
      cancelOrderIfPending(admin, "order-1", "pagbank"),
    ).resolves.toBe("updated");
    expect(rpc).toHaveBeenCalledWith("cancel_order_by_external", {
      p_external_id: "order-1",
      p_provider: "pagbank",
    });
  });
});
