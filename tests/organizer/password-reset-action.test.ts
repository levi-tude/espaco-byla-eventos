import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  updateUserById: vi.fn(),
  from: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  alertTeamSetup: vi.fn(),
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

import { requestPasswordResetLink, resetPasswordWithLink } from "@/app/redefinir-senha/actions";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  RESET_REQUEST_FLOOR_MS,
  RESET_RPC_TIMEOUT_MS,
  RESET_SEND_TIMEOUT_MS,
} from "@/app/redefinir-senha/constants";
import ResetPasswordPage, { metadata as resetMetadata } from "@/app/redefinir-senha/page";
import { hashInviteToken, newInviteToken } from "@/lib/organizer/invite-token";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const LINK_INVALID = "Este link não vale mais. Peça um novo à ACDH Eventos.";
const TOKEN = newInviteToken();
const USER_ID = "00000000-0000-4000-8000-0000000000bb";
const PASSWORD = "Outra frase comprida 47";
const EMAIL = "pessoa@exemplo.com";

function withAbortSignal<T extends PromiseLike<unknown>>(promise: T) {
  return Object.assign(promise, {
    abortSignal() {
      return this;
    },
  });
}

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
  requestNever = false,
}: {
  limit?: boolean;
  requestLimit?: boolean;
  reset?: { data?: unknown; error?: { message: string; code?: string } };
  request?: { data?: unknown; error?: { message?: string; code?: string } | null };
  requestNever?: boolean;
} = {}) {
  mocks.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
    mocks.order.push(fn);
    if (fn === "consume_rate_limit") {
      const bucket = String(args?.p_bucket ?? "");
      if (bucket.startsWith("password-reset-request:")) {
        return withAbortSignal(Promise.resolve({ data: requestLimit, error: null }));
      }
      return withAbortSignal(Promise.resolve({ data: limit, error: null }));
    }
    if (fn === "request_password_reset_link") {
      if (requestNever) return withAbortSignal(new Promise(() => {}));
      return withAbortSignal(
        Promise.resolve({
          data: request?.data ?? [],
          error: request?.error === undefined ? null : request.error,
        }),
      );
    }
    if (fn === "use_password_reset_invite") {
      return withAbortSignal(
        Promise.resolve({ data: reset?.data ?? USER_ID, error: reset?.error ?? null }),
      );
    }
    return withAbortSignal(Promise.resolve({ data: null, error: { message: "inesperado" } }));
  });
}

async function expectPendingUntilFloor(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.advanceTimersByTimeAsync(RESET_REQUEST_FLOOR_MS - 1);
  await Promise.resolve();
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await promise;
  expect(settled).toBe(true);
}

function spyAllConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };
}

function assertNoSecretsInConsole(spies: ReturnType<typeof spyAllConsole>, secrets: string[]) {
  const dumped = JSON.stringify(
    Object.values(spies).flatMap((spy) => spy.mock.calls),
  );
  for (const secret of secrets) {
    expect(dumped).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("constantes do piso", () => {
  it("orçamento 1500 + 2000 = 3500 < 4000", () => {
    expect(RESET_REQUEST_FLOOR_MS).toBe(4000);
    expect(RESET_RPC_TIMEOUT_MS).toBe(1500);
    expect(RESET_SEND_TIMEOUT_MS).toBe(2000);
    expect(RESET_RPC_TIMEOUT_MS + RESET_SEND_TIMEOUT_MS).toBeLessThan(RESET_REQUEST_FLOOR_MS);
  });
});

describe("requestPasswordResetLink", () => {
  it("e-mail inexistente: resposta em 4000 ms, mesma mensagem, sem envio", async () => {
    database({ request: { data: [] } });
    const promise = requestPasswordResetLink(EMAIL);
    await expectPendingUntilFloor(promise);
    expect(await promise).toEqual({ ok: true, data: undefined });
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("conta existe: envia 1 vez, só hash no RPC, resposta em 4000 ms", async () => {
    database({ request: { data: [{ user_id: USER_ID, email: EMAIL }] } });
    const spies = spyAllConsole();
    const promise = requestPasswordResetLink(`  ${EMAIL.toUpperCase()} `);
    await expectPendingUntilFloor(promise);
    expect(await promise).toEqual({ ok: true, data: undefined });
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
    assertNoSecretsInConsole(spies, [EMAIL, token, link]);
  });

  it("RPC que nunca resolve: resposta em 4000 ms com a mesma mensagem", async () => {
    database({ requestNever: true });
    const promise = requestPasswordResetLink(EMAIL);
    await expectPendingUntilFloor(promise);
    expect(await promise).toEqual({ ok: true, data: undefined });
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["403", "failed", "403"],
    ["500", "failed", "500"],
    ["cota 429", "quota", "429"],
    ["rede", "failed", "rede"],
  ] as const)(
    "Resend %s: mesma mensagem em 4000 ms + alerta",
    async (_caso, sent, detail) => {
      database({ request: { data: [{ user_id: USER_ID, email: EMAIL }] } });
      mocks.sendPasswordResetEmail.mockImplementation(async () => {
        await mocks.alertTeamSetup({}, "senha_email_falhou", `status ${detail}`);
        return sent;
      });
      const promise = requestPasswordResetLink(EMAIL);
      await expectPendingUntilFloor(promise);
      expect(await promise).toEqual({ ok: true, data: undefined });
      expect(mocks.alertTeamSetup).toHaveBeenCalledWith(
        expect.anything(),
        "senha_email_falhou",
        expect.stringContaining(detail),
      );
    },
  );

  it("alerta que nunca resolve: resposta ainda sai em 4000 ms", async () => {
    database({
      request: { data: null, error: { code: "PGRST202", message: "function not found" } },
    });
    mocks.alertTeamSetup.mockImplementation(() => new Promise(() => {}));
    const promise = requestPasswordResetLink(EMAIL);
    await expectPendingUntilFloor(promise);
    expect(await promise).toEqual({ ok: true, data: undefined });
  });

  it("limite por IP: RATE_LIMIT_MESSAGE em 4000 ms", async () => {
    database({ requestLimit: false });
    const promise = requestPasswordResetLink(EMAIL);
    await expectPendingUntilFloor(promise);
    expect(await promise).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "password-reset-request:ip",
      p_key_hash: hashRateLimitKey("203.0.113.9"),
      p_limit: 5,
      p_window_seconds: 3600,
    });
    expect(mocks.order).not.toContain("request_password_reset_link");
  });

  it("limite por e-mail: RATE_LIMIT_MESSAGE em 4000 ms", async () => {
    mocks.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
      mocks.order.push(fn);
      if (fn === "consume_rate_limit") {
        const bucket = String(args?.p_bucket ?? "");
        if (bucket === "password-reset-request:ip") {
          return withAbortSignal(Promise.resolve({ data: true, error: null }));
        }
        if (bucket === "password-reset-request:email") {
          return withAbortSignal(Promise.resolve({ data: false, error: null }));
        }
      }
      return withAbortSignal(Promise.resolve({ data: null, error: { message: "inesperado" } }));
    });
    const promise = requestPasswordResetLink(EMAIL);
    await expectPendingUntilFloor(promise);
    expect(await promise).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.order).not.toContain("request_password_reset_link");
  });

  it("e-mail inválido: erro na hora, sem esperar o piso", async () => {
    const started = Date.now();
    const result = await requestPasswordResetLink("nao-e-email");
    expect(Date.now() - started).toBeLessThan(50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("nenhum console recebe e-mail, token ou link", async () => {
    database({ request: { data: [{ user_id: USER_ID, email: EMAIL }] } });
    const spies = spyAllConsole();
    const promise = requestPasswordResetLink(EMAIL);
    await expectPendingUntilFloor(promise);
    await promise;
    const link = mocks.sendPasswordResetEmail.mock.calls[0][0].link as string;
    const token = link.split("#token=")[1];
    assertNoSecretsInConsole(spies, [EMAIL, token, link]);
  });

  it("mensagem pública é a genérica", () => {
    expect(PASSWORD_RESET_REQUEST_MESSAGE).toMatch(/Se este e-mail tiver uma conta/);
  });
});

describe("resetPasswordWithLink", () => {
  it("link reutilizado volta genérico e não troca a senha", async () => {
    database({ reset: { error: { message: "ORG_CONVITE: Link inválido." } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({ ok: false, error: LINK_INVALID });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("sucesso organizador: area organizador", async () => {
    expect(await resetPasswordWithLink(TOKEN, PASSWORD)).toEqual({
      ok: true,
      data: { area: "organizador" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("use_password_reset_invite", {
      p_token_hash: hashInviteToken(TOKEN),
    });
  });

  it("sucesso equipe: area equipe", async () => {
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
  });
});
