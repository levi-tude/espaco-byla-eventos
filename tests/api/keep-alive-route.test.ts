import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSessionNotices: vi.fn(),
  captureMissingFees: vi.fn(),
  runOrganizerFinanceDaily: vi.fn(),
  sweepOrphanCovers: vi.fn(),
  provider: { name: "mercadopago" },
  queryError: null as unknown,
  purgeError: null as unknown,
  organizerPurge: null as null | (() => Promise<unknown>),
  rpcNames: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notices/process", () => ({ runSessionNotices: mocks.runSessionNotices }));
vi.mock("@/lib/payments/capture-fee", () => ({ captureMissingFees: mocks.captureMissingFees }));
vi.mock("@/lib/payments/provider", () => ({ getPaymentProvider: () => mocks.provider }));
vi.mock("@/lib/organizer/daily", () => ({ runOrganizerFinanceDaily: mocks.runOrganizerFinanceDaily }));
vi.mock("@/lib/media/orphans", () => ({ sweepOrphanCovers: mocks.sweepOrphanCovers }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const result = () => Promise.resolve({ data: [], error: mocks.queryError });
    const chain = { select: () => chain, limit: result, then: (resolve: (v: unknown) => unknown) => result().then(resolve) };
    const rpc = (name: string) => {
      mocks.rpcNames.push(name);
      if (name === "purge_login_verification") {
        return Promise.resolve({ data: 0, error: mocks.purgeError });
      }
      if (name === "purge_organizer_records") {
        return mocks.organizerPurge ? mocks.organizerPurge() : Promise.resolve({ data: 0, error: null });
      }
      return result();
    };
    return { from: () => chain, rpc };
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
    mocks.purgeError = null;
    mocks.organizerPurge = null;
    mocks.rpcNames = [];
    vi.stubEnv("CRON_SECRET", secret);
    mocks.runSessionNotices.mockResolvedValue({ status: "ok", claimed: 2, sent: 2, failed: 0, pausedUntil: null });
    mocks.captureMissingFees.mockResolvedValue({ salvo: 1, falhou: 0, alertados: 0 });
    mocks.runOrganizerFinanceDaily.mockResolvedValue({ devolucoes: 0, resumo: false });
    mocks.sweepOrphanCovers.mockResolvedValue({ checked: 0, deleted: 0 });
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

  it("limpa códigos de acesso e aparelhos vencidos", async () => {
    await GET(request(`Bearer ${secret}`));
    expect(mocks.rpcNames).toContain("purge_login_verification");
  });

  it("falha na limpeza dos códigos não derruba o keep-alive", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.purgeError = { message: "fora" };
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(mocks.runSessionNotices).toHaveBeenCalled();
  });

  it("limpa convites e pedidos do site antigos dos organizadores", async () => {
    await GET(request(`Bearer ${secret}`));
    expect(mocks.rpcNames).toContain("purge_organizer_records");
  });

  it.each([
    ["erro do banco", () => Promise.resolve({ data: null, error: { code: "PGRST000", message: "fora" } })],
    ["exceção", () => Promise.reject(new Error("fora"))],
  ])("falha na limpeza dos organizadores (%s) não derruba o keep-alive", async (_caso, purge) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.organizerPurge = purge;
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, notices: 2 });
    expect(mocks.runSessionNotices).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
  });

  it("falha do banco responde 500 sem enviar avisos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.queryError = { message: "fora" };
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(500);
    expect(mocks.runSessionNotices).not.toHaveBeenCalled();
    expect(mocks.captureMissingFees).not.toHaveBeenCalled();
  });

  it("busca as tarifas que faltaram com orçamento de 25 s", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, notices: 2 });
    expect(mocks.captureMissingFees).toHaveBeenCalledWith(expect.anything(), mocks.provider, {
      budgetMs: 25_000,
    });
  });

  it("sem segredo certo não busca tarifas", async () => {
    await GET(request("Bearer errado"));
    expect(mocks.captureMissingFees).not.toHaveBeenCalled();
  });

  it("falha na busca das tarifas não derruba as outras etapas", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.captureMissingFees.mockRejectedValue(new Error("fora"));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, notices: 2 });
    expect(mocks.rpcNames).toContain("purge_login_verification");
    expect(mocks.rpcNames).toContain("purge_organizer_records");
    expect(mocks.runSessionNotices).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
  });

  it("depois das tarifas, roda os avisos de repasse dos organizadores", async () => {
    const order: string[] = [];
    mocks.captureMissingFees.mockImplementation(async () => {
      order.push("tarifas");
      return { salvo: 0, falhou: 0, alertados: 0 };
    });
    mocks.runOrganizerFinanceDaily.mockImplementation(async () => {
      order.push("repasses");
      return { devolucoes: 0, resumo: false };
    });
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(order).toEqual(["tarifas", "repasses"]);
  });

  it("sem segredo certo não roda os avisos de repasse", async () => {
    await GET(request("Bearer errado"));
    expect(mocks.runOrganizerFinanceDaily).not.toHaveBeenCalled();
    expect(mocks.sweepOrphanCovers).not.toHaveBeenCalled();
  });

  it("limpa capas sem uso por último, e falha nela não derruba o keep-alive", async () => {
    const order: string[] = [];
    mocks.runOrganizerFinanceDaily.mockImplementation(async () => {
      order.push("repasses");
      return { devolucoes: 0, resumo: false };
    });
    mocks.sweepOrphanCovers.mockImplementation(async () => {
      order.push("capas");
      throw new Error("fora");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(order).toEqual(["repasses", "capas"]);
  });
});
