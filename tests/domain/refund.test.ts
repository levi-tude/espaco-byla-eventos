import { describe, expect, it } from "vitest";

import {
  normalizeRefundReason,
  refundBlock,
  refundBlockMessage,
  refundRejectionMessage,
} from "@/lib/domain/refund";

const now = Date.parse("2026-10-01T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

describe("refundBlock", () => {
  it("pedido pago pelo Mercado Pago, sem check-in e no prazo pode estornar", () => {
    expect(
      refundBlock({ paymentProvider: "mercadopago", paidAt: daysAgo(10), hasCheckIn: false, now }),
    ).toBeNull();
  });

  it("qualquer ingresso com check-in bloqueia", () => {
    const block = refundBlock({
      paymentProvider: "mercadopago",
      paidAt: daysAgo(1),
      hasCheckIn: true,
      now,
    });
    expect(block).toBe("check_in");
    expect(refundBlockMessage(block!)).toBe(
      "Não é possível estornar: há ingresso com entrada registrada.",
    );
  });

  it.each(["cortesia_interna", "pagbank", null])("provedor %s não estorna pelo site", (provider) => {
    expect(
      refundBlock({ paymentProvider: provider, paidAt: daysAgo(1), hasCheckIn: false, now }),
    ).toBe("provedor");
  });

  it("depois de 180 dias mostra o prazo encerrado", () => {
    expect(
      refundBlock({ paymentProvider: "mercadopago", paidAt: daysAgo(181), hasCheckIn: false, now }),
    ).toBe("prazo");
    expect(
      refundBlock({ paymentProvider: "mercadopago", paidAt: daysAgo(179), hasCheckIn: false, now }),
    ).toBeNull();
  });
});

describe("normalizeRefundReason", () => {
  it.each([["", null], ["abcd", null], ["  abcd  ", null], [123, null], [null, null]])(
    "recusa motivo inválido (%s)",
    (reason, expected) => {
      expect(normalizeRefundReason(reason)).toBe(expected);
    },
  );

  it("aceita de 5 a 500 caracteres, sem espaços nas pontas", () => {
    expect(normalizeRefundReason("  Pedido duplicado ")).toBe("Pedido duplicado");
    expect(normalizeRefundReason("a".repeat(500))).toHaveLength(500);
    expect(normalizeRefundReason("a".repeat(501))).toBeNull();
  });
});

describe("refundRejectionMessage", () => {
  it("explica saldo insuficiente", () => {
    expect(refundRejectionMessage("insufficient_money_for_refund")).toMatch(/saldo insuficiente/);
  });

  it("código desconhecido vira mensagem genérica, sem detalhe técnico", () => {
    const message = refundRejectionMessage("http_418");
    expect(message).not.toContain("http_418");
    expect(message).toMatch(/recusou o estorno/);
  });
});
