import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertTeamSetup: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeamSetup: mocks.alertTeamSetup }));

import { isBotRequest, TURNSTILE_VERIFY_URL } from "@/lib/security/bot";

const TOKEN = "token-do-widget";

function siteverify(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function configure() {
  vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo-de-teste");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "chave-publica");
}

describe("isBotRequest (verificação anti-robô)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("em desenvolvimento/teste sem chaves, não bloqueia nem chama o serviço", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    await expect(isBotRequest(undefined, "checkout")).resolves.toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("em produção sem chaves, bloqueia (falha fechada) e avisa a equipe", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(isBotRequest(TOKEN, "checkout")).resolves.toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith({}, "antirrobo_sem_chave", expect.any(String));
  });

  it("em produção com só uma das chaves, também bloqueia", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(isBotRequest(TOKEN, "checkout")).resolves.toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("alerta que falha não derruba a resposta", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    mocks.alertTeamSetup.mockRejectedValueOnce(new Error("banco fora"));
    await expect(isBotRequest(TOKEN, "checkout")).resolves.toBe(true);
  });

  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["não texto", 123],
    ["grande demais", "x".repeat(2049)],
  ])("token %s é recusado sem chamar o serviço", async (_caso, token) => {
    configure();
    await expect(isBotRequest(token, "checkout")).resolves.toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("token válido para a ação certa libera", async () => {
    configure();
    mocks.fetch.mockResolvedValue(siteverify({ success: true, action: "checkout" }));
    await expect(isBotRequest(TOKEN, "checkout")).resolves.toBe(false);

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("secret")).toBe("segredo-de-teste");
    expect(body.get("response")).toBe(TOKEN);
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("token de outra ação (ex.: reaproveitado do checkout no pagamento) é recusado", async () => {
    configure();
    mocks.fetch.mockResolvedValue(siteverify({ success: true, action: "checkout" }));
    await expect(isBotRequest(TOKEN, "payment")).resolves.toBe(true);
  });

  it("serviço diz que não é humano → bloqueia", async () => {
    configure();
    mocks.fetch.mockResolvedValue(
      siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );
    await expect(isBotRequest(TOKEN, "checkout")).resolves.toBe(true);
  });

  it.each([
    ["erro HTTP", () => Promise.resolve(siteverify({}, 500))],
    ["resposta inválida", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["rede/timeout", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
  ])("%s no serviço → falha fechada e avisa a equipe", async (_caso, impl) => {
    configure();
    mocks.fetch.mockImplementation(impl);
    await expect(isBotRequest(TOKEN, "checkout")).resolves.toBe(true);
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith(
      {},
      "antirrobo_indisponivel",
      expect.any(String),
    );
  });
});
