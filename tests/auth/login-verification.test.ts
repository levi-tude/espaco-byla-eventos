import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  adminRpc: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0.0.0 Mobile Safari/537.36",
  sendLoginCodeEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
  headers: async () => new Headers({ "user-agent": mocks.userAgent }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/lib/email/send-login-code", () => ({
  sendLoginCodeEmail: mocks.sendLoginCodeEmail,
}));

import { ActionError } from "@/lib/action-result";
import {
  endLoginVerification,
  readLoginState,
  resendLoginCode,
  startLoginVerification,
  submitLoginCode,
} from "@/lib/auth/login-verification";
import { createServerClient } from "@/lib/supabase/server";

const userId = "00000000-0000-4000-8000-0000000000aa";
const sessionId = "00000000-0000-4000-8000-0000000000bb";
const deviceToken = "A".repeat(43);

function state(status: string, extra: Record<string, unknown> = {}) {
  return {
    data: [
      {
        status,
        user_id: status === "fora" ? null : userId,
        session_id: status === "fora" ? null : sessionId,
        code_expires_at: null,
        resend_at: null,
        ...extra,
      },
    ],
    error: null,
  };
}

/** Sem `my_account_kind` no mapa, a conta é da equipe (como as contas de hoje). */
function rpcReturns(map: Record<string, unknown>) {
  const answers: Record<string, unknown> = { my_account_kind: { data: "equipe", error: null }, ...map };
  mocks.rpc.mockImplementation(async (name: string) => answers[name] ?? { data: null, error: null });
}

function verifyCallArgs() {
  const call = mocks.rpc.mock.calls.find(([name]) => name === "verify_login_code");
  expect(call).toBeDefined();
  return call![1];
}

async function expectActionError(promise: Promise<unknown>, message: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(ActionError);
  await expect(promise).rejects.toThrow(message);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email: "pessoa@exemplo.com" } }, error: null });
  mocks.adminRpc.mockResolvedValue({ data: "ok", error: null });
  mocks.sendLoginCodeEmail.mockResolvedValue("sent");
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("readLoginState", () => {
  it("falha na consulta conta como 'fora' (falha fechada)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcReturns({ login_session_state: { data: null, error: { message: "x" } } });
    expect((await readLoginState(await createServerClient())).status).toBe("fora");
  });

  it("status desconhecido também é 'fora'", async () => {
    rpcReturns({ login_session_state: state("qualquer") });
    expect((await readLoginState(await createServerClient())).status).toBe("fora");
  });

  it("sem área não consulta o tipo de conta (como antes)", async () => {
    rpcReturns({ login_session_state: state("verificado") });
    expect((await readLoginState(await createServerClient())).status).toBe("verificado");
    expect(mocks.rpc).not.toHaveBeenCalledWith("my_account_kind");
  });

  it("com área: só vale se o tipo de conta for o da área", async () => {
    rpcReturns({ login_session_state: state("verificado"), my_account_kind: { data: "organizador", error: null } });
    const supabase = await createServerClient();
    expect((await readLoginState(supabase, "organizador")).status).toBe("verificado");
    expect((await readLoginState(supabase, "equipe")).status).toBe("fora");
    expect(mocks.rpc).toHaveBeenCalledWith("my_account_kind");
  });

  it("com área: erro no tipo de conta é 'fora'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcReturns({ login_session_state: state("verificado"), my_account_kind: { data: null, error: { message: "x" } } });
    expect((await readLoginState(await createServerClient(), "equipe")).status).toBe("fora");
  });
});

describe("área do organizador", () => {
  const organizer = { my_account_kind: { data: "organizador", error: null } };

  it("verificado vai para /organizador", async () => {
    rpcReturns({ ...organizer, login_session_state: state("verificado") });
    expect(await startLoginVerification("organizador")).toEqual({ next: "/organizador" });
  });

  it("lê o cookie do aparelho do organizador e entra direto", async () => {
    mocks.cookieGet.mockImplementation((name: string) =>
      name === "byla_org_aparelho" ? { value: deviceToken } : undefined,
    );
    rpcReturns({
      ...organizer,
      login_session_state: state("pendente"),
      verify_session_with_device: { data: true, error: null },
    });
    expect(await startLoginVerification("organizador")).toEqual({ next: "/organizador" });
    expect(mocks.cookieGet).toHaveBeenCalledWith("byla_org_aparelho");
    expect(mocks.cookieGet).not.toHaveBeenCalledWith("byla_equipe_aparelho");
  });

  it("sem aparelho: manda o código do organizador e vai para /organizador/verificar", async () => {
    rpcReturns({ ...organizer, login_session_state: state("pendente") });
    expect(await startLoginVerification("organizador")).toEqual({ next: "/organizador/verificar" });
    const code = mocks.adminRpc.mock.calls[0][1].p_code;
    expect(mocks.sendLoginCodeEmail).toHaveBeenCalledWith({
      to: "pessoa@exemplo.com",
      code,
      purpose: "organizador",
    });
  });

  it("conta da equipe na área do organizador: erro genérico e nada enviado", async () => {
    rpcReturns({ login_session_state: state("pendente") });
    await expectActionError(startLoginVerification("organizador"), /^Não foi possível entrar\.$/);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it("organizador na área da equipe: erro genérico", async () => {
    rpcReturns({ ...organizer, login_session_state: state("verificado") });
    await expectActionError(startLoginVerification(), /^Não foi possível entrar\.$/);
  });

  it("reenviar com conta da equipe na área do organizador: sessão terminou", async () => {
    rpcReturns({ login_session_state: state("pendente") });
    await expectActionError(resendLoginCode("organizador"), /Sua sessão terminou/);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("código certo com 'lembrar' grava o cookie do organizador em /organizador", async () => {
    rpcReturns({ ...organizer, verify_login_code: { data: "ok", error: null } });
    expect(await submitLoginCode({ code: "123456", remember: true, area: "organizador" })).toEqual({
      next: "/organizador",
    });
    const args = verifyCallArgs();
    expect(mocks.cookieSet).toHaveBeenCalledWith("byla_org_aparelho", args.p_device_token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/organizador",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it("conta da equipe enviando código na área do organizador: erro genérico, sem conferir nem cookie", async () => {
    rpcReturns({ verify_login_code: { data: "ok", error: null } });
    await expectActionError(
      submitLoginCode({ code: "123456", remember: true, area: "organizador" }),
      /^Não foi possível entrar\.$/,
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith("verify_login_code", expect.anything());
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("organizador enviando código na área da equipe: erro genérico", async () => {
    rpcReturns({ ...organizer, verify_login_code: { data: "ok", error: null } });
    await expectActionError(submitLoginCode({ code: "123456", remember: true }), /^Não foi possível entrar\.$/);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("área desconhecida é recusada", async () => {
    rpcReturns({ login_session_state: state("verificado") });
    await expectActionError(
      submitLoginCode({ code: "123456", remember: true, area: "admin" as never }),
      /^Não foi possível entrar\.$/,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("startLoginVerification (logo depois da senha)", () => {
  it("quem não é da equipe recebe erro genérico", async () => {
    rpcReturns({ login_session_state: state("fora") });
    await expectActionError(startLoginVerification(), /^Não foi possível entrar\.$/);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("sessão já verificada vai direto para o painel", async () => {
    rpcReturns({ login_session_state: state("verificado") });
    expect(await startLoginVerification()).toEqual({ next: "/equipe" });
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it("aparelho lembrado entra sem e-mail", async () => {
    mocks.cookieGet.mockReturnValue({ value: deviceToken });
    rpcReturns({
      login_session_state: state("pendente"),
      verify_session_with_device: { data: true, error: null },
    });
    expect(await startLoginVerification()).toEqual({ next: "/equipe" });
    expect(mocks.rpc).toHaveBeenCalledWith("verify_session_with_device", { p_device_token: deviceToken });
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it("aparelho não reconhecido: manda o código e vai para a tela do código", async () => {
    mocks.cookieGet.mockReturnValue({ value: deviceToken });
    rpcReturns({
      login_session_state: state("pendente"),
      verify_session_with_device: { data: false, error: null },
    });
    expect(await startLoginVerification()).toEqual({ next: "/equipe/verificar" });
    const [, args] = mocks.adminRpc.mock.calls[0];
    expect(mocks.adminRpc.mock.calls[0][0]).toBe("issue_login_code");
    expect(args).toMatchObject({ p_user_id: userId, p_session_id: sessionId });
    expect(args.p_code).toMatch(/^\d{6}$/);
    expect(mocks.sendLoginCodeEmail).toHaveBeenCalledWith({
      to: "pessoa@exemplo.com",
      code: args.p_code,
      purpose: "equipe",
    });
  });

  it("cookie fora do formato nem chega ao banco", async () => {
    mocks.cookieGet.mockReturnValue({ value: "curto" });
    rpcReturns({ login_session_state: state("pendente") });
    await startLoginVerification();
    expect(mocks.rpc).not.toHaveBeenCalledWith("verify_session_with_device", expect.anything());
  });

  it("já existe código válido para esta sessão: não manda outro", async () => {
    rpcReturns({
      login_session_state: state("pendente", { code_expires_at: new Date(Date.now() + 300_000).toISOString() }),
    });
    expect(await startLoginVerification()).toEqual({ next: "/equipe/verificar" });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("falha no envio não impede de chegar à tela do código (lá dá para reenviar)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendLoginCodeEmail.mockResolvedValue("failed");
    rpcReturns({ login_session_state: state("pendente") });
    expect(await startLoginVerification()).toEqual({ next: "/equipe/verificar" });
  });
});

describe("resendLoginCode", () => {
  beforeEach(() => rpcReturns({ login_session_state: state("pendente") }));

  it("envia um código novo", async () => {
    expect(await resendLoginCode()).toEqual({ verified: false });
    expect(mocks.sendLoginCodeEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["aguarde", /Aguarde um minuto/],
    ["limite", /Muitas tentativas em pouco tempo/],
    ["recusado", /Sua sessão terminou/],
  ])("banco responde %s", async (status, message) => {
    mocks.adminRpc.mockResolvedValue({ data: status, error: null });
    await expectActionError(resendLoginCode(), message);
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it("erro do banco ou do e-mail vira mensagem genérica", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expectActionError(resendLoginCode(), /Não conseguimos enviar o código agora/);
    mocks.sendLoginCodeEmail.mockResolvedValueOnce("quota");
    await expectActionError(resendLoginCode(), /Não conseguimos enviar o código agora/);
  });

  it("sem e-mail na conta ou outra conta no token: não envia", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "outro", email: "x@y.com" } }, error: null });
    await expectActionError(resendLoginCode(), /Sua sessão terminou/);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("já verificado não manda nada", async () => {
    rpcReturns({ login_session_state: state("verificado") });
    expect(await resendLoginCode()).toEqual({ verified: true });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("sem login: sessão terminou", async () => {
    rpcReturns({ login_session_state: state("fora") });
    await expectActionError(resendLoginCode(), /Sua sessão terminou/);
  });
});

describe("submitLoginCode", () => {
  it("formato errado nem chega ao banco", async () => {
    await expectActionError(submitLoginCode({ code: "12a", remember: true }), /Digite os 6 números/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("código certo com 'lembrar': grava o aparelho e o cookie httpOnly de 30 dias", async () => {
    rpcReturns({ verify_login_code: { data: "ok", error: null } });
    expect(await submitLoginCode({ code: " 123 456 ", remember: true })).toEqual({ next: "/equipe" });
    const args = verifyCallArgs();
    expect(args.p_code).toBe("123456");
    expect(args.p_device_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.p_device_label).toBe("Chrome no Android");
    expect(mocks.cookieSet).toHaveBeenCalledWith("byla_equipe_aparelho", args.p_device_token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/equipe",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it("código certo sem 'lembrar': nenhum aparelho nem cookie", async () => {
    rpcReturns({ verify_login_code: { data: "ok", error: null } });
    await submitLoginCode({ code: "123456", remember: false });
    expect(verifyCallArgs().p_device_token).toBeNull();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("'lembrar' só com true de verdade", async () => {
    rpcReturns({ verify_login_code: { data: "ok", error: null } });
    await submitLoginCode({ code: "123456", remember: "true" });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it.each([
    ["invalido", /Código incorreto/],
    ["expirado", /Este código venceu/],
    ["bloqueado", /Muitas tentativas erradas/],
    ["fora", /Sua sessão terminou/],
    ["estranho", /Não foi possível conferir o código/],
  ])("banco responde %s: mensagem certa e nenhum cookie", async (status, message) => {
    rpcReturns({ verify_login_code: { data: status, error: null } });
    await expectActionError(submitLoginCode({ code: "123456", remember: true }), message);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("já verificado (outra aba) conta como sucesso, sem cookie novo", async () => {
    rpcReturns({ verify_login_code: { data: "verificado", error: null } });
    expect(await submitLoginCode({ code: "123456", remember: true })).toEqual({ next: "/equipe" });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("erro do banco: genérico e sem cookie", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcReturns({ verify_login_code: { data: null, error: { message: "x" } } });
    await expectActionError(submitLoginCode({ code: "123456", remember: true }), /Não foi possível conferir/);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});

describe("endLoginVerification (Sair)", () => {
  it("apaga a verificação antes de encerrar a sessão", async () => {
    const order: string[] = [];
    mocks.rpc.mockImplementation(async (name: string) => {
      order.push(name);
      return { data: null, error: null };
    });
    mocks.signOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: null };
    });
    await endLoginVerification();
    expect(order).toEqual(["end_login_verification", "signOut"]);
  });

  it("falha ao apagar a verificação não impede de sair", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    await endLoginVerification();
    expect(mocks.signOut).toHaveBeenCalled();
  });
});
