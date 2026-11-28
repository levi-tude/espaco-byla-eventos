import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));

import { EventReportScreen } from "@/components/reports/EventReportScreen";
import { buildReportView, type EventReport, type OrganizerFinance, type ReportSession } from "@/lib/reports/model";

function session(): ReportSession {
  return {
    id: "s17",
    name: null,
    startsAt: "2026-11-28T20:00:00Z",
    endsAt: "2026-11-28T21:00:00Z",
    status: "ativa",
    capacity: 70,
    occupied: 42,
    training: 1,
    present: 0,
    presentTraining: 0,
    noShow: null,
    noShowTraining: null,
    buckets: { inteira: 7, casadinha: 10, familia: 0, meia: 20, bonus: 5, capacitacao: 1 },
    casadinhaUnits: 5,
    familiaUnits: 0,
    heldTickets: 0,
    pendingActiveOrders: 0,
    pendingExpiredOrders: 2,
    pendingExpiredTickets: 2,
    cancelledTickets: 0,
    refundedTickets: 0,
    refundsOpen: 0,
    refundsDone: 1,
    meia: { ok: 0, diff: 0, refused: 0, unmarked: 0 },
    payments: { pix: 10, card: 2, other: 0, bonus: 1 },
    daily: [],
    arrival: [],
  };
}

const report: EventReport = { generatedAt: "2026-11-28T15:30:00Z", live: true, sessions: [session()] };

const organizer: OrganizerFinance = {
  ticketsSoldCents: 237_500,
  refundedCents: 2_500,
  refundedOrders: 1,
  youReceiveCents: 235_000,
  serviceFeeCents: 14_971,
  clientPaidCents: 249_971,
  paidOutCents: 0,
  balanceCents: 235_000,
  payoutDueDate: null,
  contestedOrders: 0,
  contestedCents: 0,
  sessions: [{ id: "s17", ticketCents: 127_500 }],
  daily: [],
};

describe("tela do relatório", () => {
  it("a do organizador não mostra tarifa do provedor nem taxa líquida", () => {
    const view = buildReportView({
      money: "simple",
      report,
      admin: null,
      organizer,
      sessionId: null,
      sessionLabels: new Map([["s17", "17h"]]),
    });
    const html = renderToStaticMarkup(
      createElement(EventReportScreen, {
        eventName: "Cápsulas do Tempo",
        whenLabel: "Sábado, 28 de novembro",
        view,
        updatedLabel: "12h30",
        sessionLinks: [],
        csvHref: "/csv",
        printHref: "/imprimir",
        backHref: "/voltar",
        backLabel: "Voltar",
      }),
    );
    expect(html).toContain("Você recebe");
    expect(html).toContain("não sai da sua parte");
    expect(html).toContain("fora da lotação");
    expect(html).not.toMatch(/tarifa do provedor|taxa líquida/i);
    expect(html).not.toMatch(/buyer_|@teste|public_token/i);
  });
});
