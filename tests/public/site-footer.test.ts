import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  getActor: vi.fn(async () => null as { kind: string; userId: string } | null),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth/actor", () => ({ getActor: () => mocks.getActor() }));

import { OrganizerCallout } from "@/components/public/OrganizerCallout";
import { TERMS_PATH } from "@/lib/legal/terms";

const REQUEST_PATH = "/quero-fazer-meu-evento";
const ORGANIZER_ENTER = "/organizador/entrar";
const ORGANIZER_HOME = "/organizador";

let SiteFooter: typeof import("@/components/brand/SiteFooter").SiteFooter;
let organizerAreaEnabled: typeof import("@/lib/organizer/settings").organizerAreaEnabled;

/** A chave guarda a última resposta no módulo: cada teste começa sem nenhuma. */
async function freshModules() {
  vi.resetModules();
  ({ SiteFooter } = await import("@/components/brand/SiteFooter"));
  ({ organizerAreaEnabled } = await import("@/lib/organizer/settings"));
}

/** O cliente devolve um construtor de consulta; a chave da área é lida com prazo (abortSignal). */
const client = {
  rpc: (...args: unknown[]) => ({ abortSignal: () => mocks.rpc(...args) }),
};

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("organizerAreaEnabled", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://exemplo.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-anonima");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-de-servico");
    mocks.createClient.mockReturnValue(client);
    await freshModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("consulta a chave geral com o cliente anônimo (nunca a chave de serviço)", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    expect(await organizerAreaEnabled()).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("organizer_area_enabled");
    expect(mocks.createClient).toHaveBeenCalledWith("https://exemplo.test", "chave-anonima", expect.anything());
    expect(JSON.stringify(mocks.createClient.mock.calls)).not.toContain("chave-de-servico");
  });

  it("desligada no banco = false", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await organizerAreaEnabled()).toBe(false);
  });

  it("erro do banco = false (falha fechada)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect(await organizerAreaEnabled()).toBe(false);
    errorLog.mockRestore();
  });

  it("exceção = false", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockRejectedValue(new Error("fora do ar"));
    expect(await organizerAreaEnabled()).toBe(false);
    errorLog.mockRestore();
  });

  it("resposta estranha = false", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: "true", error: null });
    expect(await organizerAreaEnabled()).toBe(false);
    errorLog.mockRestore();
  });

  it("sem endereço do banco configurado = false, sem consultar", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await organizerAreaEnabled()).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("rodapé", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getActor.mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://exemplo.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-anonima");
    mocks.createClient.mockReturnValue(client);
    await freshModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("com a área ligada mostra Área do organizador e Quero fazer meu evento", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const html = renderToStaticMarkup(await SiteFooter());

    expect(html).toContain(`href="${ORGANIZER_ENTER}"`);
    expect(text(html)).toContain("Área do organizador");
    expect(html).toContain(`href="${REQUEST_PATH}"`);
    expect(text(html)).toContain("Quero fazer meu evento");
    expect(html).toContain(`href="${TERMS_PATH}"`);
    expect(html).toContain('href="/privacidade"');
  });

  it("organizador logado: Área do organizador aponta para /organizador", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.getActor.mockResolvedValue({ kind: "organizador", userId: "u1" });
    const html = renderToStaticMarkup(await SiteFooter());
    expect(html).toContain(`href="${ORGANIZER_HOME}"`);
    expect(html).not.toContain(`href="${ORGANIZER_ENTER}"`);
  });

  it("com a área desligada (ou sem resposta do banco) os links de organizador não aparecem", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const off = renderToStaticMarkup(await SiteFooter());
    expect(off).not.toContain(REQUEST_PATH);
    expect(off).not.toContain(ORGANIZER_ENTER);
    expect(text(off)).not.toContain("Quero fazer meu evento");
    expect(text(off)).not.toContain("Área do organizador");
    expect(off).toContain(`href="${TERMS_PATH}"`);

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "fora do ar" } });
    expect(renderToStaticMarkup(await SiteFooter())).not.toContain(REQUEST_PATH);
    errorLog.mockRestore();
  });
});

describe("bloco da página inicial", () => {
  it("convida discretamente e leva ao pedido", () => {
    const html = renderToStaticMarkup(createElement(OrganizerCallout));
    expect(text(html)).toContain("Realize seu evento na ACDH Eventos");
    expect(text(html)).toContain("Fale com a gente");
    expect(html).toContain(`href="${REQUEST_PATH}"`);
  });
});
