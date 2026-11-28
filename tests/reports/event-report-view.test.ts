import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/domain/service-fee";
import { buildEventReportCsv } from "@/lib/reports/csv";
import {
  buildReportView,
  parseAdminFinance,
  parseEventReport,
  parseOrganizerFinance,
  type AdminFinance,
  type EventReport,
  type OrganizerFinance,
  type ReportSession,
} from "@/lib/reports/model";

function session(partial: Partial<ReportSession> & Pick<ReportSession, "id" | "startsAt">): ReportSession {
  return {
    name: null,
    endsAt: "2026-11-28T22:00:00Z",
    status: "ativa",
    capacity: 70,
    occupied: 0,
    training: 0,
    present: 0,
    presentTraining: 0,
    noShow: null,
    noShowTraining: null,
    buckets: { inteira: 0, casadinha: 0, familia: 0, meia: 0, bonus: 0, capacitacao: 0 },
    casadinhaUnits: 0,
    familiaUnits: 0,
    heldTickets: 0,
    pendingActiveOrders: 0,
    pendingExpiredOrders: 0,
    pendingExpiredTickets: 0,
    cancelledTickets: 0,
    refundedTickets: 0,
    refundsOpen: 0,
    refundsDone: 0,
    meia: { ok: 0, diff: 0, refused: 0, unmarked: 0 },
    payments: { pix: 0, card: 0, other: 0, bonus: 0 },
    daily: [],
    arrival: [],
    ...partial,
  };
}

const report: EventReport = {
  generatedAt: "2026-11-28T15:30:00Z",
  live: true,
  sessions: [
    session({
      id: "s17",
      startsAt: "2026-11-28T20:00:00Z",
      occupied: 42,
      training: 1,
      capacity: 70,
      buckets: { inteira: 7, casadinha: 10, familia: 0, meia: 20, bonus: 5, capacitacao: 1 },
      casadinhaUnits: 5,
      pendingExpiredOrders: 2,
      payments: { pix: 20, card: 2, other: 0, bonus: 5 },
    }),
    session({
      id: "s19",
      startsAt: "2026-11-28T22:00:00Z",
      occupied: 36,
      training: 3,
      capacity: 70,
      buckets: { inteira: 2, casadinha: 10, familia: 0, meia: 20, bonus: 4, capacitacao: 3 },
      casadinhaUnits: 5,
      pendingExpiredOrders: 17,
      payments: { pix: 18, card: 2, other: 1, bonus: 5 },
    }),
  ],
};

const admin: AdminFinance = {
  clientPaidCents: 249_971,
  organizerCents: 235_000,
  grossFeeCents: 14_971,
  providerFeeCents: 4_406,
  netFeeCents: 10_565,
  feesPendingOrders: 0,
  organizerSoldCents: 237_500,
  organizerRefundedCents: 2_500,
  refundedOrders: 1,
  refundedClientCents: 2_639,
  refundedFeeCents: 139,
  providerFeeOnRefundsCents: 26,
  refundsChecked: 1,
  contestedOrders: 0,
  contestedCents: 0,
  payingOrders: 43,
  payingPeople: 73,
  organizerPaidOutCents: 0,
  organizerBalanceCents: 235_000,
  feePaidOutCents: 0,
  feeBalanceCents: 10_565,
  payoutDueDate: "2026-12-04",
  feeDueDate: "2026-11-29",
  sessions: [
    { id: "s17", ticketCents: 127_500, pendingActiveCents: 0, pendingExpiredCents: 10_000 },
    { id: "s19", ticketCents: 107_500, pendingActiveCents: 0, pendingExpiredCents: 54_000 },
  ],
  daily: [{ day: "2026-11-28", ticketCents: 235_000 }],
};

const organizer: OrganizerFinance = {
  ticketsSoldCents: 237_500,
  refundedCents: 2_500,
  refundedOrders: 1,
  youReceiveCents: 235_000,
  serviceFeeCents: 14_971,
  clientPaidCents: 249_971,
  paidOutCents: 0,
  balanceCents: 235_000,
  payoutDueDate: "2026-12-04",
  contestedOrders: 0,
  contestedCents: 0,
  sessions: [
    { id: "s17", ticketCents: 127_500 },
    { id: "s19", ticketCents: 107_500 },
  ],
  daily: [{ day: "2026-11-28", ticketCents: 235_000 }],
};

const labels = new Map([
  ["s17", "17h00"],
  ["s19", "19h00"],
]);

describe("visão do relatório", () => {
  it("a equipe admin vê a conta que fecha e a capacitação fora da lotação", () => {
    const view = buildReportView({ money: "full", report, admin, organizer: null, sessionId: null, sessionLabels: labels });
    expect(view.cards.find((card) => card.label === "Lotação")?.value).toBe("78 / 140");
    expect(view.cards.find((card) => card.label === "Ingressos válidos")?.hint).toContain("4 capacitação");
    expect(view.cards.find((card) => card.label === "O cliente pagou")?.value).toBe(formatMoney(249_971));
    expect(view.cards.find((card) => card.label === "Taxa de serviço líquida")?.value).toBe(formatMoney(10_565));
    expect(view.split?.organizerCents).toBe(235_000);
    expect(view.split?.netCents).toBe(10_565);
    expect(view.split?.providerCents).toBe(4_406);
    expect(view.financeCloses).toBe(true);
    expect(view.typeNote).toContain("10 un.");
    expect(view.typeNote).toContain("20 pessoas");
    expect(view.sessions[0]?.training).toBe(1);
    expect(view.sessions[0]?.occupied).toBe(42);
  });

  it("secretaria vê quantidade e não vê dinheiro", () => {
    const view = buildReportView({ money: "none", report, admin: null, organizer: null, sessionId: null, sessionLabels: labels });
    expect(view.cards.map((card) => card.label)).toEqual(["Lotação", "Ingressos válidos", "Pendentes"]);
    expect(view.showSplit).toBe(false);
    expect(view.simpleLines).toEqual([]);
    expect(view.refundMode).toBe("count");
    expect(JSON.stringify(view)).not.toMatch(/2\.499,71|tarifa do provedor|taxa líquida/i);
  });

  it("organizador vê o financeiro simples e não vê tarifa nem taxa líquida", () => {
    const leaked = parseOrganizerFinance({
      ...{
        tickets_sold_cents: 237500,
        refunded_cents: 2500,
        refunded_orders: 1,
        you_receive_cents: 235000,
        service_fee_cents: 14971,
        client_paid_cents: 249971,
        paid_out_cents: 0,
        balance_cents: 235000,
        payout_due_date: "2026-12-04",
        contested_orders: 0,
        contested_cents: 0,
        sessions: [],
        daily: [],
      },
      provider_fee_cents: 4406,
      net_fee_cents: 10565,
      gross_fee_cents: 14971,
    });
    expect(leaked && "providerFeeCents" in leaked).toBe(false);
    expect(JSON.stringify(leaked)).not.toContain("4406");

    const view = buildReportView({
      money: "simple",
      report,
      admin: null,
      organizer,
      sessionId: null,
      sessionLabels: labels,
    });
    expect(view.simpleLines.map((line) => line.label)).toEqual([
      "Ingressos vendidos",
      "Estornos (1 pedido)",
      "Você recebe",
      "Taxa de serviço (paga pelo cliente)",
      "O cliente pagou",
    ]);
    expect(view.showSplit).toBe(false);
    expect(view.payments).toBeNull();
    expect(view.simpleNote).toMatch(/não sai da sua parte/);
    const blob = JSON.stringify(view);
    expect(blob).not.toMatch(/tarifa do provedor|taxa líquida|líquida/i);
    expect(buildEventReportCsv(view, "Cápsulas do Tempo")).not.toMatch(/tarifa|líquida|e-mail|telefone|@/i);
  });

  it("a planilha do admin traz as três fatias e nenhum dado de comprador", () => {
    const view = buildReportView({ money: "full", report, admin, organizer: null, sessionId: null, sessionLabels: labels });
    const csv = buildEventReportCsv(view, "Cápsulas do Tempo");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Taxa de serviço bruta (R$)");
    expect(csv).toContain("Tarifa do provedor (R$)");
    expect(csv).toContain("Taxa líquida (R$)");
    expect(csv).toContain("2499,71");
    expect(csv).toContain("105,65");
    expect(csv).not.toMatch(/buyer_|public_token|telefone/i);
  });

  it("lê o JSON do banco", () => {
    expect(parseEventReport({ generated_at: "2026-11-28T15:30:00Z", live: true, sessions: [] })?.live).toBe(true);
    expect(parseEventReport({})).toBeNull();
    expect(parseAdminFinance({ client_paid_cents: "249971", organizer_cents: 235000 })?.clientPaidCents).toBe(249971);
  });
});
