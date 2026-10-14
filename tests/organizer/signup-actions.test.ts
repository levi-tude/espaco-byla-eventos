import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  updateUserById: vi.fn(),
  areaEnabled: vi.fn(),
  sendLoginCodeEmail: vi.fn(),
  alertTeamOrphanAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/lib/alerts/team-alert", () => ({
  alertTeamSetup: vi.fn(),
  alertTeamOrphanAccount: mocks.alertTeamOrphanAccount,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    auth: {
      admin: {
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
        updateUserById: mocks.updateUserById,
      },
    },
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
vi.mock("@/lib/organizer/settings", () => ({
  ORGANIZER_AREA_UNAVAILABLE_MESSAGE: "Esta área está indisponível no momento.",
  organizerAreaEnabled: mocks.areaEnabled,
}));
vi.mock("@/lib/email/send-login-code", () => ({ sendLoginCodeEmail: mocks.sendLoginCodeEmail }));
vi.mock("@/app/organizador/verificar/actions", () => ({ startOrganizerLoginAction: vi.fn() }));

import {
  checkInvite,
  completeOrganizerSignup,
  sendInviteEmailCode,
  verifyInviteEmailCode,
} from "@/app/convite/actions";
import InvitePage, { metadata as inviteMetadata } from "@/app/convite/page";
import nextConfig from "../../next.config";
import { ORGANIZER_TERMS_VERSION } from "@/lib/legal/organizer-terms";
import { hashInviteToken, newInviteToken } from "@/lib/organizer/invite-token";
import { BOT_BLOCKED_MESSAGE } from "@/lib/security/bot";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const INVITE_INVALID = "Este convite não vale mais. Peça um novo ao Espaço Byla.";
const ACCOUNT_FAILED = "Não foi possível criar a conta. Fale com o Espaço Byla.";
const TOKEN = newInviteToken();
const TOKEN_HASH = hashInviteToken(TOKEN);
const USER_ID = "00000000-0000-4000-8000-0000000000aa";

const validProfile = {
  fullName: "Fulana de Tal",
  publicName: "Produções Fulana",
  phone: "(71) 90000-0003",
  pixKeyType: "cpf",
  pixKey: "529.982.247-25",
  pixHolderName: "Fulana de Tal",
  pixHolderDocument: "529.982.247-25",
};

type RpcReplies = Record<string, { data?: unknown; error?: { message: string } | null }>;

/** Banco respondendo: limite liberado e cada função com a resposta indicada. */
function database(replies: RpcReplies = {}, limit: boolean | "erro" = true) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "consume_rate_limit") {
      return limit === "erro" ? { data: null, error: { message: "fora do ar" } } : { data: limit, error: null };
    }
    const reply = replies[fn];
    if (reply) return { data: reply.data ?? null, error: reply.error ?? null };
    return { data: null, error: { message: "inesperado" } };
  });
}

function calls(fn: string) {
  return mocks.rpc.mock.calls.filter(([name]) => name === fn);
}

function humanCheckReplies(body: Record<string, unknown>) {
  vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo-de-teste");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "chave-publica");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function expectNoPlainToken() {
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(TOKEN);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.areaEnabled.mockResolvedValue(true);
  mocks.sendLoginCodeEmail.mockResolvedValue("sent");
  mocks.createUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
  mocks.alertTeamOrphanAccount.mockResolvedValue(undefined);
  database();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checkInvite", () => {
  it.each([["vazio", ""], ["curto", "abc"], ["com caractere estranho", `${"a".repeat(42)}!`], ["não texto", 42]])(
    "token fora do formato (%s) recusa sem chamar o banco",
    async (_caso, token) => {
      expect(await checkInvite(token as string)).toEqual({ ok: false, error: INVITE_INVALID });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("com a área desligada recusa sem chamar o banco", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    expect(await checkInvite(TOKEN)).toEqual({ ok: false, error: "Esta área está indisponível no momento." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("acima do limite por IP não consulta o convite; a chave do limite é o hash do IP", async () => {
    database({ check_organizer_invite: { data: "valido" } }, false);
    expect(await checkInvite(TOKEN)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(calls("check_organizer_invite")).toHaveLength(0);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "invite-check:ip",
      p_key_hash: hashRateLimitKey("203.0.113.7"),
      p_limit: 20,
      p_window_seconds: 3600,
    });
  });

  it("falha ao consultar o limite bloqueia (falha fechada)", async () => {
    database({ check_organizer_invite: { data: "valido" } }, "erro");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkInvite(TOKEN)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(calls("check_organizer_invite")).toHaveLength(0);
  });

  it("convite inválido no banco volta com a mensagem genérica", async () => {
    database({ check_organizer_invite: { data: "invalido" } });
    expect(await checkInvite(TOKEN)).toEqual({ ok: false, error: INVITE_INVALID });
  });

  it("erro do banco também volta genérico", async () => {
    database({ check_organizer_invite: { error: { message: "relation does not exist" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkInvite(TOKEN)).toEqual({ ok: false, error: INVITE_INVALID });
  });

  it("convite válido: o banco recebe só o hash do token", async () => {
    database({ check_organizer_invite: { data: "valido" } });
    expect(await checkInvite(TOKEN)).toEqual({ ok: true, data: { valid: true } });
    expect(mocks.rpc).toHaveBeenCalledWith("check_organizer_invite", { p_token_hash: TOKEN_HASH });
    expectNoPlainToken();
  });
});

describe("sendInviteEmailCode", () => {
  it("token fora do formato recusa sem anti-robô nem banco", async () => {
    const fetchMock = humanCheckReplies({ success: true, action: "org_invite" });
    expect(await sendInviteEmailCode("x", "fulana@exemplo.com", "humano")).toEqual({ ok: false, error: INVITE_INVALID });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("e-mail inválido volta com a mensagem do campo, antes do anti-robô", async () => {
    const fetchMock = humanCheckReplies({ success: true, action: "org_invite" });
    expect(await sendInviteEmailCode(TOKEN, "fulana@", "humano")).toEqual({ ok: false, error: "Informe um e-mail válido." });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("anti-robô recusando não chega ao banco nem manda e-mail", async () => {
    humanCheckReplies({ success: false });
    expect(await sendInviteEmailCode(TOKEN, "fulana@exemplo.com", "humano")).toEqual({ ok: false, error: BOT_BLOCKED_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it("token anti-robô de outra ação é recusado", async () => {
    humanCheckReplies({ success: true, action: "org_request" });
    expect(await sendInviteEmailCode(TOKEN, "fulana@exemplo.com", "humano")).toEqual({ ok: false, error: BOT_BLOCKED_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("acima do limite por IP não gera código", async () => {
    humanCheckReplies({ success: true, action: "org_invite" });
    database({ start_invite_email_code: { data: "ok" } }, false);
    expect(await sendInviteEmailCode(TOKEN, "fulana@exemplo.com", "humano")).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(calls("start_invite_email_code")).toHaveLength(0);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", expect.objectContaining({ p_bucket: "invite-code:ip", p_limit: 10 }));
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["limite", "Você já pediu 3 códigos para este convite. Peça um novo convite ao Espaço Byla."],
    ["email_indisponivel", "Este e-mail não pode ser usado. Use outro e-mail ou fale com o Espaço Byla."],
    ["invalido", INVITE_INVALID],
  ])("status %s do banco vira mensagem e não manda e-mail", async (status, message) => {
    database({ start_invite_email_code: { data: status } });
    expect(await sendInviteEmailCode(TOKEN, "fulana@exemplo.com", "humano")).toEqual({ ok: false, error: message });
    expect(mocks.sendLoginCodeEmail).not.toHaveBeenCalled();
  });

  it("ok: guarda o código pelo hash do convite e manda o mesmo código ao e-mail digitado, para cadastro", async () => {
    database({ start_invite_email_code: { data: "ok" } });
    const log = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");

    expect(await sendInviteEmailCode(TOKEN, "  Fulana@Exemplo.com ", "humano")).toEqual({ ok: true, data: undefined });

    const [[, args]] = calls("start_invite_email_code") as [[string, { p_token_hash: string; p_email: string; p_code: string }]];
    expect(args.p_token_hash).toBe(TOKEN_HASH);
    expect(args.p_email).toBe("fulana@exemplo.com");
    expect(args.p_code).toMatch(/^[0-9]{6}$/);
    expect(mocks.sendLoginCodeEmail).toHaveBeenCalledWith({ to: "fulana@exemplo.com", code: args.p_code, purpose: "cadastro" });
    expectNoPlainToken();
    const logged = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain(args.p_code);
    expect(logged).not.toContain("fulana@exemplo.com");
  });

  it.each(["failed", "quota", "skipped"])("envio do e-mail %s volta com a mensagem de tentar de novo", async (outcome) => {
    database({ start_invite_email_code: { data: "ok" } });
    mocks.sendLoginCodeEmail.mockResolvedValue(outcome);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendInviteEmailCode(TOKEN, "fulana@exemplo.com", "humano")).toEqual({
      ok: false,
      error: "Não conseguimos enviar o código agora. Tente de novo em alguns minutos.",
    });
  });
});

describe("verifyInviteEmailCode", () => {
  it("token fora do formato recusa sem banco", async () => {
    expect(await verifyInviteEmailCode("curto", "123456")).toEqual({ ok: false, error: INVITE_INVALID });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("código que não tem 6 números não chega ao banco", async () => {
    expect(await verifyInviteEmailCode(TOKEN, "12a456")).toEqual({ ok: false, error: "Digite os 6 números do código." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("acima do limite por IP não confere", async () => {
    database({ verify_invite_email_code: { data: "ok" } }, false);
    expect(await verifyInviteEmailCode(TOKEN, "123456")).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(calls("verify_invite_email_code")).toHaveLength(0);
  });

  it("normaliza o código (espaços e traço) e manda só o hash do convite", async () => {
    database({ verify_invite_email_code: { data: "ok" } });
    expect(await verifyInviteEmailCode(TOKEN, " 123-456 ")).toEqual({ ok: true, data: undefined });
    expect(mocks.rpc).toHaveBeenCalledWith("verify_invite_email_code", { p_token_hash: TOKEN_HASH, p_code: "123456" });
    expectNoPlainToken();
  });

  it.each([
    ["invalido", "Código incorreto. Confira os números e tente de novo."],
    ["expirado", "Este código venceu. Toque em “Reenviar código”."],
    ["bloqueado", "Muitas tentativas erradas. Toque em “Reenviar código” para receber outro."],
    ["convite_invalido", INVITE_INVALID],
    ["desconhecido", "Não foi possível continuar agora. Tente de novo em alguns minutos."],
  ])("status %s vira mensagem própria", async (status, message) => {
    database({ verify_invite_email_code: { data: status } });
    expect(await verifyInviteEmailCode(TOKEN, "123456")).toEqual({ ok: false, error: message });
  });
});

describe("completeOrganizerSignup", () => {
  const input = { profile: validProfile, password: "senha-bem-comprida", termsAccepted: true };

  function happyDatabase(overrides: RpcReplies = {}) {
    database({
      invite_verified_email: { data: "fulana@exemplo.com" },
      accept_organizer_invite: { data: null },
      ...overrides,
    });
  }

  it("token fora do formato recusa sem banco", async () => {
    expect(await completeOrganizerSignup("x", input)).toEqual({ ok: false, error: INVITE_INVALID });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it.each([false, "on", undefined])("termos não aceitos (%s) recusam sem banco", async (termsAccepted) => {
    happyDatabase();
    const result = await completeOrganizerSignup(TOKEN, { ...input, termsAccepted: termsAccepted as boolean });
    expect(result).toEqual({ ok: false, error: "Marque que leu e aceita os Termos do organizador e a Política de Privacidade." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("perfil inválido volta com a mensagem do campo", async () => {
    happyDatabase();
    const result = await completeOrganizerSignup(TOKEN, { ...input, profile: { ...validProfile, pixHolderDocument: "111.111.111-11" } });
    expect(result).toEqual({ ok: false, error: "Confira o CPF ou CNPJ do titular." });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("senha curta volta com a mensagem do campo", async () => {
    happyDatabase();
    expect(await completeOrganizerSignup(TOKEN, { ...input, password: "curta" })).toEqual({
      ok: false,
      error: "A senha precisa ter pelo menos 12 caracteres.",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("acima do limite por IP não cria conta", async () => {
    database({ invite_verified_email: { data: "fulana@exemplo.com" } }, false);
    expect(await completeOrganizerSignup(TOKEN, input)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", expect.objectContaining({ p_bucket: "invite-complete:ip", p_limit: 10 }));
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("e-mail ainda não confirmado: pede o código e não cria conta", async () => {
    happyDatabase({ invite_verified_email: { data: null } });
    expect(await completeOrganizerSignup(TOKEN, input)).toEqual({
      ok: false,
      error: "Confirme o e-mail com o código antes de continuar.",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("cria a conta com o e-mail do banco (não do navegador), já confirmado e sem dados pessoais", async () => {
    happyDatabase();
    const sneaky = { ...input, email: "outra@exemplo.com", profile: { ...validProfile, email: "outra@exemplo.com" } };

    expect(await completeOrganizerSignup(TOKEN, sneaky as typeof input)).toEqual({ ok: true, data: { email: "fulana@exemplo.com" } });

    expect(mocks.rpc).toHaveBeenCalledWith("invite_verified_email", { p_token_hash: TOKEN_HASH });
    expect(mocks.createUser).toHaveBeenCalledTimes(1);
    const [attributes] = mocks.createUser.mock.calls[0] as [Record<string, unknown>];
    expect(attributes).toEqual({ email: "fulana@exemplo.com", password: "senha-bem-comprida", email_confirm: true });
    expect(attributes).not.toHaveProperty("user_metadata");
    expect(mocks.rpc).toHaveBeenCalledWith("accept_organizer_invite", {
      p_token_hash: TOKEN_HASH,
      p_user_id: USER_ID,
      p_full_name: "Fulana de Tal",
      p_public_name: "Produções Fulana",
      p_phone: "71900000003",
      p_pix_key_type: "cpf",
      p_pix_key: "52998224725",
      p_pix_holder_name: "Fulana de Tal",
      p_pix_holder_document: "52998224725",
      p_terms_version: ORGANIZER_TERMS_VERSION,
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expectNoPlainToken();
  });

  it("createUser falha: mensagem genérica e nada de aceitar o convite", async () => {
    happyDatabase();
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { message: "A user with this email address has already been registered", status: 422 } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await completeOrganizerSignup(TOKEN, input)).toEqual({ ok: false, error: ACCOUNT_FAILED });
    expect(calls("accept_organizer_invite")).toHaveLength(0);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("fulana@exemplo.com");
  });

  it.each([
    "ORG_CONVITE: Convite inválido.",
    "ORG_EMAIL: E-mail da conta diferente do confirmado.",
    "ORG_DADOS: Dados inválidos.",
    "deadlock detected",
  ])("accept falha (%s): apaga a conta recém-criada e mostra mensagem genérica", async (dbMessage) => {
    happyDatabase({ accept_organizer_invite: { error: { message: dbMessage } } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await completeOrganizerSignup(TOKEN, input)).toEqual({ ok: false, error: ACCOUNT_FAILED });
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(mocks.alertTeamOrphanAccount).not.toHaveBeenCalled();
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of ["fulana@exemplo.com", "52998224725", TOKEN, "senha-bem-comprida"]) expect(logged).not.toContain(secret);
  });

  it.each([
    ["apagar responde com erro", () => mocks.deleteUser.mockResolvedValue({ data: null, error: { message: "fora do ar" } })],
    ["apagar lança", () => mocks.deleteUser.mockRejectedValue(new Error("rede caiu"))],
  ])("accept falha e %s: avisa a equipe só com o código da conta e mostra a mensagem genérica", async (_name, failDelete) => {
    happyDatabase({ accept_organizer_invite: { error: { message: "ORG_DADOS: Dados inválidos." } } });
    failDelete();
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await completeOrganizerSignup(TOKEN, input)).toEqual({ ok: false, error: ACCOUNT_FAILED });
    expect(mocks.deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(mocks.alertTeamOrphanAccount).toHaveBeenCalledTimes(1);
    expect(mocks.alertTeamOrphanAccount).toHaveBeenCalledWith(expect.anything(), USER_ID);
    const sent = JSON.stringify(mocks.alertTeamOrphanAccount.mock.calls[0].slice(1));
    for (const secret of ["fulana@exemplo.com", "Fulana", "52998224725", TOKEN]) expect(sent).not.toContain(secret);
  });

  it("aviso à equipe que falha não muda a resposta (mensagem genérica)", async () => {
    happyDatabase({ accept_organizer_invite: { error: { message: "ORG_DADOS: Dados inválidos." } } });
    mocks.deleteUser.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    mocks.alertTeamOrphanAccount.mockRejectedValue(new Error("alerta caiu"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await completeOrganizerSignup(TOKEN, input)).toEqual({ ok: false, error: ACCOUNT_FAILED });
    expect(mocks.alertTeamOrphanAccount).toHaveBeenCalledTimes(1);
    // A falha do aviso fica dentro do cadastro: não chega a virar "erro inesperado" da ação.
    expect(log).not.toHaveBeenCalledWith("[acao] Erro inesperado.", expect.anything());
  });
});

describe("página /convite", () => {
  it("com a área desligada responde 404", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    await expect(InvitePage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("não aparece em buscadores", () => {
    expect(inviteMetadata.robots).toMatchObject({ index: false });
  });

  it("com a área ligada mostra o cadastro sem citar fornecedores", async () => {
    const html = renderToStaticMarkup(await InvitePage());
    expect(html).toContain("Conferindo o convite");
    for (const word of ["mercado pago", "supabase", "vercel", "resend", "cloudflare", "turnstile", "google"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });
});

describe("cabeçalhos", () => {
  async function headersFor(path: string) {
    const rules = (await nextConfig.headers?.()) ?? [];
    const result = new Map<string, string>();
    for (const rule of rules) {
      const matches = rule.source === "/:path*" || rule.source === path;
      if (matches) for (const header of rule.headers) result.set(header.key, header.value);
    }
    return result;
  }

  it.each(["/convite", "/redefinir-senha"])("%s não manda Referer para outros sites", async (path) => {
    expect((await headersFor(path)).get("Referrer-Policy")).toBe("no-referrer");
  });

  it("o resto do site mantém a política de sempre", async () => {
    expect((await headersFor("/eventos")).get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
