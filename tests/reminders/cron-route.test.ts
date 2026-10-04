import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runAbandonedReminders: vi.fn(), runSessionNotices: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/reminders/process", () => ({ runAbandonedReminders: mocks.runAbandonedReminders }));
vi.mock("@/lib/notices/process", () => ({ runSessionNotices: mocks.runSessionNotices }));

import { POST } from "@/app/api/cron/abandoned-reminders/route";

const secret = "r".repeat(64);

function cronRequest(authorization?: string) {
  return new Request("https://eventos.exemplo/api/cron/abandoned-reminders", {
    method: "POST",
    headers: authorization ? { authorization } : {},
    body: "{}",
  });
}

describe("POST /api/cron/abandoned-reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REMINDER_CRON_SECRET", secret);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sem REMINDER_CRON_SECRET recusa sempre e não roda nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("REMINDER_CRON_SECRET", "");

    for (const auth of [undefined, "Bearer ", "Bearer undefined", `Bearer ${secret}`]) {
      const response = await POST(cronRequest(auth));
      expect(response.status).toBe(401);
    }
    expect(mocks.runAbandonedReminders).not.toHaveBeenCalled();
  });

  it("segredo ausente ou errado é recusado", async () => {
    for (const auth of [undefined, secret, `Bearer ${secret}x`, `Basic ${secret}`]) {
      const response = await POST(cronRequest(auth));
      expect(response.status).toBe(401);
    }
    expect(mocks.runAbandonedReminders).not.toHaveBeenCalled();
  });

  it("segredo certo roda os lembretes e devolve só contagens", async () => {
    mocks.runAbandonedReminders.mockResolvedValue({ status: "ok", claimed: 2, sent: 1, failed: 1 });

    const response = await POST(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, claimed: 2, sent: 1, failed: 1, notices: 0 });
    expect(mocks.runAbandonedReminders).toHaveBeenCalledTimes(1);
  });

  it("envia antes os avisos de sessão pendentes; falha neles não impede o lembrete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runAbandonedReminders.mockResolvedValue({ status: "ok", claimed: 0, sent: 0, failed: 0 });
    mocks.runSessionNotices.mockResolvedValueOnce({ status: "ok", claimed: 3, sent: 3, failed: 0, pausedUntil: null });

    const response = await POST(cronRequest(`Bearer ${secret}`));
    await expect(response.json()).resolves.toMatchObject({ ok: true, notices: 3 });
    expect(mocks.runSessionNotices).toHaveBeenCalledWith(expect.anything(), { limit: 40 });
    expect(mocks.runSessionNotices.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runAbandonedReminders.mock.invocationCallOrder[0],
    );

    mocks.runSessionNotices.mockRejectedValueOnce(new Error("fora"));
    expect((await POST(cronRequest(`Bearer ${secret}`))).status).toBe(200);
  });

  it("segredo errado não envia avisos de sessão", async () => {
    await POST(cronRequest("Bearer errado"));
    expect(mocks.runSessionNotices).not.toHaveBeenCalled();
  });

  it("e-mail não configurado responde 503 e falha do banco 500", async () => {
    mocks.runAbandonedReminders.mockResolvedValueOnce({ status: "not_configured" });
    expect((await POST(cronRequest(`Bearer ${secret}`))).status).toBe(503);

    mocks.runAbandonedReminders.mockResolvedValueOnce({ status: "error" });
    expect((await POST(cronRequest(`Bearer ${secret}`))).status).toBe(500);
  });
});
