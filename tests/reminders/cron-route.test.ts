import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runAbandonedReminders: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/reminders/process", () => ({ runAbandonedReminders: mocks.runAbandonedReminders }));

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
    await expect(response.json()).resolves.toEqual({ ok: true, claimed: 2, sent: 1, failed: 1 });
    expect(mocks.runAbandonedReminders).toHaveBeenCalledTimes(1);
  });

  it("e-mail não configurado responde 503 e falha do banco 500", async () => {
    mocks.runAbandonedReminders.mockResolvedValueOnce({ status: "not_configured" });
    expect((await POST(cronRequest(`Bearer ${secret}`))).status).toBe(503);

    mocks.runAbandonedReminders.mockResolvedValueOnce({ status: "error" });
    expect((await POST(cronRequest(`Bearer ${secret}`))).status).toBe(500);
  });
});
