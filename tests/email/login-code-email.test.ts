import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildLoginCodeEmail } from "@/lib/email/login-code-template";
import { sendLoginCodeEmail } from "@/lib/email/send-login-code";

const VENDORS = /resend|supabase|mercado ?pago|google|cloud run|vercel/i;

describe("buildLoginCodeEmail", () => {
  const email = buildLoginCodeEmail({ code: "042917" });

  it("assunto sem o código", () => {
    expect(email.subject).toBe("Seu código de acesso - Espaço Byla Eventos");
    expect(email.subject).not.toContain("042917");
  });

  it("corpo traz código, validade e o que fazer se não foi a pessoa", () => {
    for (const body of [email.html, email.text]) {
      expect(body).toContain("042917");
      expect(body).toContain("10 minutos");
      expect(body).toMatch(/Se não foi você/);
      expect(body).toMatch(/troque sua senha/);
      expect(body).not.toMatch(VENDORS);
    }
  });

  it("não aceita nada além de 6 números (nada de HTML no e-mail)", () => {
    expect(() => buildLoginCodeEmail({ code: "<b>1</b>" })).toThrow();
  });
});

describe("sendLoginCodeEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_teste");
    vi.stubEnv("RESEND_FROM_EMAIL", "Espaço Byla <ingressos@exemplo.online>");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function logs() {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return () => JSON.stringify([...error.mock.calls, ...warn.mock.calls]);
  }

  it("envia para o e-mail da conta, sem o código no assunto", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await sendLoginCodeEmail({ to: "pessoa@exemplo.com", code: "123456" })).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["pessoa@exemplo.com"]);
    expect(body.subject).not.toContain("123456");
    expect(body.text).toContain("123456");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sem configuração não envia", async () => {
    const read = logs();
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendLoginCodeEmail({ to: "pessoa@exemplo.com", code: "123456" })).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(read()).not.toContain("pessoa@exemplo.com");
  });

  it("limite diário do serviço vira 'quota'", async () => {
    const read = logs();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "daily_quota_exceeded" }), { status: 429 }),
    );
    expect(await sendLoginCodeEmail({ to: "pessoa@exemplo.com", code: "123456" })).toBe("quota");
    expect(read()).not.toMatch(/123456|pessoa@exemplo\.com/);
  });

  it("recusa ou falha de rede vira 'failed' sem vazar código ou e-mail no log", async () => {
    const read = logs();
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 422 }));
    expect(await sendLoginCodeEmail({ to: "pessoa@exemplo.com", code: "123456" })).toBe("failed");
    fetchMock.mockRejectedValueOnce(new Error("fora do ar pessoa@exemplo.com 123456"));
    expect(await sendLoginCodeEmail({ to: "pessoa@exemplo.com", code: "123456" })).toBe("failed");
    expect(read()).not.toMatch(/123456|pessoa@exemplo\.com/);
  });

  it("perto do limite diário avisa no log, mas envia", async () => {
    const read = logs();
    fetchMock.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "x-resend-daily-quota": "93" } }),
    );
    expect(await sendLoginCodeEmail({ to: "pessoa@exemplo.com", code: "123456" })).toBe("sent");
    expect(read()).toMatch(/93/);
  });
});
