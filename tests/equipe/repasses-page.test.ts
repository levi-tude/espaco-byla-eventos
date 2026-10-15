import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/equipe/repasses/actions", () => ({
  loadPayoutDetails: vi.fn(),
  markOrganizerPaid: vi.fn(),
  addOrganizerAdjustment: vi.fn(),
  markRefundReceived: vi.fn(),
  loadPendingFees: vi.fn(),
  setManualFee: vi.fn(),
  setEventFeeTotal: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { EventOrganizerPayout } from "@/components/equipe/EventOrganizerPayout";
import { type OrganizerEventFinance, overviewSituation, type PayoutsOverviewEvent } from "@/lib/organizer/finance";

const finance = (o: Partial<OrganizerEventFinance> = {}): OrganizerEventFinance => ({
  viewer: "admin",
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
  shareCents: 43905,
  paidOutCents: 0,
  balanceCents: 43905,
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
  team: { organizerId: "o1", releaseUntil: null, pixChangedRecently: false },
  ...o,
});

const html = (f: OrganizerEventFinance | null, canWrite = true) =>
  renderToStaticMarkup(
    createElement(EventOrganizerPayout, { id: "organizador", eventName: "Show", finance: f, canWrite }),
  )
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, "|");

describe("bloco Organizador na página do evento", () => {
  it("mostra a situação, os valores e o botão de repasse para o Admin do Espaço", () => {
    const text = html(finance());
    expect(text).toContain("A pagar até 30/10");
    expect(text).toContain("Parte do organizador||R$ 439,05");
    expect(text).toContain("Marcar repasse");
    expect(text).toContain("Lançar ajuste");
    expect(text).not.toContain("Lançar tarifa do extrato");
  });

  it("conta do desenvolvedor só vê", () => {
    const text = html(finance(), false);
    expect(text).toContain("A pagar até 30/10");
    expect(text).not.toContain("Marcar repasse");
    expect(text).not.toContain("Lançar ajuste");
  });

  it("troca de chave pendente esconde o botão de repasse", () => {
    const text = html(finance({ pix: { ...finance().pix, changePending: true } }));
    expect(text).toContain("Troca de chave PIX aguardando decisão");
    expect(text).not.toContain("Marcar repasse");
  });

  it("tarifa pendente oferece o lançamento do extrato", () => {
    const text = html(finance({ pendingFeeOrders: 2, balanceCents: 0, shareCents: 0 }));
    expect(text).toContain("Conferindo a tarifa do banco de 2 pedidos");
    expect(text).toContain("Lançar tarifa do extrato");
    expect(text).not.toContain("Marcar repasse");
  });

  it("evento em andamento não tem ações", () => {
    const text = html(finance({ today: "2026-10-20" }));
    expect(text).not.toContain("Marcar repasse");
    expect(text).not.toContain("Lançar ajuste");
  });

  it("falha ao carregar mostra aviso", () => {
    expect(html(null)).toContain("Não foi possível carregar o repasse do organizador");
  });

  it("nunca mostra a chave nem o documento completos", () => {
    const text = html(finance());
    expect(text).not.toContain("52998224725");
    expect(text).not.toContain("@exemplo.com");
  });
});

describe("overviewSituation", () => {
  const row = (o: Partial<PayoutsOverviewEvent> = {}): PayoutsOverviewEvent => {
    const omit = new Set(["viewer", "history", "lateChanges", "pix", "team", "today", "calendarUntil"]);
    const rest = Object.fromEntries(Object.entries(finance()).filter(([key]) => !omit.has(key)));
    return {
      ...(rest as Omit<PayoutsOverviewEvent, "organizerId" | "organizerStatus" | "status" | "lastPayoutAt" | "pixChangePending">),
      organizerId: "o1",
      organizerStatus: "ativo",
      status: "a_pagar",
      lastPayoutAt: null,
      pixChangePending: false,
      ...o,
    };
  };

  it("usa a data do último repasse para 'Pago'", () => {
    expect(overviewSituation(row({ balanceCents: 0, paidOutCents: 43905, lastPayoutAt: "2026-10-28" }), "2026-10-29"))
      .toEqual({ kind: "pago", paidAt: "2026-10-28", paidCents: 43905 });
  });

  it("atrasado depois do prazo", () => {
    expect(overviewSituation(row(), "2026-10-31").kind).toBe("atrasado");
  });
});
