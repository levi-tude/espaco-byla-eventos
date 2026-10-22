import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const afterCallbacks: Array<() => void | Promise<void>> = [];
  return {
    rpc: vi.fn(),
    updateUserById: vi.fn(),
    from: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    alertTeamSetup: vi.fn(),
    order: [] as string[],
    afterCallbacks,
    after: vi.fn((fn: () => void | Promise<void>) => {
      afterCallbacks.push(fn);
    }),
    async flushAfter() {
      const pending = afterCallbacks.splice(0);
      for (const cb of pending) await cb();
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => void | Promise<void>) => mocks.after(fn) }));
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
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeamSetup: mocks.alertTeamSetup }));
vi.mock("@/lib/email/send-password-reset", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    auth: { admin: { updateUserById: mocks.updateUserById } },
  }),
}));

import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  requestPasswordResetLink,
  resetPasswordWithLink,
} from "@/app/redefinir-senha/actions";
import ResetPasswordPage, { metadata as resetMetadata } from "@/app/redefinir-senha/page";
import { hashInviteToken, newInviteToken } from "@/lib/organizer/invite-token";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const LINK_INVALID = "Este link não vale mais. Peça um novo à ACDH Eventos.";
const TOKEN = newInviteToken();
const USER_ID = "00000000-0000-4000-8000-0000000000bb";
const PASSWORD = "Outra frase comprida 47";
const EMAIL = "pessoa@exemplo.com";

function staffLookup(isStaff: boolean) {
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: isStaff ? { user_id: USER_ID } : null,
          error: null,
        }),
      }),
    }),
  });
}

function database({
  limit = true,
  requestLimit = true,
  reset,
  request,
}: {
  limit?: boolean;
  requestLimit?: boolean;
  reset?: { data?: unknown; error?: { message: string; code?: string } };
  request?: { data?: unknown; error?: { message?: string; code?: string } | null };
} = {}) {
  mocks.rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    mocks.order.push(fn);
    if (fn === "consume_rate_limit") {
      const bucket = String(args?.p_bucket ?? "");
      if (bucket.startsWith("password-reset-request:")) return { data: requestLimit, error: null };
      return { data: limit, error: null };
    }
    if (fn === "request_password_reset_link") {
      return {
        data: request?.data ?? [],
        error: request?.error === undefined ? null : request.error,
      };
    }
    if (fn === "use_password_reset_invite") {
      return { data: reset?.data ?? USER_ID, error: reset?.error ?? null };
    }
    return { data: null, error: { message: "inesperado" } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.afterCallbacks.length = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://acdheventos.com.br");
  mocks.sendPasswordResetEmail.mockResolvedValue("sent");
  mocks.alertTeamSetup.mockResolvedValue(undefined);
  mocks.updateUserById.mockImplementation(async () => {
    mocks.order.push("updateUserById");
    return { data: { user: { id: USER_ID } }, error: null };
  });
  staffLookup(false);
  database();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requestPasswordResetLink", () => {
  it("responde na hora sem esperar o envio (Resend lento)", async () => {
    database({ request: { data: [{ user_id: USER_ID, email: EMAIL }] } });
    let resolveSend: (() => void) | undefined;
    mocks.sendPasswordResetEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = () => resolve("sent");
        }),
    );

    const started = Date.now();
    const result = await requestPasswordResetLink(EMAIL);
    expect(Date.now() - started).toBeLessThan(200);
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mocks.order).not.toContain("request_password_reset_link");

    const flush = mocks.flushAfter();
    await vi.waitFor(() => expect(mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1));
    resolveSend?.();
    await flush;
  });

  it("e-mail inexistente (0 linhas): mesma mensagem, sem envio", async () => {
    database({ request: { data: [] } });
    expect(await requestPasswordResetLink(EMAIL)).toEqual({ ok: true, data: undefined });
    await mocks.flushAfter();
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("request_password_reset_link", {
      p_email: EMAIL,
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("RPC devolve linha: envia uma vez com o link e só o hash no RPC", async () => {
    database({ request: { data: [{ user_id: USER_ID, email: EMAIL }] } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestPasswordResetLink(`  ${EMAIL.toUpperCase()} `)).toEqual({
      ok: true,
      data: undefined,
    });
    await mocks.flushAfter();
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [{ to, link }] = mocks.sendPasswordResetEmail.mock.calls[0];
    expect(to).toBe(EMAIL);
    expect(link).toMatch(/^https:\/\/acdheventos\.com\.br\/redefinir-senha#token=[A-Za-z0-9_-]{43}$/);
    const token = link.split("#token=")[1];
    expect(mocks.rpc).toHaveBeenCalledWith("request_password_reset_link", {
      p_email: EMAIL,
      p_token_hash: hashInviteToken(token),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it("falha no envio: mesma mensagem; log sem e-mail", async () => {
    database({ request: { data: [{ user_id: USER_ID, email: EMAIL }] } });
    mocks.sendPasswordResetEmail.mockResolvedValue("failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestPasswordResetLink(EMAIL)).toEqual({ ok: true, data: undefined });
    await mocks.flushAfter();
    expect(log.mock.calls.flat().join(" ")).not.toContain(EMAIL);
  });

  it("RPC inexistente: mesma mensagem + alerta à equipe", async () => {
    database({ request: { data: null, error: { code: "PGRST202", message: "function not found" } } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestPasswordResetLink(EMAIL)).toEqual({ ok: true, data: undefined });
    await mocks.flushAfter();
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mocks.alertTeamSetup).toHaveBeenCalledWith(
      expect.anything(),
      "senha_email_falhou",
      expect.stringContaining("PGRST202"),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(EMAIL);
  });

  it("limite por IP recusa sem agendar o after", async () => {
    database({ requestLimit: false });
    expect(await requestPasswordResetLink(EMAIL)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "password-reset-request:ip",
      p_key_hash: hashRateLimitKey("203.0.113.9"),
      p_limit: 5,
      p_window_seconds: 3600,
    });
    expect(mocks.order).not.toContain("request_password_reset_link");
  });

  it("limite por e-mail recusa sem agendar o after", async () => {
    mocks.rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      mocks.order.push(fn);
      if (fn === "consume_rate_limit") {
        const bucket = String(args?.p_bucket ?? "");
        if (bucket === "password-reset-request:ip") return { data: true, error: null };
        if (bucket === "password-reset-request:email") return { data: false, error: null };
      }
      return { data: null, error: { message: "inesperado" } };
    });
    expect(await requestPasswordResetLink(EMAIL)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "password-reset-request:email",
      p_key_hash: hashRateLimitKey(EMAIL),
      p_limit: 3,
      p_window_seconds: 3600,
    });
  });

  it("mensagem pública é a genérica", () => {
    expect(PASSWORD_RESET_REQUEST_MESSAGE).toMatch(/Se este e-mail tiver uma conta/);
  });
});

describe("resetPasswordWithLink", () => {
  it.each([["vazio", ""], ["curto", "abc"], ["não texto", null]])(
    "link fora do formato (%s) recusa sem banco",
    async (_caso, token) => {
      expect(await resetPasswordWithLink(token as string, PASSWORD)).toEqual({
        ok: false,
        error: LINK_INVALID,
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("link usado volta genérico e não troca a senha", async () => {
    database({ reset: { error: { message: "ORG_CONVITE: Link inválido." } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({ ok: false, error: LINK_INVALID });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("sucesso: usa o hash, troca a senha e indica a área", async () => {
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({
      ok: true,
      data: { area: "organizador" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("use_password_reset_invite", {
      p_token_hash: hashInviteToken(TOKEN),
    });
    expect(mocks.updateUserById).toHaveBeenCalledWith(USER_ID, { password: PASSWORD });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(TOKEN);
  });

  it("conta da equipe: devolve area equipe", async () => {
    staffLookup(true);
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({
      ok: true,
      data: { area: "equipe" },
    });
  });
});

describe("página /redefinir-senha", () => {
  it("não aparece em buscadores", () => {
    expect(resetMetadata.robots).toMatchObject({ index: false });
  });

  it("fica disponível sem depender da área do organizador", async () => {
    const html = renderToStaticMarkup(await ResetPasswordPage());
    expect(html).toContain("Digite o e-mail da conta para receber o link");
    for (const word of ["supabase", "resend", "cloudflare", "google"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });
});
