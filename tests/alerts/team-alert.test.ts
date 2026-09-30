import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ consumeRateLimit: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));

import { alertTeam } from "@/lib/alerts/team-alert";
import type { SupabaseAdmin } from "@/lib/domain/orders";

const orderId = "00000000-0000-4000-8000-000000000010";

const admin = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: {
          buyer_name: "Comprador Teste",
          buyer_email: "comprador@example.com",
          events: { name: "Festa Teste" },
        },
        error: null,
      }),
    };
    return chain;
  },
} as unknown as SupabaseAdmin;

describe("alertTeam", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ALERT_EMAIL", "equipe@example.com");
    vi.stubEnv("RESEND_API_KEY", "chave-de-teste");
    vi.stubEnv("RESEND_FROM_EMAIL", "Espaço Byla <ingressos@example.com>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://site.example");
    mocks.consumeRateLimit.mockResolvedValue(true);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("envia e-mail para a equipe com evento, comprador e pedido", async () => {
    await alertTeam(admin, "email_nao_enviado", orderId, "Motivo: teste");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["equipe@example.com"]);
    expect(body.subject).toContain("[Alerta]");
    expect(body.text).toContain("Motivo: teste");
    expect(body.text).toContain("Festa Teste");
    expect(body.text).toContain("comprador@example.com");
    expect(body.text).toContain(orderId);
    expect(body.text).toContain("https://site.example/equipe");
  });

  it("manda no máximo um alerta por pedido e tipo no período", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);
    await alertTeam(admin, "valor_divergente", orderId, "detalhes");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ bucket: "alert:order", limit: 1 }),
      `valor_divergente:${orderId}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem ALERT_EMAIL só registra no log", async () => {
    vi.stubEnv("ALERT_EMAIL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await alertTeam(admin, "confirmacao_falhou", orderId, "detalhes");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("nunca lança, mesmo se o envio falhar", async () => {
    fetchMock.mockRejectedValue(new Error("rede caiu"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      alertTeam(admin, "confirmacao_falhou", orderId, "detalhes"),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
