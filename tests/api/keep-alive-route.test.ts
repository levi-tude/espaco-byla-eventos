import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runSessionNotices: vi.fn(), queryError: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notices/process", () => ({ runSessionNotices: mocks.runSessionNotices }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const result = () => Promise.resolve({ data: [], error: mocks.queryError });
    const chain = { select: () => chain, limit: result, then: (resolve: (v: unknown) => unknown) => result().then(resolve) };
    return { from: () => chain, rpc: result };
  },
}));

import { GET } from "@/app/api/cron/keep-alive/route";

const secret = "c".repeat(48);
const request = (authorization?: string) =>
  new Request("https://eventos.exemplo/api/cron/keep-alive", { headers: authorization ? { authorization } : {} });

describe("GET /api/cron/keep-alive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryError = null;
    vi.stubEnv("CRON_SECRET", secret);
    mocks.runSessionNotices.mockResolvedValue({ status: "ok", claimed: 2, sent: 2, failed: 0, pausedUntil: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sem o segredo certo recusa e não envia nada", async () => {
    for (const auth of [undefined, "Bearer errado", secret]) {
      expect((await GET(request(auth))).status).toBe(401);
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(mocks.runSessionNotices).not.toHaveBeenCalled();
  });

  it("lê o banco e continua os avisos de sessão do dia anterior", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, notices: 2 });
    expect(mocks.runSessionNotices).toHaveBeenCalledWith(expect.anything(), { limit: 40 });
  });

  it("falha nos avisos não derruba o keep-alive", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runSessionNotices.mockRejectedValue(new Error("fora"));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, notices: 0 });
  });

  it("falha do banco responde 500 sem enviar avisos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.queryError = { message: "fora" };
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(500);
    expect(mocks.runSessionNotices).not.toHaveBeenCalled();
  });
});
