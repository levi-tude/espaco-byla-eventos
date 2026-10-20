import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { proxy } from "@/proxy";

const CANONICAL = "https://acdheventos.com.br";

function request(url: string, host?: string) {
  const headers = new Headers();
  if (host) headers.set("host", host);
  return new NextRequest(url, { headers });
}

describe("redirecionamento do domínio antigo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
  });

  it.each([
    [
      "https://ingressos.espacobyla.online/eventos/show?origem=email",
      "https://acdheventos.com.br/eventos/show?origem=email",
    ],
    ["https://www.acdheventos.com.br/", "https://acdheventos.com.br/"],
    ["https://www.acdheventos.com.br/termos?x=1", "https://acdheventos.com.br/termos?x=1"],
    [
      "https://ingressos.espacobyla.online/equipe/eventos/abc",
      "https://acdheventos.com.br/equipe/eventos/abc",
    ],
  ])("%s vai para o domínio novo com 301", async (from, to) => {
    const response = await proxy(request(from));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(to);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("aceita o host antigo só no cabeçalho Host, com outra grafia e com porta", async () => {
    const response = await proxy(
      request("https://servico.interno/eventos/show?a=1", "Ingressos.EspacoByla.Online:443"),
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(`${CANONICAL}/eventos/show?a=1`);
  });

  it.each([
    "https://acdheventos.com.br/eventos/show",
    "https://ingressos.exemplo.test/",
    "https://evil-ingressos.espacobyla.online/",
    "https://ingressos.espacobyla.online.evil.test/",
    "https://foo.acdheventos.com.br/",
  ])("não redireciona host fora da lista: %s", async (url) => {
    const response = await proxy(request(url));
    expect(response.status).not.toBe(301);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it.each([
    "https://ingressos.espacobyla.online/api/payments/webhook",
    "https://www.acdheventos.com.br/api/payments/webhook?id=1",
    "https://ingressos.espacobyla.online/api/cron/keep-alive",
    "https://www.acdheventos.com.br/api/cron/abandoned-reminders",
  ])("não redireciona webhook nem cron: %s", async (url) => {
    const response = await proxy(request(url));
    expect(response.status).not.toBe(301);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
