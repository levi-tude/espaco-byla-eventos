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

function request(path: string, init?: { prefetch?: boolean }) {
  const headers = new Headers();
  if (init?.prefetch) headers.set("next-router-prefetch", "1");
  return new NextRequest(new URL(path, "https://ingressos.exemplo.test"), { headers });
}

function location(response: Response) {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname : null;
}

type RpcResult = { data: unknown; error: { message: string } | null };

/** Estado da sessão e tipo de conta, cada um com a sua resposta. */
function session(status: string, kind: string | null, overrides: Record<string, RpcResult> = {}) {
  const answers: Record<string, RpcResult> = {
    login_session_state: { data: [{ status }], error: null },
    my_account_kind: { data: kind, error: null },
    ...overrides,
  };
  mocks.rpc.mockImplementation(async (name: string) => answers[name] ?? { data: null, error: null });
}

describe("proxy na área da equipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("senha certa mas sem código: manda para a tela do código", async () => {
    session("pendente", "equipe");
    const response = await proxy(request("/equipe/eventos/x"));
    expect(mocks.rpc).toHaveBeenCalledWith("login_session_state");
    expect(mocks.rpc).toHaveBeenCalledWith("my_account_kind");
    expect(location(response)).toBe("/equipe/verificar");
  });

  it("prefetch passa pela mesma checagem", async () => {
    session("pendente", "equipe");
    const response = await proxy(request("/equipe", { prefetch: true }));
    expect(location(response)).toBe("/equipe/verificar");
  });

  it("verificado abre o painel", async () => {
    session("verificado", "equipe");
    const response = await proxy(request("/equipe"));
    expect(location(response)).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("erro na consulta conta como sem login", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(location(await proxy(request("/equipe")))).toBe("/equipe/login");
  });

  it("erro só no tipo de conta também conta como sem login", async () => {
    session("verificado", "equipe", { my_account_kind: { data: null, error: { message: "x" } } });
    expect(location(await proxy(request("/equipe")))).toBe("/equipe/login");
  });

  it("organizador verificado abrindo a equipe vai para o login da equipe", async () => {
    session("verificado", "organizador");
    expect(location(await proxy(request("/equipe")))).toBe("/equipe/login");
    expect(location(await proxy(request("/equipe/verificar")))).toBe("/equipe/login");
  });

  it("sem usuário nem consulta o estado", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(location(await proxy(request("/equipe/verificar")))).toBe("/equipe/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("consulta estado e tipo de conta ao mesmo tempo", async () => {
    let pending = 0;
    let maxPending = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      pending += 1;
      maxPending = Math.max(maxPending, pending);
      await new Promise((resolve) => setTimeout(resolve, 5));
      pending -= 1;
      return name === "login_session_state"
        ? { data: [{ status: "verificado" }], error: null }
        : { data: "equipe", error: null };
    });
    expect(location(await proxy(request("/equipe")))).toBeNull();
    expect(maxPending).toBe(2);
  });

  it("páginas públicas não consultam o login", async () => {
    for (const path of ["/eventos/show", "/", "/organizadores", "/convite", "/quero-fazer-meu-evento"]) {
      const response = await proxy(request(path));
      expect(location(response)).toBeNull();
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("o matcher não tem exceção para prefetch", () => {
    expect(JSON.stringify(config)).not.toMatch(/prefetch|missing/);
  });
});

describe("proxy na área do organizador", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u2" } } });
  });

  it("sem login vai para a entrada do organizador", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect(location(await proxy(request("/organizador")))).toBe("/organizador/entrar");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("senha certa mas sem código: tela do código do organizador", async () => {
    session("pendente", "organizador");
    expect(location(await proxy(request("/organizador/eventos/x")))).toBe("/organizador/verificar");
    expect(mocks.rpc).toHaveBeenCalledWith("login_session_state");
    expect(mocks.rpc).toHaveBeenCalledWith("my_account_kind");
  });

  it("prefetch passa pela mesma checagem", async () => {
    session("pendente", "organizador");
    expect(location(await proxy(request("/organizador", { prefetch: true })))).toBe("/organizador/verificar");
  });

  it("organizador verificado abre a área; na entrada vai para o início", async () => {
    session("verificado", "organizador");
    expect(location(await proxy(request("/organizador")))).toBeNull();
    expect(location(await proxy(request("/organizador/entrar")))).toBe("/organizador");
  });

  it("equipe verificada abrindo o organizador vai para a entrada do organizador", async () => {
    session("verificado", "equipe");
    expect(location(await proxy(request("/organizador")))).toBe("/organizador/entrar");
    expect(location(await proxy(request("/organizador/entrar")))).toBeNull();
  });

  it("erro na consulta conta como sem login", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(location(await proxy(request("/organizador")))).toBe("/organizador/entrar");
  });

  it("x-pathname e CSP também na área do organizador", async () => {
    session("verificado", "organizador");
    const response = await proxy(request("/organizador"));
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/organizador");
  });
});
