import { describe, expect, it, vi } from "vitest";

import {
  markOrderPaidIfPending,
  type SupabaseAdmin,
} from "@/lib/domain/orders";

function createAdminMock() {
  const orderMaybeSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: "order-1" }, error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  const orderSelect = vi.fn(() => ({ maybeSingle: orderMaybeSingle }));
  const orderEqStatus = vi.fn(() => ({ select: orderSelect }));
  const orderEqProvider = vi.fn(() => ({ eq: orderEqStatus }));
  const orderEqExternal = vi.fn(() => ({ eq: orderEqProvider }));
  const orderUpdate = vi.fn(() => ({ eq: orderEqExternal }));

  const ticketEqStatus = vi.fn().mockResolvedValue({ error: null });
  const ticketEqOrder = vi.fn(() => ({ eq: ticketEqStatus }));
  const ticketUpdate = vi.fn(() => ({ eq: ticketEqOrder }));

  const from = vi.fn((table: string) => {
    if (table === "orders") return { update: orderUpdate };
    if (table === "tickets") return { update: ticketUpdate };
    throw new Error(`Tabela inesperada: ${table}`);
  });

  return {
    admin: { from } as unknown as SupabaseAdmin,
    orderUpdate,
    ticketUpdate,
  };
}

describe("markOrderPaidIfPending", () => {
  it("marca pedido e ingressos apenas na primeira confirmação", async () => {
    const { admin, orderUpdate, ticketUpdate } = createAdminMock();

    await expect(
      markOrderPaidIfPending(admin, "payment-1", "pagbank"),
    ).resolves.toBe("updated");
    await expect(
      markOrderPaidIfPending(admin, "payment-1", "pagbank"),
    ).resolves.toBe("noop");

    expect(orderUpdate).toHaveBeenCalledTimes(2);
    expect(ticketUpdate).toHaveBeenCalledTimes(1);
    expect(ticketUpdate).toHaveBeenCalledWith({ status: "pago" });
  });
});
