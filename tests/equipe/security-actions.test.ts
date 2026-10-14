import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  revalidatePath: vi.fn(),
  cookie: undefined as string | undefined,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "byla_equipe_aparelho" && mocks.cookie ? { name, value: mocks.cookie } : undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

import { forgetMyStaffDeviceAction, forgetStaffDevices } from "@/app/equipe/seguranca/actions";
import SegurancaPage from "@/app/equipe/seguranca/page";

const ME = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "11111111-1111-4111-8111-111111111111";
const ORGANIZER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const THIRD = "44444444-4444-4444-8444-444444444444";
const DEVICE_TOKEN = "a".repeat(43);

type Role = "admin" | "admin_dev" | "secretaria" | "organizador" | "anonimo";
type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null };

const TEAM_ROLES: Record<string, string> = { [ME]: "admin", [OTHER]: "secretaria", [THIRD]: "admin_dev" };

function as(role: Role, results: Record<string, RpcResult> = {}) {
  mocks.getUser.mockResolvedValue(
    role === "anonimo" ? { data: { user: null }, error: null } : { data: { user: { id: ME } }, error: null },
  );
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "is_staff") return { data: role !== "organizador" && role !== "anonimo", error: null };
    if (fn === "is_organizer") return { data: role === "organizador", error: null };
    const result = results[fn];
    if (result) return { data: result.data ?? null, error: result.error ?? null };
    return { data: null, error: { message: "inesperado" } };
  });
  mocks.adminRpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "staff_finance_role") {
      if (args.p_staff_user_id === ME) return { data: role, error: null };
      return { data: TEAM_ROLES[String(args.p_staff_user_id)] ?? null, error: null };
    }
    const result = results[fn];
    return { data: result?.data ?? null, error: result?.error ?? null };
  });
}

function adminCalls(fn: string) {
  return mocks.adminRpc.mock.calls.filter(([name]) => name === fn);
}

function userCalls(fn: string) {
  return mocks.rpc.mock.calls.filter(([name]) => name === fn);
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie = undefined;
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore());
});

describe("forgetMyStaffDeviceAction (Meus aparelhos)", () => {
  it.each(["admin", "secretaria"] as const)("%s esquece o próprio aparelho com a própria sessão", async (role) => {
    as(role, { forget_my_device: { data: true } });
    await expect(forgetMyStaffDeviceAction(DEVICE)).resolves.toEqual({ ok: true, data: undefined });
    expect(userCalls("forget_my_device")).toEqual([["forget_my_device", { p_device_id: DEVICE }]]);
    expect(adminCalls("forget_my_device")).toHaveLength(0);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/seguranca");
  });

  it.each(["organizador", "anonimo"] as const)("recusa %s", async (role) => {
    as(role, { forget_my_device: { data: true } });
    const result = await forgetMyStaffDeviceAction(DEVICE);
    expect(result.ok).toBe(false);
    expect(userCalls("forget_my_device")).toHaveLength(0);
  });

  it.each(["", "nao-e-uuid", `${DEVICE}x`, 42 as unknown as string])("recusa id inválido %s", async (id) => {
    as("secretaria", { forget_my_device: { data: true } });
    await expect(forgetMyStaffDeviceAction(id)).resolves.toEqual({ ok: false, error: "Aparelho não encontrado." });
    expect(userCalls("forget_my_device")).toHaveLength(0);
  });

  it("aparelho que não é da conta (ou já esquecido): aviso, sem detalhe", async () => {
    as("secretaria", { forget_my_device: { data: false } });
    const result = await forgetMyStaffDeviceAction(DEVICE);
    expect(result).toEqual({ ok: false, error: "Este aparelho não está mais na lista. Atualize a página." });
  });

  it("erro do banco: mensagem genérica e só o código no registro", async () => {
    as("secretaria", { forget_my_device: { error: { message: "detalhe interno", code: "XX000" } } });
    const result = await forgetMyStaffDeviceAction(DEVICE);
    expect(result).toEqual({ ok: false, error: "Não foi possível esquecer o aparelho. Tente de novo." });
    const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain("detalhe interno");
  });
});

describe("forgetStaffDevices (Admin esquece aparelhos de outra conta da equipe)", () => {
  it.each(["admin", "admin_dev"] as const)("%s esquece os aparelhos de outra conta da equipe", async (role) => {
    as(role, { admin_forget_devices: { data: 2 } });
    await expect(forgetStaffDevices(OTHER)).resolves.toEqual({ ok: true, data: undefined });
    expect(adminCalls("admin_forget_devices")).toEqual([
      ["admin_forget_devices", { p_admin: ME, p_user_id: OTHER }],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/seguranca");
  });

  it.each(["secretaria", "organizador", "anonimo"] as const)("recusa %s", async (role) => {
    as(role, { admin_forget_devices: { data: 2 } });
    await expect(forgetStaffDevices(OTHER)).resolves.toEqual({ ok: false, error: "Acesso não permitido." });
    expect(adminCalls("admin_forget_devices")).toHaveLength(0);
  });

  it("não vale para a própria conta (usa Meus aparelhos)", async () => {
    as("admin", { admin_forget_devices: { data: 2 } });
    const result = await forgetStaffDevices(ME);
    expect(result).toEqual({ ok: false, error: "Para a sua conta, use “Meus aparelhos”." });
    expect(adminCalls("admin_forget_devices")).toHaveLength(0);
  });

  it("própria conta com letras maiúsculas também é recusada", async () => {
    as("admin", { admin_forget_devices: { data: 2 } });
    const result = await forgetStaffDevices(ME.toUpperCase());
    expect(result.ok).toBe(false);
    expect(adminCalls("admin_forget_devices")).toHaveLength(0);
  });

  it("conta que não é da equipe (ex.: organizador) é recusada", async () => {
    as("admin", { admin_forget_devices: { data: 2 } });
    await expect(forgetStaffDevices(ORGANIZER)).resolves.toEqual({ ok: false, error: "Conta não encontrada." });
    expect(adminCalls("admin_forget_devices")).toHaveLength(0);
  });

  it.each(["", "nao-e-uuid", null as unknown as string])("recusa id inválido %s", async (id) => {
    as("admin", { admin_forget_devices: { data: 2 } });
    await expect(forgetStaffDevices(id)).resolves.toEqual({ ok: false, error: "Conta não encontrada." });
    expect(adminCalls("admin_forget_devices")).toHaveLength(0);
  });

  it("erro do banco: mensagem genérica", async () => {
    as("admin", { admin_forget_devices: { error: { message: "detalhe interno", code: "XX000" } } });
    const result = await forgetStaffDevices(OTHER);
    expect(result).toEqual({ ok: false, error: "Não foi possível esquecer os aparelhos. Tente de novo." });
    const logged = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain("detalhe interno");
  });
});

const myDevices = [
  {
    id: DEVICE,
    label: "Chrome no Android",
    created_at: "2026-10-01T12:00:00Z",
    last_used_at: "2026-10-10T12:00:00Z",
    expires_at: "2026-10-31T12:00:00Z",
    is_current: true,
  },
];

const overview = [
  { user_id: ME, display_name: "Conta Admin", role: "admin", is_developer: false, devices_count: 1, last_used_at: "2026-10-10T12:00:00Z" },
  { user_id: OTHER, display_name: "Conta Secretaria", role: "secretaria", is_developer: false, devices_count: 2, last_used_at: null },
  { user_id: THIRD, display_name: "Conta Sem Aparelho", role: "admin", is_developer: true, devices_count: 0, last_used_at: null },
];

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#xa0;|\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

describe("página Segurança", () => {
  it("secretaria vê só Meus aparelhos", async () => {
    as("secretaria", { list_my_devices: { data: myDevices } });
    const page = text(renderToStaticMarkup(await SegurancaPage()));
    expect(page).toContain("Meus aparelhos");
    expect(page).toContain("Aparelhos lembrados não pedem código por 30 dias. Esqueça os que você não usa mais.");
    expect(page).toContain("Chrome no Android");
    expect(page).toContain("Este aparelho");
    expect(page).not.toContain("Contas da equipe");
    expect(page).not.toContain("Esquecer aparelhos");
    expect(adminCalls("staff_security_overview")).toHaveLength(0);
  });

  it("manda só um cookie de aparelho válido ao banco", async () => {
    mocks.cookie = DEVICE_TOKEN;
    as("secretaria", { list_my_devices: { data: [] } });
    await SegurancaPage();
    expect(userCalls("list_my_devices")).toEqual([["list_my_devices", { p_current_token: DEVICE_TOKEN }]]);

    vi.clearAllMocks();
    mocks.cookie = "curto";
    as("secretaria", { list_my_devices: { data: [] } });
    await SegurancaPage();
    expect(userCalls("list_my_devices")).toEqual([["list_my_devices", { p_current_token: null }]]);
  });

  it("Admin vê as contas da equipe e “Esquecer aparelhos” só nas outras contas com aparelhos", async () => {
    as("admin", { list_my_devices: { data: myDevices }, staff_security_overview: { data: overview } });
    const html = renderToStaticMarkup(await SegurancaPage());
    const page = text(html);
    expect(page).toContain("Meus aparelhos");
    expect(page).toContain("Contas da equipe");
    expect(page).toContain("Conta Secretaria");
    expect(page).toContain("2 aparelhos lembrados");
    expect(page).toContain("Sua conta: use “Meus aparelhos” acima.");
    expect(page.match(/Esquecer aparelhos/g)).toHaveLength(1);
    expect(adminCalls("staff_security_overview")).toEqual([["staff_security_overview", { p_admin: ME }]]);

    const ownItem = page.slice(page.indexOf("Conta Admin"), page.indexOf("Conta Secretaria"));
    expect(ownItem).not.toContain("Esquecer aparelhos");
    const otherItem = page.slice(page.indexOf("Conta Secretaria"), page.indexOf("Conta Sem Aparelho"));
    expect(otherItem).toContain("Esquecer aparelhos");
  });

  it("falha ao listar as contas não esconde Meus aparelhos", async () => {
    as("admin", {
      list_my_devices: { data: myDevices },
      staff_security_overview: { error: { message: "fora", code: "XX000" } },
    });
    const page = text(renderToStaticMarkup(await SegurancaPage()));
    expect(page).toContain("Chrome no Android");
    expect(page).toContain("Não foi possível carregar as contas da equipe.");
  });

  it.each(["organizador", "anonimo"] as const)("%s não abre a página", async (role) => {
    as(role);
    await expect(SegurancaPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
