import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildReportView, type AdminFinance, type EventReport, type OrganizerFinance, type ReportSession } from "@/lib/reports/model";
import {
  buildRetrospective,
  stepStory,
  storyAutoplayMs,
  storyTapZone,
} from "@/lib/reports/retrospective";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return [full];
  });
}

function session(partial: Partial<ReportSession> & Pick<ReportSession, "id">): ReportSession {
  return {
    name: null,
    startsAt: "2026-11-28T20:00:00Z",
    endsAt: "2026-11-28T22:00:00Z",
    status: "ativa",
    capacity: 70,
    occupied: 42,
    training: 1,
    present: 30,
    presentTraining: 0,
    noShow: 12,
    noShowTraining: 1,
    buckets: { inteira: 7, casadinha: 10, familia: 0, meia: 20, bonus: 5, capacitacao: 1 },
    casadinhaUnits: 5,
    familiaUnits: 0,
    heldTickets: 0,
    pendingActiveOrders: 0,
    pendingExpiredOrders: 2,
    pendingExpiredTickets: 2,
    cancelledTickets: 0,
    refundedTickets: 1,
    refundsOpen: 0,
    refundsDone: 1,
    meia: { ok: 18, diff: 1, refused: 1, unmarked: 0 },
    payments: { pix: 20, card: 2, other: 0, bonus: 5 },
    daily: [],
    arrival: [{ label: "17:00", count: 12 }, { label: "17:10", count: 8 }],
    ...partial,
  };
}

const report: EventReport = {
  generatedAt: "2026-11-28T15:30:00Z",
  live: false,
  sessions: [
    session({ id: "s17" }),
    session({
      id: "s19",
      startsAt: "2026-11-28T22:00:00Z",
      occupied: 36,
      training: 3,
      present: 20,
      buckets: { inteira: 2, casadinha: 10, familia: 0, meia: 20, bonus: 4, capacitacao: 3 },
      casadinhaUnits: 5,
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
    { id: "s17", ticketCents: 127_500, pendingActiveCents: 0, pendingExpiredCents: 0 },
    { id: "s19", ticketCents: 107_500, pendingActiveCents: 0, pendingExpiredCents: 0 },
  ],
  daily: [
    { day: "2026-10-17", ticketCents: 20_000 },
    { day: "2026-11-21", ticketCents: 180_000 },
    { day: "2026-11-28", ticketCents: 35_000 },
  ],
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
  daily: admin.daily,
};

const labels = new Map([
  ["s17", "17h"],
  ["s19", "19h"],
]);

function textOf(slides: { title: string; hero: string | null; lines: { label: string; value: string }[]; note: string | null }[]) {
  return JSON.stringify(slides);
}

describe("retrospectiva usa o relatório e respeita o papel", () => {
  it("conta a história inteira e aponta o pico de vendas", () => {
    const view = buildReportView({ money: "full", report, admin, organizer: null, sessionId: null, sessionLabels: labels });
    const slides = buildRetrospective({ eventName: "Cápsulas do Tempo", whenLabel: "28/11", view });
    expect(slides.map((slide) => slide.id)).toEqual([
      "abertura",
      "vendas",
      "ritmo",
      "pico",
      "sessoes",
      "tipos",
      "extras",
      "dia",
      "financeiro",
      "estornos",
      "resumo",
    ]);
    const pico = slides.find((slide) => slide.id === "pico");
    expect(pico?.title).toMatch(/21\/11/);
    expect(textOf(slides)).toMatch(/tarifa do provedor/i);
    expect(textOf(slides)).toMatch(/líquida/i);
    expect(textOf(slides)).toMatch(/capacitação/i);
    expect(textOf(slides)).toMatch(/casadinha/i);
    expect(textOf(slides)).not.toMatch(/buyer_|public_token|@|telefone|e-mail/i);
  });

  it("organizador vê o financeiro simples e não vê tarifa nem taxa líquida", () => {
    const view = buildReportView({
      money: "simple",
      report,
      admin: null,
      organizer,
      sessionId: null,
      sessionLabels: labels,
    });
    const slides = buildRetrospective({ eventName: "Cápsulas do Tempo", whenLabel: "28/11", view });
    expect(slides.some((slide) => slide.id === "financeiro")).toBe(true);
    const blob = textOf(slides);
    expect(blob).toMatch(/Você recebe/);
    expect(blob).toMatch(/não sai da sua parte/);
    expect(blob).not.toMatch(/tarifa do provedor|taxa líquida|líquida/i);
  });

  it("secretaria não vê valores em dinheiro", () => {
    const view = buildReportView({ money: "none", report, admin: null, organizer: null, sessionId: null, sessionLabels: labels });
    const slides = buildRetrospective({ eventName: "Cápsulas do Tempo", whenLabel: "28/11", view });
    expect(slides.some((slide) => slide.id === "financeiro")).toBe(false);
    expect(textOf(slides)).not.toMatch(/R\$/);
  });
});

describe("navegação no estilo stories", () => {
  it("avança, volta e fecha no fim", () => {
    expect(stepStory(0, 3, -1)).toEqual({ index: 0, close: false });
    expect(stepStory(1, 3, 1)).toEqual({ index: 2, close: false });
    expect(stepStory(2, 3, 1)).toEqual({ index: 2, close: true });
  });

  it("toque na esquerda volta e na direita avança", () => {
    expect(storyTapZone(0.1)).toBe("prev");
    expect(storyTapZone(0.8)).toBe("next");
  });

  it("com movimento reduzido não avança sozinho", () => {
    expect(storyAutoplayMs(false)).toBeGreaterThan(0);
    expect(storyAutoplayMs(true)).toBeNull();
  });
});

describe("acesso da retrospectiva", () => {
  it("não tem página nem endereço próprio", () => {
    const routes = walk(join(ROOT, "src", "app")).filter((file) => /\/(page|route)\.tsx?$/.test(file));
    expect(routes.filter((file) => /retrospect/i.test(file))).toEqual([]);
    const players = walk(join(ROOT, "src")).filter((file) => readFileSync(file, "utf8").includes("buildRetrospective"));
    expect(players.every((file) => file.includes(`${join("src", "lib", "reports")}`) || file.includes(`${join("src", "components", "reports")}`))).toBe(true);
  });

  it("o relatório só renderiza depois da checagem de quem está logado", () => {
    const organizer = readFileSync(join(ROOT, "src/app/organizador/eventos/[id]/relatorio/page.tsx"), "utf8");
    const team = readFileSync(join(ROOT, "src/app/equipe/eventos/[id]/relatorio/page.tsx"), "utf8");
    const organizerCsv = readFileSync(join(ROOT, "src/app/organizador/eventos/[id]/relatorio/csv/route.ts"), "utf8");
    const teamCsv = readFileSync(join(ROOT, "src/app/equipe/eventos/[id]/relatorio/csv/route.ts"), "utf8");
    expect(organizer.indexOf('access?.access !== "dono"')).toBeLessThan(organizer.indexOf("<ReportDocument"));
    expect(organizer.indexOf("event.organizer_id !== actor.userId")).toBeLessThan(organizer.indexOf("<ReportDocument"));
    expect(organizer.indexOf('actor?.kind !== "organizador"')).toBeLessThan(organizer.indexOf("<ReportDocument"));
    expect(team.indexOf("requireStaffUser")).toBeLessThan(team.indexOf("<ReportDocument"));
    expect(organizerCsv).toContain('actor?.kind !== "organizador"');
    expect(organizerCsv).toContain('access?.access !== "dono"');
    expect(teamCsv).toContain("requireStaffUser");
    const player = readFileSync(join(ROOT, "src/components/reports/Retrospective.tsx"), "utf8");
    expect(player).not.toMatch(/rpc\(|fetch\(|supabase|href=/);
    expect(player).toContain('type="button"');
  });
});
