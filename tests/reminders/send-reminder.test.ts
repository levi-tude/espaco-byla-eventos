import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reminderEmailConfig, sendReminderEmail } from "@/lib/email/send-reminder";

const config = { apiKey: "chave-teste", from: "Espaço Byla <teste@exemplo.test>", appUrl: "https://eventos.exemplo" };
const input = {
  config,
  to: "comprador@example.com",
  content: { subject: "Assunto", html: "<p>oi</p>", text: "oi" },
  oneClickUnsubscribeUrl: `https://eventos.exemplo/api/lembretes/cancelar?t=${"a".repeat(64)}`,
  idempotencyKey: "lembrete-abandono/00000000-0000-4000-8000-000000000001",
};

describe("sendReminderEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("envia com chave de idempotência e descadastro com um clique", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendReminderEmail(input)).resolves.toBe("sent");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(input.idempotencyKey);
    expect(headers.Authorization).toBe("Bearer chave-teste");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["comprador@example.com"]);
    expect(body.subject).toBe("Assunto");
    expect(body.headers).toEqual({
      "List-Unsubscribe": `<${input.oneClickUnsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("recusa ou erro de rede viram falha, sem lançar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(sendReminderEmail(input)).resolves.toBe("failed");

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("rede");
    }));
    await expect(sendReminderEmail(input)).resolves.toBe("failed");
  });

  it("configuração exige chave, remetente e endereço do site", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "Espaço Byla <teste@exemplo.test>");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://eventos.exemplo/");
    expect(reminderEmailConfig()).toBeNull();

    vi.stubEnv("RESEND_API_KEY", "chave-teste");
    expect(reminderEmailConfig()).toEqual(config);
  });
});
