import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alertTeamSetup: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeamSetup: mocks.alertTeamSetup }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { buildPasswordResetEmail } from "@/lib/email/password-reset-template";
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset";

const LINK = "https://acdheventos.com.br/redefinir-senha#token=" + "a".repeat(43);
const VENDORS = /resend|supabase|mercado ?pago|google|cloud run|vercel/i;

describe("buildPasswordResetEmail", () => {
  it("traz o link, validade e aviso sem nome de fornecedor", () => {
    const email = buildPasswordResetEmail({ link: LINK });
    expect(email.subject).toContain("ACDH Eventos");
    for (const body of [email.html, email.text]) {
      expect(body).toContain(LINK);
      expect(body).toMatch(/24 horas/);
      expect(body).toMatch(/só (uma|1) vez|só pode ser usado uma vez/i);
      expect(body).toMatch(/Se não foi você/);
      expect(body).not.toMatch(VENDORS);
    }
  });
});

describe("sendPasswordResetEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_teste");
    vi.stubEnv("RESEND_FROM_EMAIL", "ACDH Eventos <ingressos@exemplo.online>");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    mocks.alertTeamSetup.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("envia sem vazar e-mail ou token no log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await sendPasswordResetEmail({ to: "pessoa@exemplo.com", link: LINK })).toBe("sent");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/pessoa@exemplo\.com|token=/);
  });

  it("403: failed + alerta à equipe, sem e-mail no log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: "restricted_api_key" }), { status: 403 }));
    expect(await sendPasswordResetEmail({ to: "pessoa@exemplo.com", link: LINK })).toBe("failed");
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith(
      expect.anything(),
      "senha_email_falhou",
      expect.stringContaining("403"),
    );
    expect(JSON.stringify([...log.mock.calls, ...mocks.alertTeamSetup.mock.calls])).not.toMatch(
      /pessoa@exemplo\.com/,
    );
  });

  it("cota diária: quota + alerta", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "daily_quota_exceeded" }), { status: 429 }),
    );
    expect(await sendPasswordResetEmail({ to: "pessoa@exemplo.com", link: LINK })).toBe("quota");
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith(
      expect.anything(),
      "senha_email_falhou",
      expect.stringContaining("429"),
    );
  });

  it("sem configuração: skipped + alerta", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendPasswordResetEmail({ to: "pessoa@exemplo.com", link: LINK })).toBe("skipped");
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith(
      expect.anything(),
      "senha_email_falhou",
      expect.stringContaining("configurar"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
