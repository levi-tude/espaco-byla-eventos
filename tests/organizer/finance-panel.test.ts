import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrganizerFinancePanel } from "@/components/organizer/OrganizerFinancePanel";
import type { OrganizerEventFinance } from "@/lib/organizer/finance";

const finance = (o: Partial<OrganizerEventFinance> = {}): OrganizerEventFinance => ({
  viewer: "dono",
  eventId: "e1",
  eventName: "Show",
  organizerPublicName: "Produtora",
  today: "2026-10-26",
  startDate: "2026-10-24",
  dueDate: "2026-10-30",
  calendarUntil: 2030,
  soldCents: 50000,
  soldOrders: 10,
  refundedCents: 5000,
  refundedOrders: 1,
  contestedCents: 0,
  contestedOrders: 0,
  bankFeeCents: 1095,
  pendingFeeOrders: 0,
  pendingCents: 0,
  shareCents: 45000,
  paidOutCents: 0,
  balanceCents: 45000,
  decisionOrders: 0,
  serviceFeeCents: 2250,
  flag: null,
  history: [],
  lateChanges: [],
  pix: {
    type: "email",
    masked: "•••@exemplo.com",
    holderName: "Titular Teste",
    documentMasked: "•••.982.247-••",
    changedAt: null,
    changePending: false,
  },
  team: null,
  ...o,
});

const html = (f: OrganizerEventFinance, refundPixKey: string | null = null) =>
  renderToStaticMarkup(createElement(OrganizerFinancePanel, { finance: f, refundPixKey }))
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, "|");

describe("OrganizerFinancePanel", () => {
  it("exemplo da spec: contas, situação e taxa de serviço fora da parte", () => {
    const text = html(finance());
    for (const piece of [
      "Vendido (10 pedidos)||R$ 500,00",
      "Estornos (1)||−R$ 50,00",
      "Sua parte||R$ 450,00",
      "Já repassado||R$ 0,00",
      "A receber||R$ 450,00",
      "Em conferência — previsto até 30/10",
      "A tarifa do banco de pagamento sai da taxa de serviço, não da sua parte.",
      "A taxa de serviço paga pelos compradores (R$ 22,50) também não entra na sua parte.",
      "Repasse para: e-mail |•••@exemplo.com",
    ]) {
      expect(text).toContain(piece);
    }
    expect(text).not.toContain("Em conferência (");
    expect(text).not.toContain("−R$ 10,95");
  });

  it("pedido sem tarifa não reduz a parte nem aparece como valor em conferência", () => {
    const text = html(finance({ pendingFeeOrders: 2, pendingCents: 10000 }));
    expect(text).not.toContain("Em conferência (");
    expect(text).toContain("Sua parte||R$ 450,00");
    expect(text).toContain("A tarifa do banco de pagamento sai da taxa de serviço, não da sua parte.");
  });

  it("histórico com data do PIX e valor, sem quem registrou", () => {
    const text = html(finance({
      paidOutCents: 43905,
      balanceCents: 0,
      history: [{ payoutId: "p1", kind: "repasse", itemCents: 43905, payoutCents: 43905, pixDate: "2026-10-29",
        createdAt: "2026-10-29T15:00:00Z", note: null, reason: null, createdByName: "Admin Secreto" }],
    }));
    expect(text).toContain("Repasse de R$ 439,05");
    expect(text).toContain("PIX em 29/10/2026");
    expect(text).toContain("Pago em 29/10 · R$ 439,05");
    expect(text).not.toContain("Admin Secreto");
  });

  it("devolução pendente mostra a chave do Espaço ou pede para falar com o Espaço", () => {
    const owing = finance({ balanceCents: -4739, flag: { negativeSince: "2026-10-30", returnDueDate: "2026-12-09" } });
    expect(html(owing, "chave-do-espaco@exemplo.com")).toContain("chave-do-espaco@exemplo.com");
    expect(html(owing)).toContain("Fale com o Espaço Byla para receber a chave PIX.");
    expect(html(finance())).not.toContain("Devolução ao Espaço Byla");
  });

  it("mudanças depois do repasse", () => {
    const text = html(finance({
      lateChanges: [{ orderId: "o1", orderNumber: "1234ABCD", kind: "estorno", cents: 5000, at: "2026-11-05T15:00:00Z" }],
    }));
    expect(text).toContain("Estorno do pedido Nº 1234ABCD em 05/11 (−R$ 50,00)");
  });

  it("nunca mostra documento do titular", () => {
    expect(html(finance())).not.toContain("982.247");
  });
});
