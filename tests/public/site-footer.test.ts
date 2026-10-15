import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { OrganizerCallout } from "@/components/public/OrganizerCallout";
import { TERMS_PATH } from "@/lib/legal/terms";

const REQUEST_PATH = "/quero-fazer-meu-evento";

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
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://exemplo.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-anonima");
    mocks.createClient.mockReturnValue(client);
    await freshModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("com a área ligada mostra o link Quero fazer meu evento", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const html = renderToStaticMarkup(await SiteFooter());

    expect(html).toContain(`href="${REQUEST_PATH}"`);
    expect(text(html)).toContain("Quero fazer meu evento");
    expect(html).toContain(`href="${TERMS_PATH}"`);
    expect(html).toContain('href="/privacidade"');
  });

  it("com a área desligada (ou sem resposta do banco) o link não aparece", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const off = renderToStaticMarkup(await SiteFooter());
    expect(off).not.toContain(REQUEST_PATH);
    expect(text(off)).not.toContain("Quero fazer meu evento");
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
    expect(text(html)).toContain("Quer fazer seu evento no Espaço Byla?");
    expect(text(html)).toContain("Fale com a gente");
    expect(html).toContain(`href="${REQUEST_PATH}"`);
  });
});
