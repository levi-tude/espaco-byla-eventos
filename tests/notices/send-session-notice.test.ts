import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendSessionNoticeEmail, sessionNoticeEmailConfig } from "@/lib/email/send-session-notice";

const config = {
  apiKey: "chave-teste",
  from: "Espaço Byla <teste@exemplo.test>",
  appUrl: "https://eventos.exemplo",
  replyTo: "contato@exemplo.test",
};
const input = {
  config,
  to: "comprador@example.com",
  content: { subject: "Assunto", html: "<p>oi</p>", text: "oi" },
  idempotencyKey: "aviso-sessao/00000000-0000-4000-8000-000000000001",
};

describe("sendSessionNoticeEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("envia com chave de idempotência e resposta para o contato; lê o uso do dia", async () => {
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200, headers: { "x-resend-daily-quota": "42" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendSessionNoticeEmail(input)).resolves.toEqual({ status: "sent", quotaUsed: 42 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(input.idempotencyKey);
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["comprador@example.com"]);
    expect(body.reply_to).toBe("contato@exemplo.test");
    expect(body.headers).toBeUndefined();
  });

  it("sem contato, não define resposta; sem cabeçalho de uso, quotaUsed é null", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendSessionNoticeEmail({ ...input, config: { ...config, replyTo: null } })).resolves.toEqual({
      status: "sent",
      quotaUsed: null,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).reply_to).toBeUndefined();
  });

  it("limite diário estourado é separado de falha comum", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ statusCode: 429, name: "daily_quota_exceeded" }), { status: 429 })),
    );
    await expect(sendSessionNoticeEmail(input)).resolves.toEqual({ status: "quota" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "rate_limit_exceeded" }), { status: 429 })));
    await expect(sendSessionNoticeEmail(input)).resolves.toEqual({ status: "failed" });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("rede");
    }));
    await expect(sendSessionNoticeEmail(input)).resolves.toEqual({ status: "failed" });
  });

  it("configuração: e-mail de contato inválido é ignorado", () => {
    vi.stubEnv("RESEND_API_KEY", "chave-teste");
    vi.stubEnv("RESEND_FROM_EMAIL", "Espaço Byla <teste@exemplo.test>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://eventos.exemplo/");
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "contato@exemplo.test");
    expect(sessionNoticeEmailConfig()).toEqual(config);

    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "não é e-mail");
    expect(sessionNoticeEmailConfig()?.replyTo).toBeNull();

    vi.stubEnv("RESEND_API_KEY", "");
    expect(sessionNoticeEmailConfig()).toBeNull();
  });
});
