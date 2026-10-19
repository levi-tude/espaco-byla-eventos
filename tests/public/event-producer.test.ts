import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: null as Record<string, unknown> | null,
  ended: false,
  producer: null as unknown,
  producerError: null as unknown,
  producerThrows: false,
  rpcCalls: [] as [string, unknown][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/brand/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/public/EventGallery", () => ({ EventGallery: () => null }));
vi.mock("@/components/public/SessionPicker", () => ({ SessionPicker: () => null }));
vi.mock("@/lib/media/gallery", () => ({ loadEventGallery: async () => [] }));
vi.mock("@/lib/payments/service-fee-policy", () => ({
  loadServiceFeePolicy: async () => ({
    enabled: false,
    rateBps: 0,
    minCents: 0,
    cardRateBps: 0,
    pixRateBps: 0,
    perMethodEnabled: false,
  }),
}));
vi.mock("@/lib/domain/event-availability", () => ({
  loadEventAvailability: async () => null,
  loadEventSessions: async () => null,
  loadSessionAvailability: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "is", "order"]) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: mocks.event, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
    return {
      from: () => chain,
      rpc: async (name: string, args: unknown) => {
        mocks.rpcCalls.push([name, args]);
        if (name === "event_is_past") return { data: mocks.ended, error: null };
        if (name === "public_event_producer") {
          if (mocks.producerThrows) throw new Error("fora");
          return { data: mocks.producer, error: mocks.producerError };
        }
        return { data: null, error: { message: "inesperado" } };
      },
    };
  },
}));

import EventoPublicoPage from "@/app/eventos/[slug]/page";

const EVENT_ID = "00000000-0000-4000-8000-000000000001";

async function renderPage(): Promise<string> {
  const page = await EventoPublicoPage({
    params: Promise.resolve({ slug: "show-de-outubro" }),
    searchParams: Promise.resolve({}),
  } as Parameters<typeof EventoPublicoPage>[0]);
  return renderToStaticMarkup(page);
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#xa0;|\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  mocks.event = {
    id: EVENT_ID,
    slug: "show-de-outubro",
    name: "Show de outubro",
    venue: "Espaço Byla",
    description: null,
    cover_image_url: null,
    starts_at: "2026-10-30T23:00:00Z",
    sales_open: true,
  };
  mocks.ended = false;
  mocks.producer = null;
  mocks.producerError = null;
  mocks.producerThrows = false;
  mocks.rpcCalls = [];
});

describe("página do evento: Produção", () => {
  it("evento de organizador mostra “Produção: <nome>” abaixo do local", async () => {
    mocks.producer = "Coletivo Exemplo";
    const html = await renderPage();
    const page = text(html);
    expect(page).toContain("Produção: Coletivo Exemplo");
    expect(page.indexOf("Espaço Byla")).toBeLessThan(page.indexOf("Produção: Coletivo Exemplo"));
    expect(mocks.rpcCalls).toContainEqual(["public_event_producer", { p_event_id: EVENT_ID }]);
  });

  it("evento encerrado de organizador continua mostrando a produção", async () => {
    mocks.ended = true;
    mocks.producer = "Coletivo Exemplo";
    expect(text(await renderPage())).toContain("Produção: Coletivo Exemplo");
  });

  it("escapa o nome público", async () => {
    mocks.producer = "<script>x</script>";
    const html = await renderPage();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("evento do próprio Espaço fica igual a antes: sem linha de produção", async () => {
    const html = await renderPage();
    expect(html).not.toContain("Produção");
  });

  it.each([
    ["erro do banco", () => (mocks.producerError = { code: "PGRST000", message: "fora" })],
    ["exceção", () => (mocks.producerThrows = true)],
    ["nome vazio", () => (mocks.producer = "   ")],
  ])("%s: página abre normalmente, sem a linha", async (_caso, setup) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup();
    const page = text(await renderPage());
    expect(page).toContain("Show de outubro");
    expect(page).not.toContain("Produção");
  });
});
