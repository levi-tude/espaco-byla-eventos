import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { staffRedirectFor, toStaffLoginStatus } from "@/lib/auth/staff-gate";
import { config, proxy } from "@/proxy";

describe("staffRedirectFor", () => {
  it.each([
    ["/equipe/login", "fora", null],
    ["/equipe/login", "pendente", "/equipe/verificar"],
    ["/equipe/login", "verificado", "/equipe"],
    ["/equipe/verificar", "fora", "/equipe/login"],
    ["/equipe/verificar", "pendente", null],
    ["/equipe/verificar", "verificado", "/equipe"],
    ["/equipe", "fora", "/equipe/login"],
    ["/equipe", "pendente", "/equipe/verificar"],
    ["/equipe", "verificado", null],
    ["/equipe/eventos/abc/check-in", "pendente", "/equipe/verificar"],
    ["/equipe/taxa-servico", "fora", "/equipe/login"],
  ] as const)("%s com %s -> %s", (pathname, status, expected) => {
    expect(staffRedirectFor(pathname, status)).toBe(expected);
  });

  it("qualquer valor estranho vira 'fora'", () => {
    expect(toStaffLoginStatus("verificado")).toBe("verificado");
    expect(toStaffLoginStatus("pendente")).toBe("pendente");
    expect(toStaffLoginStatus("VERIFICADO")).toBe("fora");
    expect(toStaffLoginStatus(undefined)).toBe("fora");
  });
});

describe("proxy na área da equipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  function request(path: string, init?: { prefetch?: boolean }) {
    const headers = new Headers();
    if (init?.prefetch) headers.set("next-router-prefetch", "1");
    return new NextRequest(new URL(path, "https://ingressos.exemplo.test"), { headers });
  }

  function location(response: Response) {
    const value = response.headers.get("location");
    return value ? new URL(value).pathname : null;
  }

  it("senha certa mas sem código: manda para a tela do código", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: "pendente" }], error: null });
    const response = await proxy(request("/equipe/eventos/x"));
    expect(mocks.rpc).toHaveBeenCalledWith("login_session_state");
    expect(location(response)).toBe("/equipe/verificar");
  });

  it("prefetch passa pela mesma checagem", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: "pendente" }], error: null });
    const response = await proxy(request("/equipe", { prefetch: true }));
    expect(location(response)).toBe("/equipe/verificar");
  });

  it("verificado abre o painel", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: "verificado" }], error: null });
    const response = await proxy(request("/equipe"));
    expect(location(response)).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("erro na consulta conta como sem login", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(location(await proxy(request("/equipe")))).toBe("/equipe/login");
  });

  it("sem usuário nem consulta o estado", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(location(await proxy(request("/equipe/verificar")))).toBe("/equipe/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("páginas públicas não consultam o login", async () => {
    const response = await proxy(request("/eventos/show"));
    expect(location(response)).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("o matcher não tem exceção para prefetch", () => {
    expect(JSON.stringify(config)).not.toMatch(/prefetch|missing/);
  });
});
