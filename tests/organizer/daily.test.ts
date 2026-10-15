import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  notifyOrganizer: vi.fn(),
  notifyTeam: vi.fn(),
  alertTeamSetup: vi.fn(),
  tryConsumeRateLimit: vi.fn(),
  releaseRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  notifyTeam: mocks.notifyTeam,
  organizerNoticeLink: (path: string) => `https://site.example${path}`,
}));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeamSetup: mocks.alertTeamSetup }));
vi.mock("@/lib/security/rate-limit", () => ({
  tryConsumeRateLimit: mocks.tryConsumeRateLimit,
  releaseRateLimit: mocks.releaseRateLimit,
}));

import { runOrganizerFinanceDaily, summaryToSend } from "@/lib/organizer/daily";

const organizerId = "00000000-0000-4000-8000-0000000000aa";
const eventId = "00000000-0000-4000-8000-000000000001";
const flagId = "00000000-0000-4000-8000-0000000000f1";
const admin = { rpc: mocks.rpc } as never;

const quietSummary = { today: "2026-10-20", late_payouts: 0, late_payouts_cents: 0, late_refunds: 0, fees_pending_2d: 0, calendar_until: 2030 };
let flags: unknown[] = [];
let summary: unknown = quietSummary;

beforeEach(() => {
  vi.clearAllMocks();
  flags = [];
  summary = quietSummary;
  vi.stubEnv("ORGANIZER_REFUND_PIX_KEY", "financeiro@espaco.example");
  mocks.notifyOrganizer.mockResolvedValue("sent");
  mocks.notifyTeam.mockResolvedValue("sent");
  mocks.tryConsumeRateLimit.mockResolvedValue("allowed");
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "refresh_organizer_balance_flags") return { data: flags, error: null };
    if (name === "mark_balance_flag_notified") return { data: null, error: null };
    if (name === "organizer_finance_daily_summary") return { data: summary, error: null };
    return { data: null, error: { message: `inesperado ${name}` } };
  });
});
afterEach(() => vi.unstubAllEnvs());

const flag = { flag_id: flagId, organizer_id: organizerId, event_id: eventId, event_name: "Show", owed_cents: 4739, return_due_date: "2026-12-09" };

describe("devoluções", () => {
  it("avisa com valor, prazo e chave do Espaço e só então marca", async () => {
    flags = [flag];
    expect(await runOrganizerFinanceDaily(admin)).toEqual({ devolucoes: 1, resumo: false });
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(organizerId, "org_devolucao_pendente", {
      eventName: "Show",
      amountCents: 4739,
      day: "2026-12-09",
      espacoPixKey: "financeiro@espaco.example",
      link: `https://site.example/organizador/eventos/${eventId}?aba=financeiro`,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mark_balance_flag_notified", { p_flag_id: flagId });
  });

  it("envio que falha não marca (tenta amanhã)", async () => {
    flags = [flag];
    mocks.notifyOrganizer.mockResolvedValue("capped");
    expect((await runOrganizerFinanceDaily(admin)).devolucoes).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalledWith("mark_balance_flag_notified", expect.anything());
  });

  it("sem a chave do Espaço no ambiente envia sem ela e alerta a equipe", async () => {
    vi.stubEnv("ORGANIZER_REFUND_PIX_KEY", "");
    flags = [flag];
    await runOrganizerFinanceDaily(admin);
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith(admin, "pix_devolucao_sem_chave", expect.any(String));
    expect(mocks.notifyOrganizer.mock.calls[0][2].espacoPixKey).toBeUndefined();
  });

  it("falha no banco não derruba o resumo", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "refresh_organizer_balance_flags") throw new Error("rede");
      if (name === "organizer_finance_daily_summary") return { data: { ...quietSummary, late_refunds: 1 }, error: null };
      return { data: null, error: null };
    });
    expect(await runOrganizerFinanceDaily(admin)).toEqual({ devolucoes: 0, resumo: true });
  });
});

describe("resumo da equipe", () => {
  it("dia tranquilo não envia", async () => {
    expect((await runOrganizerFinanceDaily(admin)).resumo).toBe(false);
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
    expect(mocks.tryConsumeRateLimit).not.toHaveBeenCalled();
  });

  it("um por dia, só com contagens", async () => {
    summary = { ...quietSummary, late_payouts: 3, late_payouts_cents: 123456, late_refunds: 1, fees_pending_2d: 2 };
    expect((await runOrganizerFinanceDaily(admin)).resumo).toBe(true);
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      admin,
      { bucket: "org-finance-summary:day", limit: 1, windowSeconds: 86_400 },
      "site",
    );
    expect(mocks.notifyTeam).toHaveBeenCalledWith("equipe_repasses_resumo", {
      summary: { latePayouts: 3, latePayoutsCents: 123456, lateRefunds: 1, feesPending: 2, calendarMissingYear: null },
      link: "https://site.example/equipe/repasses",
    });
  });

  it("já enviado hoje não repete", async () => {
    summary = { ...quietSummary, late_refunds: 1 };
    mocks.tryConsumeRateLimit.mockResolvedValue("limited");
    expect((await runOrganizerFinanceDaily(admin)).resumo).toBe(false);
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("envio que falha libera a vaga do dia", async () => {
    summary = { ...quietSummary, late_refunds: 1 };
    mocks.notifyTeam.mockResolvedValue("failed");
    await runOrganizerFinanceDaily(admin);
    expect(mocks.releaseRateLimit).toHaveBeenCalled();
  });
});

describe("summaryToSend", () => {
  it("cobra o calendário do ano seguinte só a partir de 1º/11", () => {
    expect(summaryToSend({ ...quietSummary, today: "2026-10-31", calendar_until: 2026 })).toBeNull();
    expect(summaryToSend({ ...quietSummary, today: "2026-11-01", calendar_until: 2026 })?.calendarMissingYear).toBe(2027);
    expect(summaryToSend({ ...quietSummary, today: "2026-11-01", calendar_until: 2027 })).toBeNull();
  });

  it("resposta estranha não envia", () => {
    expect(summaryToSend(null)).toBeNull();
    expect(summaryToSend({ late_payouts: "3" })).toBeNull();
  });
});
