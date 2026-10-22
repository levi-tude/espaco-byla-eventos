import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  updateUserById: vi.fn(),
  areaEnabled: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }),
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
vi.mock("@/components/brand/PublicSiteHeader", () => ({ PublicSiteHeader: () => null }));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeamSetup: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    auth: { admin: { updateUserById: mocks.updateUserById } },
  }),
}));
vi.mock("@/lib/organizer/settings", () => ({
  ORGANIZER_AREA_UNAVAILABLE_MESSAGE: "Esta área está indisponível no momento.",
  ORGANIZER_AREA_TEMPORARILY_UNAVAILABLE_MESSAGE:
    "Esta área está indisponível agora. Tente de novo em instantes.",
  organizerAreaEnabled: mocks.areaEnabled,
  organizerAreaSwitchState: async () => {
    const enabled = await mocks.areaEnabled();
    if (enabled === "unknown") return "unknown";
    return enabled ? "on" : "off";
  },
}));

import { resetPasswordWithLink } from "@/app/redefinir-senha/actions";
import ResetPasswordPage, { metadata as resetMetadata } from "@/app/redefinir-senha/page";
import { hashInviteToken, newInviteToken } from "@/lib/organizer/invite-token";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const LINK_INVALID = "Este link não vale mais. Peça um novo à ACDH Eventos.";
const TOKEN = newInviteToken();
const USER_ID = "00000000-0000-4000-8000-0000000000bb";
const PASSWORD = "Outra frase comprida 47";

function database({ limit = true, reset }: { limit?: boolean; reset?: { data?: unknown; error?: { message: string } } } = {}) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    mocks.order.push(fn);
    if (fn === "consume_rate_limit") return { data: limit, error: null };
    if (fn === "use_password_reset_invite") return { data: reset?.data ?? USER_ID, error: reset?.error ?? null };
    return { data: null, error: { message: "inesperado" } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.areaEnabled.mockResolvedValue(true);
  mocks.updateUserById.mockImplementation(async () => {
    mocks.order.push("updateUserById");
    return { data: { user: { id: USER_ID } }, error: null };
  });
  database();
});

describe("resetPasswordWithLink", () => {
  it.each([["vazio", ""], ["curto", "abc"], ["não texto", null]])("link fora do formato (%s) recusa sem banco", async (_caso, token) => {
    expect(await resetPasswordWithLink(token as string, PASSWORD)).toEqual({ ok: false, error: LINK_INVALID });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("com a área desligada recusa sem banco", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({ ok: false, error: "Esta área está indisponível no momento." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("senha fraca volta com a mensagem do campo e não gasta o link", async () => {
    expect(await resetPasswordWithLink(TOKEN, "curta")).toEqual({
      ok: false,
      error: "A senha precisa ter pelo menos 12 caracteres.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["123456789123", "Use letras e números na senha."],
    ["Senha@2026!!", "Essa senha é muito comum e fácil de adivinhar. Escolha outra."],
    ["qwerty2026casa", "Evite sequências fáceis, como 12345, abcde ou qwerty."],
    ["aaaaaaaa2026", "A senha está repetitiva demais (como aaaa, 1111 ou abcabc). Misture mais letras e números."],
  ])("senha fraca (%s) não gasta o link nem troca a senha", async (password, error) => {
    expect(await resetPasswordWithLink(TOKEN, password)).toEqual({ ok: false, error });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("acima do limite por IP não usa o link", async () => {
    database({ limit: false });
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "password-reset:ip",
      p_key_hash: hashRateLimitKey("203.0.113.9"),
      p_limit: 10,
      p_window_seconds: 3600,
    });
    expect(mocks.order).not.toContain("use_password_reset_invite");
  });

  it.each(["ORG_CONVITE: Link inválido.", "ORG_ACESSO: Acesso negado.", "qualquer outra coisa"])(
    "banco recusando (%s) volta genérico e não troca a senha",
    async (message) => {
      database({ reset: { error: { message } } });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({ ok: false, error: LINK_INVALID });
      expect(mocks.updateUserById).not.toHaveBeenCalled();
    },
  );

  it("sucesso: usa o link (só o hash) e depois troca a senha da conta do link", async () => {
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({ ok: true, data: undefined });
    expect(mocks.rpc).toHaveBeenCalledWith("use_password_reset_invite", { p_token_hash: hashInviteToken(TOKEN) });
    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, { password: PASSWORD });
    expect(mocks.order).toEqual(["consume_rate_limit", "use_password_reset_invite", "updateUserById"]);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(TOKEN);
  });

  it("troca de senha falhando volta com mensagem genérica, sem a senha no log", async () => {
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: { message: "Password should be different" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({
      ok: false,
      error: "Não foi possível trocar a senha. Fale com a ACDH Eventos.",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });
});

describe("página /redefinir-senha", () => {
  it("com a área desligada responde 404", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    await expect(ResetPasswordPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("sem resposta do banco mostra indisponível em vez de 404", async () => {
    mocks.areaEnabled.mockResolvedValue("unknown");
    const html = renderToStaticMarkup(await ResetPasswordPage());
    expect(html).toContain("Esta área está indisponível agora. Tente de novo em instantes.");
    expect(html).toContain("Recarregar");
  });

  it("não aparece em buscadores", () => {
    expect(resetMetadata.robots).toMatchObject({ index: false });
  });

  it("explica o pedido de link (o formulário de senha só aparece com o token)", async () => {
    const html = renderToStaticMarkup(await ResetPasswordPage());
    expect(html).toContain("Digite o e-mail da conta para receber o link");
    for (const word of ["supabase", "resend", "cloudflare", "google"]) expect(html.toLowerCase()).not.toContain(word);
  });
});

