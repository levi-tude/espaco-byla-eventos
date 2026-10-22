import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const TYPE_ID = "00000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  serverTables: {} as Record<string, Result>,
  adminTables: {} as Record<string, Result>,
  formProps: [] as unknown[],
  deleteProps: [] as unknown[],
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
    from: (table: string) =>
      queryBuilder(() => mocks.serverTables[table] ?? { data: null, error: { message: "sem tabela" } }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) =>
      queryBuilder(() => mocks.adminTables[table] ?? { data: null, error: { message: "sem tabela" } }),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => ({ kind: "organizador", userId: ORGANIZER_ID }),
  requireEventAccess: async () => ({ access: "dono" }),
}));
vi.mock("@/lib/organizer/settings", () => ({ organizerAreaEnabled: async () => true }));
vi.mock("@/lib/organizer/load-finance", () => ({
  loadOrganizerEventFinance: async () => null,
}));
vi.mock("@/lib/domain/event-availability", () => ({
  loadEventSessions: async () => ({ sessions: [] }),
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
    selling: true,
  }),
}));
vi.mock("@/components/equipe/EventForm", () => ({
  EventForm: (props: unknown) => {
    mocks.formProps.push(props);
    return createElement("div", null, "formulário do evento");
  },
}));
vi.mock("@/components/equipe/EventGalleryManager", () => ({ EventGalleryManager: () => null }));
vi.mock("@/components/organizer/ApprovalBanner", () => ({ ApprovalBanner: () => null }));
vi.mock("@/components/organizer/DeleteEventSection", () => ({
  DeleteEventSection: (props: unknown) => {
    mocks.deleteProps.push(props);
    return null;
  },
}));
vi.mock("@/components/organizer/OpsRequestList", () => ({ OpsRequestList: () => null }));
vi.mock("@/components/organizer/OrganizerOrderList", () => ({ OrganizerOrderList: () => null }));
vi.mock("@/components/organizer/OrganizerSalesPanel", () => ({ OrganizerSalesPanel: () => null }));
vi.mock("@/components/organizer/OrganizerNoAccess", () => ({ OrganizerNoAccess: () => null }));
vi.mock("@/components/organizer/OrganizerEventTabs", () => ({
  OrganizerEventTabs: ({
    evento,
    deleteSection,
  }: {
    evento: ReactNode;
    deleteSection: ReactNode;
  }) => createElement("div", null, evento, deleteSection),
}));

import EventoOrganizadorPage from "@/app/organizador/eventos/[id]/page";

const LOAD_ERROR = "Não foi possível carregar os dados do evento. Atualize a página.";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function renderPage(): Promise<string> {
  const element = await EventoOrganizadorPage({
    params: Promise.resolve({ id: EVENT_ID }),
    searchParams: Promise.resolve({}),
  });
  return text(renderToStaticMarkup(element as ReactElement));
}

const failed = { data: null, error: { code: "XX000", message: "falhou" } };

function nestedEvent() {
  return {
    id: EVENT_ID,
    slug: "peca-y",
    name: "Peça Y",
    venue: "Espaço Byla",
    description: "Uma peça.",
    cover_image_url: "https://exemplo.test/capa.jpg",
    sales_open: true,
    approval_status: "aprovado",
    approval_note: null,
    organizer_id: ORGANIZER_ID,
    deleted_at: null,
    ticket_types: [
      {
        id: TYPE_ID,
        preset: "inteira",
        name: "Inteira",
        kind: "inteira",
        people_per_unit: 1,
        sort_order: 0,
        archived_at: null,
      },
    ],
    event_sessions: [
      {
        id: SESSION_ID,
        name: null,
        starts_at: "2099-12-12T22:00:00Z",
        ends_at: null,
        capacity: 80,
        inteira_quota: null,
        meia_quota: null,
        sales_open: true,
        status: "ativa",
        archived_at: null,
        session_ticket_types: [
          { ticket_type_id: TYPE_ID, price_cents: 5000, max_units: null, on_sale: true },
        ],
      },
    ],
    event_images: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.formProps = [];
  mocks.deleteProps = [];
  mocks.serverTables = {
    events: {
      data: nestedEvent(),
      error: null,
    },
  };
  mocks.adminTables = { orders: { data: [], error: null } };
});

describe("página do evento do organizador: falha ao ler os dados", () => {
  it("tudo lido: mostra o formulário com os preços", async () => {
    const page = await renderPage();
    expect(page).toContain("formulário do evento");
    expect(page).not.toContain(LOAD_ERROR);
    expect(mocks.formProps).toHaveLength(1);
  });

  it.each([
    ["pedidos", () => (mocks.adminTables.orders = failed)],
    ["evento (consulta aninhada)", () => (mocks.serverTables.events = failed)],
  ])("falha ao ler %s: não mostra formulário editável, só o aviso", async (_name, fail) => {
    fail();
    const page = await renderPage();
    expect(page).toContain(LOAD_ERROR);
    expect(page).not.toContain("formulário do evento");
    expect(mocks.formProps).toHaveLength(0);
  });

  it("falha ao ler os pedidos: a exclusão trata o evento como vendido", async () => {
    mocks.adminTables.orders = failed;
    await renderPage();
    expect(mocks.deleteProps.at(-1)).toMatchObject({ hasSales: true });
  });

  it("sem pedidos lidos com sucesso: a exclusão continua sem vendas", async () => {
    await renderPage();
    expect(mocks.deleteProps.at(-1)).toMatchObject({ hasSales: false });
  });
});
