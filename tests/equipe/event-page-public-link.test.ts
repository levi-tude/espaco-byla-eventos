import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const STAFF_ID = "00000000-0000-4000-8000-0000000000aa";
const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";

const mocks = vi.hoisted(() => ({
  serverTables: {} as Record<string, Result>,
}));

function queryBuilder(result: () => Result) {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === "maybeSingle") return async () => result();
        return () => builder;
      },
    },
  );
  return builder;
}

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
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: async (fn: string) => ({ data: fn === "is_staff", error: null }),
    from: (table: string) => queryBuilder(() => mocks.serverTables[table] ?? { data: [], error: null }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    from: () => queryBuilder(() => ({ data: [], error: null })),
  }),
}));
vi.mock("@/lib/auth/finance-admin", () => ({ getFinanceAccess: async () => null }));
vi.mock("@/lib/auth/staff-user", () => ({ requireStaffUser: async () => ({ userId: STAFF_ID }) }));
vi.mock("@/lib/media/gallery", () => ({ loadEventGallery: async () => [] }));
vi.mock("@/lib/finance/load", () => ({ loadEventFinance: async () => null }));
vi.mock("@/lib/domain/event-availability", () => ({
  loadSessionAvailability: async () => ({
    capacity: 80,
    sold: 0,
    held: 0,
    remaining: 80,
    categories: {
      inteira: { quota: null, sold: 0, taken: 0, remaining: null },
      meia: { quota: null, sold: 0, taken: 0, remaining: null },
    },
    types: [],
    selling: false,
  }),
}));
for (const [path, names] of [
  ["@/components/equipe/AutoRefresh", ["AutoRefresh"]],
  ["@/components/equipe/DecisionQueue", ["DecisionQueue"]],
  ["@/components/equipe/EventFinancePanel", ["EventFinancePanel"]],
  ["@/components/equipe/EventForm", ["EventForm"]],
  ["@/components/equipe/EventGalleryManager", ["EventGalleryManager"]],
  ["@/components/equipe/OpsRequestCard", ["OrganizerRefundRequests"]],
  ["@/components/equipe/PastVisibilityToggle", ["PastVisibilityToggle"]],
  ["@/components/equipe/RefundHistory", ["RefundHistory"]],
  ["@/components/equipe/SalesToggle", ["SalesToggle"]],
  ["@/components/equipe/SessionOpsPanel", ["SessionOpsPanel"]],
  ["@/components/equipe/SessionSalesToggle", ["SessionSalesToggle"]],
  ["@/components/equipe/TicketList", ["CourtesyForm", "TicketList"]],
] as const) {
  vi.doMock(path, () => Object.fromEntries(names.map((name) => [name, () => null])));
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function renderPage(): Promise<string> {
  const { default: EventoEquipePage } = await import("@/app/equipe/eventos/[id]/page");
  const element = await EventoEquipePage({
    params: Promise.resolve({ id: EVENT_ID }),
    searchParams: Promise.resolve({}),
  } as never);
  return text(renderToStaticMarkup(element as ReactElement));
}

function eventRow(extra: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: "peca-y",
    name: "Peça Y",
    venue: "Espaço Byla",
    description: "Uma peça.",
    cover_image_url: null,
    starts_at: "2099-12-12T22:00:00Z",
    sales_open: false,
    published_at: null,
    hidden_from_past: false,
    organizer_id: null,
    approval_status: "aprovado",
    deleted_at: null,
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.serverTables = {
    events: { data: eventRow(), error: null },
    event_sessions: {
      data: [
        {
          id: SESSION_ID,
          name: null,
          starts_at: "2099-12-12T22:00:00Z",
          ends_at: null,
          capacity: 80,
          inteira_quota: null,
          meia_quota: null,
          sales_open: false,
          status: "ativa",
        },
      ],
      error: null,
    },
  };
});

describe("página do evento da equipe: link “Ver página”", () => {
  it("evento do Espaço mostra o link", async () => {
    expect(await renderPage()).toContain("Ver página");
  });

  it("evento de organizador aprovado mostra o link", async () => {
    mocks.serverTables.events = { data: eventRow({ organizer_id: ORGANIZER_ID }), error: null };
    expect(await renderPage()).toContain("Ver página");
  });

  it.each(["rascunho", "em_analise", "recusado"])("evento de organizador %s não mostra o link", async (status) => {
    mocks.serverTables.events = {
      data: eventRow({ organizer_id: ORGANIZER_ID, approval_status: status }),
      error: null,
    };
    expect(await renderPage()).not.toContain("Ver página");
  });

  it("evento de organizador excluído não mostra o link", async () => {
    mocks.serverTables.events = {
      data: eventRow({ organizer_id: ORGANIZER_ID, deleted_at: "2026-10-10T10:00:00Z" }),
      error: null,
    };
    expect(await renderPage()).not.toContain("Ver página");
  });
});
