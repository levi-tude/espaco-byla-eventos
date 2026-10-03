import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tryConsumeRateLimit: vi.fn(),
  releaseRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/rate-limit", () => ({
  tryConsumeRateLimit: mocks.tryConsumeRateLimit,
  releaseRateLimit: mocks.releaseRateLimit,
}));

import { alertTeam, alertTeamSetup } from "@/lib/alerts/team-alert";
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
    mocks.tryConsumeRateLimit.mockResolvedValue("allowed");
    mocks.releaseRateLimit.mockResolvedValue(true);
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

  it.each([
    ["pago_sem_vaga", "sem vaga"],
    ["pago_apos_cancelamento", "depois do cancelamento"],
  ] as const)("alerta %s tem assunto claro", async (kind, subject) => {
    await alertTeam(admin, kind, orderId, "detalhes");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain(subject);
    expect(body.subject).toContain("decidir");
  });

  it.each([
    ["estorno_falhou", "Estorno recusado"],
    ["estorno_externo", "fora do site"],
    ["email_estorno_nao_enviado", "estornado"],
  ] as const)("alerta de estorno %s tem assunto claro", async (kind, subject) => {
    await alertTeam(admin, kind, orderId, "detalhes");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain(subject);
  });

  it("manda no máximo um alerta por pedido e tipo no período", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("limited");
    await alertTeam(admin, "valor_divergente", orderId, "detalhes");
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ bucket: "alert:order", limit: 1 }),
      `valor_divergente:${orderId}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envio aceito mantém a deduplicação registrada", async () => {
    await alertTeam(admin, "valor_divergente", orderId, "detalhes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRateLimit).not.toHaveBeenCalled();
  });

  it("se o banco falha na deduplicação, envia mesmo assim", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("error");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await alertTeam(admin, "confirmacao_falhou", orderId, "detalhes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(mocks.releaseRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["Resend recusa", () => fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }))],
    ["rede cai", () => fetchMock.mockRejectedValueOnce(new Error("rede caiu"))],
  ])("se o envio falha (%s), libera a deduplicação para a próxima tentativa", async (_caso, fail) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const used = new Set<string>();
    mocks.tryConsumeRateLimit.mockImplementation(async (_admin, rule, key) => {
      const id = `${rule.bucket}:${key}`;
      if (used.has(id)) return "limited";
      used.add(id);
      return "allowed";
    });
    mocks.releaseRateLimit.mockImplementation(async (_admin, rule, key) =>
      used.delete(`${rule.bucket}:${key}`),
    );

    fail();
    await alertTeam(admin, "email_nao_enviado", orderId, "detalhes");
    expect(mocks.releaseRateLimit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ bucket: "alert:order" }),
      `email_nao_enviado:${orderId}`,
    );

    await alertTeam(admin, "email_nao_enviado", orderId, "detalhes");
    await alertTeam(admin, "email_nao_enviado", orderId, "detalhes");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falha ao liberar a deduplicação só vai para o log, sem lançar", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    mocks.releaseRateLimit.mockResolvedValueOnce(false);
    await expect(
      alertTeam(admin, "email_nao_enviado", orderId, "detalhes"),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("bloqueadas"),
      expect.anything(),
    );
  });

  it("alerta de configuração usa deduplicação própria e não cita pedido", async () => {
    await alertTeamSetup(admin, "webhook_sem_chave", "Falta a chave.");
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ bucket: "alert:setup", limit: 1 }),
      "webhook_sem_chave",
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain("chave secreta");
    expect(body.text).toContain("Falta a chave.");
    expect(body.text).not.toContain("Pedido");
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
