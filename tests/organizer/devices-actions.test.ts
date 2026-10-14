import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

import { forgetMyDeviceAction } from "@/app/organizador/conta/actions";
import { DevicesList } from "@/components/auth/DevicesList";

const DEVICE_ID = "3f6c2a4e-8b1d-4c7e-9a2f-5d6e7f8a9b0c";
const USER_ID = "00000000-0000-4000-8000-0000000000aa";

/** Sessão do usuário: `organizer` = o que is_organizer responde (exige o código do e-mail). */
function session({ organizer = true, forget }: { organizer?: boolean; forget?: { data?: unknown; error?: unknown } } = {}) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "is_staff") return { data: false, error: null };
    if (fn === "is_organizer") return { data: organizer, error: null };
    if (fn === "forget_my_device") return { data: forget?.data ?? true, error: forget?.error ?? null };
    return { data: null, error: { message: "inesperado" } };
  });
}

function forgetCalls() {
  return mocks.rpc.mock.calls.filter(([fn]) => fn === "forget_my_device");
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("forgetMyDeviceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session();
  });

  it.each([["vazio", ""], ["texto", "aparelho-1"], ["número", 42], ["nulo", null]])(
    "ID inválido (%s) → erro sem chamar o banco",
    async (_label, value) => {
      const result = await forgetMyDeviceAction(value as string);
      expect(result).toEqual({ ok: false, error: "Aparelho não encontrado." });
      expect(forgetCalls()).toHaveLength(0);
    },
  );

  it("organizador sem sessão verificada → Acesso não permitido.", async () => {
    session({ organizer: false });
    expect(await forgetMyDeviceAction(DEVICE_ID)).toEqual({ ok: false, error: "Acesso não permitido." });
    expect(forgetCalls()).toHaveLength(0);
  });

  it("sem login → Acesso não permitido.", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await forgetMyDeviceAction(DEVICE_ID)).toEqual({ ok: false, error: "Acesso não permitido." });
    expect(forgetCalls()).toHaveLength(0);
  });

  it("esquece com a sessão do próprio usuário (nunca com a chave de serviço) e atualiza a tela", async () => {
    expect(await forgetMyDeviceAction(DEVICE_ID)).toEqual({ ok: true, data: undefined });
    expect(forgetCalls()).toEqual([["forget_my_device", { p_device_id: DEVICE_ID }]]);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/organizador/conta");
  });

  it("aparelho de outra conta ou já esquecido → erro, sem atualizar a tela", async () => {
    session({ forget: { data: false } });
    expect(await forgetMyDeviceAction(DEVICE_ID)).toEqual({
      ok: false,
      error: "Este aparelho não está mais na lista. Atualize a página.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falha do banco → mensagem genérica", async () => {
    session({ forget: { error: { message: "boom", code: "XX000" } } });
    expect(await forgetMyDeviceAction(DEVICE_ID)).toEqual({
      ok: false,
      error: "Não foi possível esquecer o aparelho. Tente de novo.",
    });
  });
});

describe("DevicesList", () => {
  const devices = [
    {
      id: DEVICE_ID,
      label: "Chrome no Android",
      createdAt: "2026-10-01T15:00:00Z",
      lastUsedAt: "2026-10-14T15:00:00Z",
      expiresAt: "2026-11-13T15:00:00Z",
      isCurrent: true,
    },
    {
      id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      label: "Safari no iPhone",
      createdAt: "2026-10-02T15:00:00Z",
      lastUsedAt: null,
      expiresAt: "2026-11-01T15:00:00Z",
      isCurrent: false,
    },
  ];

  it("lista cada aparelho com Esquecer e marca o atual", () => {
    const html = renderToStaticMarkup(createElement(DevicesList, { devices, onForget: vi.fn() }));
    expect(text(html)).toContain("Chrome no Android");
    expect(text(html)).toContain("Este aparelho");
    expect(text(html)).toContain("Safari no iPhone");
    expect(text(html)).toContain("14/10/2026");
    expect(html.match(/>Esquecer</g)).toHaveLength(2);
  });

  it("sem aparelhos lembrados", () => {
    const html = renderToStaticMarkup(createElement(DevicesList, { devices: [], onForget: vi.fn() }));
    expect(text(html)).toContain("Nenhum aparelho lembrado.");
    expect(html).not.toContain("Esquecer<");
  });
});
