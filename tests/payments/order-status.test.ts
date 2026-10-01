import { describe, expect, it } from "vitest";

import { classifyMercadoPagoOrder } from "@/lib/payments/order-status";

describe("classifyMercadoPagoOrder", () => {
  it.each([
    ["processed/accredited → pago", { status: "processed", status_detail: "accredited" }, "paid"],
    ["processed/refunded → estornado", { status: "processed", status_detail: "refunded" }, "refunded"],
    [
      "processed/partially_refunded → estornado",
      { status: "processed", status_detail: "partially_refunded" },
      "refunded",
    ],
    ["refunded/refunded → estornado", { status: "refunded", status_detail: "refunded" }, "refunded"],
    [
      "processed com estorno processado → estornado",
      { status: "processed", transactions: { refunds: [{ status: "processed" }] } },
      "refunded",
    ],
    [
      "processed com estorno ainda pendente → pago",
      { status: "processed", transactions: { refunds: [{ status: "in_process" }] } },
      "paid",
    ],
    [
      "PIX aguardando → pending_pix",
      {
        status: "action_required",
        transactions: { payments: [{ payment_method: { id: "pix" } }] },
      },
      "pending_pix",
    ],
    [
      "cartão em ação requerida → other",
      {
        status: "action_required",
        transactions: { payments: [{ payment_method: { id: "master" } }] },
      },
      "other",
    ],
    ["failed → failed", { status: "failed" }, "failed"],
    ["em processamento → other", { status: "processing" }, "other"],
    ["sem status → other", {}, "other"],
  ] as const)("%s", (_caso, order, expected) => {
    expect(classifyMercadoPagoOrder(order)).toBe(expected);
  });

  it("order ausente é other", () => {
    expect(classifyMercadoPagoOrder(null)).toBe("other");
    expect(classifyMercadoPagoOrder(undefined)).toBe("other");
  });
});
