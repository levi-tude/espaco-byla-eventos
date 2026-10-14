import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  revalidatePath: vi.fn(),
  notifyOrganizer: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  organizerNoticeLink: (path: string) => `https://ingressos.exemplo.test${path}`,
}));

import {
  archiveSignupRequest,
  createInvite,
  createPasswordResetLink,
  forgetAccountDevices,
  revokeInvite,
  setOrganizerStatus,
} from "@/app/equipe/organizadores/actions";
import { InviteCreatedDialog } from "@/components/equipe/InviteCreatedDialog";
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000aa";
const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const INVITE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const APP_URL = "https://ingressos.exemplo.test";
const DENIED = { ok: false, error: "Acesso não permitido." };

type Role = "admin" | "admin_dev" | "secretaria" | "organizador" | "anonimo";
type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null };

const SERVICE_RPCS = [
  "create_organizer_invite",
  "revoke_organizer_invite",
  "archive_signup_request",
  "set_organizer_status",
  "admin_forget_devices",
];

function as(role: Role, results: Record<string, RpcResult> = {}) {
  mocks.getUser.mockResolvedValue(
    role === "anonimo" ? { data: { user: null }, error: null } : { data: { user: { id: ADMIN_ID } }, error: null },
  );
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "is_staff") return { data: role !== "organizador", error: null };
    if (fn === "is_organizer") return { data: role === "organizador", error: null };
    return { data: null, error: { message: "inesperado" } };
  });
  mocks.adminRpc.mockImplementation(async (fn: string) => {
    if (fn === "staff_finance_role") return { data: role, error: null };
    if (fn === "list_organizers" && !results.list_organizers) {
      return { data: [{ user_id: ORGANIZER_ID, status: "ativo" }], error: null };
    }
    const result = results[fn];
    return { data: result?.data ?? null, error: result?.error ?? null };
  });
}

function serviceCalls(fn?: string) {
  return mocks.adminRpc.mock.calls.filter(([name]) => (fn ? name === fn : SERVICE_RPCS.includes(name)));
}

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

function everythingLogged(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args: unknown[]) => args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg))).join(" "))
    .join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  as("admin", { create_organizer_invite: { data: INVITE_ID } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  consoleSpies.forEach((spy) => spy.mockRestore());
});

const everyAction: [string, () => Promise<unknown>][] = [
  ["createInvite", () => createInvite({ label: "Peça de dezembro" })],
  ["revokeInvite", () => revokeInvite(INVITE_ID)],
  ["archiveSignupRequest", () => archiveSignupRequest(REQUEST_ID)],
  ["setOrganizerStatus", () => setOrganizerStatus(ORGANIZER_ID, "suspenso", "Conta usada por outra pessoa.")],
  ["forgetAccountDevices", () => forgetAccountDevices(ORGANIZER_ID)],
  ["createPasswordResetLink", () => createPasswordResetLink(ORGANIZER_ID)],
];

describe("acesso: só o Admin da equipe", () => {
  it.each(everyAction)("%s recusa secretaria, organizador e quem não entrou", async (_name, run) => {
    for (const role of ["secretaria", "organizador", "anonimo"] as const) {
      vi.clearAllMocks();
      as(role);
      expect(await run()).toEqual(DENIED);
      expect(serviceCalls()).toHaveLength(0);
      expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    }
  });

  it.each(everyAction)("%s aceita o Admin desenvolvedor", async (_name, run) => {
    as("admin_dev", {
      create_organizer_invite: { data: INVITE_ID },
      revoke_organizer_invite: { data: true },
      archive_signup_request: { data: true },
      admin_forget_devices: { data: 1 },
    });
    expect(await run()).toMatchObject({ ok: true });
  });
});

describe("createInvite", () => {
  it("gera o token no servidor, manda só o hash ao banco e devolve o link uma vez", async () => {
    const result = await createInvite({ label: "  Peça de dezembro  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const prefix = `${APP_URL}/convite#`;
    expect(result.data.link.startsWith(prefix)).toBe(true);
    const token = result.data.link.slice(prefix.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const calls = serviceCalls("create_organizer_invite");
    expect(calls).toHaveLength(1);
    const args = calls[0][1] as Record<string, unknown>;
    expect(args).toEqual({
      p_admin: ADMIN_ID,
      p_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
      p_kind: "convite",
      p_label: "Peça de dezembro",
      p_request_id: null,
      p_target_user_id: null,
    });
    expect(JSON.stringify(mocks.adminRpc.mock.calls)).not.toContain(token);

    expect(result.data.whatsappUrl.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(result.data.whatsappUrl.slice("https://wa.me/?text=".length));
    expect(text).toContain("O link vale por 7 dias e só pode ser usado uma vez:");
    expect(text).toContain(result.data.link);

    const days = (new Date(result.data.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    expect(everythingLogged()).not.toContain(token);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/organizadores");
  });

  it("cada convite tem um token novo", async () => {
    const first = await createInvite({ label: "" });
    const second = await createInvite({ label: "" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.link).not.toBe(second.data.link);
  });

  it("apelido vazio vai como nulo; pedido do site vai junto", async () => {
    expect(await createInvite({ label: "   ", requestId: REQUEST_ID })).toMatchObject({ ok: true });
    expect(serviceCalls("create_organizer_invite")[0][1]).toMatchObject({ p_label: null, p_request_id: REQUEST_ID });
  });

  it("apelido com até 80 caracteres passa; com 81 é recusado sem chamar o banco", async () => {
    expect(await createInvite({ label: "a".repeat(80) })).toMatchObject({ ok: true });
    vi.clearAllMocks();
    as("admin");
    expect(await createInvite({ label: "a".repeat(81) })).toEqual({
      ok: false,
      error: "O apelido pode ter até 80 caracteres.",
    });
    expect(serviceCalls()).toHaveLength(0);
  });

  it.each([
    ["pedido inválido", { label: "", requestId: "pedido-1" }],
    ["pedido numérico", { label: "", requestId: 42 }],
    ["apelido não texto", { label: 42 }],
    ["entrada nula", null],
  ])("%s → recusado sem chamar o banco", async (_label, input) => {
    const result = await createInvite(input as never);
    expect(result.ok).toBe(false);
    expect(serviceCalls()).toHaveLength(0);
  });

  it("ORG_LIMITE → mensagem de limite de tentativas", async () => {
    as("admin", { create_organizer_invite: { error: { message: "ORG_LIMITE: Limite de convites do dia atingido.", code: "P0001" } } });
    expect(await createInvite({ label: "" })).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
  });

  it("erro do banco → mensagem do Admin, sem texto cru e sem token nos registros", async () => {
    as("admin", { create_organizer_invite: { error: { message: "ORG_CONVITE: Pedido não encontrado.", code: "P0001" } } });
    const result = await createInvite({ label: "", requestId: REQUEST_ID });
    expect(result).toEqual({ ok: false, error: "Não foi possível gerar o convite. Confira os dados e tente de novo." });
    const sentHash = (serviceCalls("create_organizer_invite")[0][1] as { p_token_hash: string }).p_token_hash;
    expect(everythingLogged()).not.toContain(sentHash);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sem o endereço do site configurado → recusa antes de gravar o convite", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const result = await createInvite({ label: "" });
    expect(result.ok).toBe(false);
    expect(serviceCalls()).toHaveLength(0);
  });
});

describe("revokeInvite", () => {
  it.each([["vazio", ""], ["texto", "convite-1"], ["nulo", null]])("ID inválido (%s) → sem chamar o banco", async (_l, id) => {
    expect(await revokeInvite(id as string)).toEqual({ ok: false, error: "Convite não encontrado." });
    expect(serviceCalls()).toHaveLength(0);
  });

  it("revoga com o Admin que age", async () => {
    as("admin", { revoke_organizer_invite: { data: true } });
    expect(await revokeInvite(INVITE_ID)).toEqual({ ok: true, data: undefined });
    expect(serviceCalls("revoke_organizer_invite")).toEqual([
      ["revoke_organizer_invite", { p_admin: ADMIN_ID, p_invite_id: INVITE_ID }],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/organizadores");
  });

  it("convite que já não está ativo → aviso", async () => {
    as("admin", { revoke_organizer_invite: { data: false } });
    expect(await revokeInvite(INVITE_ID)).toEqual({
      ok: false,
      error: "Este convite já não está ativo. Atualize a página.",
    });
  });
});

describe("archiveSignupRequest", () => {
  it("ID inválido → sem chamar o banco", async () => {
    expect(await archiveSignupRequest("x")).toEqual({ ok: false, error: "Pedido não encontrado." });
    expect(serviceCalls()).toHaveLength(0);
  });

  it("arquiva com o Admin que age", async () => {
    as("admin", { archive_signup_request: { data: true } });
    expect(await archiveSignupRequest(REQUEST_ID)).toEqual({ ok: true, data: undefined });
    expect(serviceCalls("archive_signup_request")).toEqual([
      ["archive_signup_request", { p_admin: ADMIN_ID, p_id: REQUEST_ID }],
    ]);
  });

  it("pedido já arquivado → aviso", async () => {
    as("admin", { archive_signup_request: { data: false } });
    expect(await archiveSignupRequest(REQUEST_ID)).toEqual({
      ok: false,
      error: "Este pedido já foi arquivado. Atualize a página.",
    });
  });
});

describe("setOrganizerStatus", () => {
  it("ID inválido → sem chamar o banco", async () => {
    expect(await setOrganizerStatus("conta", "suspenso", "Motivo suficiente")).toEqual({
      ok: false,
      error: "Conta não encontrada.",
    });
    expect(serviceCalls()).toHaveLength(0);
  });

  it("situação desconhecida → recusada sem chamar o banco", async () => {
    const result = await setOrganizerStatus(ORGANIZER_ID, "apagado" as never, "Motivo suficiente");
    expect(result.ok).toBe(false);
    expect(serviceCalls()).toHaveLength(0);
  });

  it.each([["sem motivo", ""], ["só espaços", "    "], ["curto", "abc"], ["longo", "a".repeat(501)], ["não texto", 5]])(
    "suspender %s → erro sem chamar o banco nem avisar",
    async (_l, reason) => {
      expect(await setOrganizerStatus(ORGANIZER_ID, "suspenso", reason as string)).toEqual({
        ok: false,
        error: "Escreva o motivo (de 5 a 500 caracteres).",
      });
      expect(serviceCalls()).toHaveLength(0);
      expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    },
  );

  it("encerrar também exige motivo", async () => {
    expect((await setOrganizerStatus(ORGANIZER_ID, "encerrado", "")).ok).toBe(false);
    expect(serviceCalls()).toHaveLength(0);
  });

  it("suspende com motivo e avisa o organizador", async () => {
    expect(await setOrganizerStatus(ORGANIZER_ID, "suspenso", "  Conta usada por outra pessoa.  ")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(serviceCalls("set_organizer_status")).toEqual([
      [
        "set_organizer_status",
        { p_admin: ADMIN_ID, p_user_id: ORGANIZER_ID, p_status: "suspenso", p_reason: "Conta usada por outra pessoa." },
      ],
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_conta_suspensa",
      expect.objectContaining({ note: "Conta usada por outra pessoa.", link: expect.any(String) }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/organizadores");
  });

  it("reativar não exige motivo e não manda aviso de suspensão", async () => {
    expect(await setOrganizerStatus(ORGANIZER_ID, "ativo", "")).toEqual({ ok: true, data: undefined });
    expect(serviceCalls("set_organizer_status")[0][1]).toMatchObject({ p_status: "ativo", p_reason: null });
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it("conta que já estava suspensa → não manda o aviso de novo", async () => {
    as("admin", { list_organizers: { data: [{ user_id: ORGANIZER_ID, status: "suspenso" }] } });
    expect(await setOrganizerStatus(ORGANIZER_ID, "suspenso", "Outro motivo qualquer")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(serviceCalls("list_organizers")).toEqual([["list_organizers", { p_admin: ADMIN_ID }]]);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it("falha ao ler a situação atual → nada muda, nenhum aviso e só o código no registro", async () => {
    as("admin", { list_organizers: { error: { message: "falha qualquer", code: "XX000" } } });
    expect(await setOrganizerStatus(ORGANIZER_ID, "suspenso", "Motivo suficiente")).toEqual({
      ok: false,
      error: "Não foi possível mudar a situação da conta. Tente de novo.",
    });
    expect(serviceCalls("set_organizer_status")).toHaveLength(0);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(everythingLogged()).toContain("XX000");
    expect(everythingLogged()).not.toContain(ORGANIZER_ID);
  });

  it("conta fora da lista → conta não encontrada, sem mudar nada", async () => {
    as("admin", { list_organizers: { data: [] } });
    expect(await setOrganizerStatus(ORGANIZER_ID, "suspenso", "Motivo suficiente")).toEqual({
      ok: false,
      error: "Conta não encontrada.",
    });
    expect(serviceCalls("set_organizer_status")).toHaveLength(0);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it("falha do banco → mensagem genérica e nenhum aviso", async () => {
    as("admin", { set_organizer_status: { error: { message: "ORG_DADOS: Organizador não encontrado.", code: "P0001" } } });
    const result = await setOrganizerStatus(ORGANIZER_ID, "suspenso", "Motivo suficiente");
    expect(result.ok).toBe(false);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });
});

describe("forgetAccountDevices", () => {
  it("ID inválido → sem chamar o banco", async () => {
    expect(await forgetAccountDevices("")).toEqual({ ok: false, error: "Conta não encontrada." });
    expect(serviceCalls()).toHaveLength(0);
  });

  it("esquece os aparelhos da conta e devolve quantos", async () => {
    as("admin", { admin_forget_devices: { data: 2 } });
    expect(await forgetAccountDevices(ORGANIZER_ID)).toEqual({ ok: true, data: { forgotten: 2 } });
    expect(serviceCalls("admin_forget_devices")).toEqual([
      ["admin_forget_devices", { p_admin: ADMIN_ID, p_user_id: ORGANIZER_ID }],
    ]);
  });
});

describe("createPasswordResetLink", () => {
  it("ID inválido → sem chamar o banco", async () => {
    expect(await createPasswordResetLink("abc")).toEqual({ ok: false, error: "Conta não encontrada." });
    expect(serviceCalls()).toHaveLength(0);
  });

  it("gera link de uso único para a conta, só o hash no banco, sem registrar o token", async () => {
    const result = await createPasswordResetLink(ORGANIZER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prefix = `${APP_URL}/redefinir-senha#`;
    expect(result.data.link.startsWith(prefix)).toBe(true);
    const token = result.data.link.slice(prefix.length);

    expect(serviceCalls("create_organizer_invite")[0][1]).toEqual({
      p_admin: ADMIN_ID,
      p_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
      p_kind: "redefinir_senha",
      p_label: null,
      p_request_id: null,
      p_target_user_id: ORGANIZER_ID,
    });
    const text = decodeURIComponent(result.data.whatsappUrl.slice("https://wa.me/?text=".length));
    expect(result.data.whatsappUrl.startsWith("https://wa.me/?text=")).toBe(true);
    expect(text).toContain("nova senha");
    expect(text).toContain("24 horas");
    expect(text).toContain(result.data.link);
    expect(everythingLogged()).not.toContain(token);
  });

  it("ORG_LIMITE → mensagem de limite de tentativas", async () => {
    as("admin", { create_organizer_invite: { error: { message: "ORG_LIMITE: Limite de convites do dia atingido." } } });
    expect(await createPasswordResetLink(ORGANIZER_ID)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
  });

  it("conta que não está ativa → aviso claro", async () => {
    as("admin", { create_organizer_invite: { error: { message: "ORG_CONVITE: Organizador não está ativo." } } });
    expect(await createPasswordResetLink(ORGANIZER_ID)).toEqual({
      ok: false,
      error: "Esta conta não está ativa. Reative a conta antes de gerar o link.",
    });
  });
});

describe("InviteCreatedDialog", () => {
  it("mostra o link uma vez, com copiar, WhatsApp e o aviso", () => {
    const link = `${APP_URL}/convite#${"c".repeat(43)}`;
    const html = renderToStaticMarkup(
      createElement(InviteCreatedDialog, {
        title: "Convite gerado",
        link,
        whatsappUrl: `https://wa.me/?text=${encodeURIComponent(link)}`,
        expiresAt: "2026-10-21T15:00:00Z",
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain("Este link aparece só agora. Se perder, revogue e gere outro.");
    expect(html).toContain("Copiar link");
    expect(html).toContain("Enviar pelo WhatsApp");
    expect(html).toContain('href="https://wa.me/?text=');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(link);
    expect(html).toContain("21/10/2026");
  });
});
