import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const STAFF_ID = "00000000-0000-4000-8000-0000000000aa";
const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  getActor: vi.fn(),
  serverTables: {} as Record<string, Result>,
  adminTables: {} as Record<string, Result>,
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
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: (table: string) =>
      queryBuilder(() => mocks.serverTables[table] ?? { data: null, error: { message: "sem tabela" } }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table: string) =>
      queryBuilder(() => mocks.adminTables[table] ?? { data: null, error: { message: "sem tabela" } }),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: mocks.getActor }));
vi.mock("@/app/equipe/eventos/actions", () => ({ cancelTicket: vi.fn(), issueCourtesy: vi.fn() }));
vi.mock("@/app/equipe/eventos/order-actions", () => ({ refundOrder: vi.fn(), acceptPaidOrder: vi.fn() }));
vi.mock("@/app/equipe/aprovacoes/actions", () => ({
  decideEventApproval: vi.fn(),
  finishEventChange: vi.fn(),
  finishEventDeletion: vi.fn(),
  declineOpsRequest: vi.fn(),
}));

import AprovacoesPage from "@/app/equipe/aprovacoes/page";
import EquipePage from "@/app/equipe/page";
import { ApprovalCard, halfPriceCheck, type ApprovalEvent } from "@/components/equipe/ApprovalCard";
import { OrganizerRefundRequests, OpsRequestCard } from "@/components/equipe/OpsRequestCard";
import { TicketList, type TicketListItem } from "@/components/equipe/TicketList";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

function render(element: ReactNode): string {
  return renderToStaticMarkup(element as ReactElement);
}

const FUTURE = "2099-12-12T22:00:00Z";

function eventRow(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    starts_at: FUTURE,
    sales_open: false,
    published_at: null,
    hidden_from_past: false,
    cover_image_url: null,
    organizer_id: null,
    approval_status: "aprovado",
    deleted_at: null,
    event_sessions: [{ starts_at: FUTURE, ends_at: null, status: "ativa", archived_at: null }],
    ...extra,
  };
}

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverTables = {};
  mocks.adminTables = {};
  mocks.getUser.mockResolvedValue({ data: { user: { id: STAFF_ID } }, error: null });
  mocks.rpc.mockImplementation(async (fn: string) => ({ data: fn === "is_staff", error: null }));
  mocks.adminRpc.mockImplementation(async (fn: string) => {
    if (fn === "event_producer_names") {
      return {
        data: [2, 3, 4, 5, 6].map((n) => ({ event_id: ID(n), public_name: "Produtora Fulana" })),
        error: null,
      };
    }
    return { data: [], error: null };
  });
});

describe("lista de eventos da equipe", () => {
  it("mostra o organizador e o estado nos eventos de organizador e esconde os excluídos", async () => {
    mocks.serverTables.events = {
      data: [
        eventRow(ID(1), "Show do Espaço", { sales_open: true }),
        eventRow(ID(2), "Peça em análise", { organizer_id: ORGANIZER_ID, approval_status: "em_analise" }),
        eventRow(ID(3), "Peça em rascunho", { organizer_id: ORGANIZER_ID, approval_status: "rascunho" }),
        eventRow(ID(4), "Peça recusada", { organizer_id: ORGANIZER_ID, approval_status: "recusado" }),
        eventRow(ID(5), "Peça aprovada", { organizer_id: ORGANIZER_ID, sales_open: true }),
        eventRow(ID(6), "Peça excluída", { organizer_id: ORGANIZER_ID, deleted_at: "2026-10-10T10:00:00Z" }),
      ],
      error: null,
    };
    const page = text(render(await EquipePage()));

    expect(page).toContain("Show do Espaço");
    expect(page).not.toContain("Peça excluída");
    expect(page.match(/Organizador: Produtora Fulana/g)).toHaveLength(4);
    expect(page).toMatch(/Peça em análise[^]*Em análise[^]*Peça em rascunho/);
    expect(page).toMatch(/Peça em análise[^]*Organizador: Produtora Fulana/);
    expect(page).toContain("Rascunho");
    expect(page).toContain("Recusado");
    expect(page.match(/Venda aberta/g)).toHaveLength(2);
    expect(mocks.adminRpc).toHaveBeenCalledWith("event_producer_names", {
      p_event_ids: [ID(2), ID(3), ID(4), ID(5)],
    });
  });

  it("sem evento de organizador: não consulta nomes e fica igual a antes", async () => {
    mocks.serverTables.events = {
      data: [eventRow(ID(1), "Show do Espaço", { sales_open: true })],
      error: null,
    };
    const page = text(render(await EquipePage()));
    expect(page).toContain("Show do Espaço");
    expect(page).toContain("Venda aberta");
    expect(page).not.toContain("Organizador:");
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("falha ao buscar nomes: mostra só “Organizador” sem quebrar a lista", async () => {
    mocks.serverTables.events = {
      data: [eventRow(ID(2), "Peça em análise", { organizer_id: ORGANIZER_ID, approval_status: "em_analise" })],
      error: null,
    };
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: "falhou", code: "XX000" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = text(render(await EquipePage()));
    expect(log).toHaveBeenCalled();
    expect(page).toContain("Peça em análise");
    expect(page).toContain("Organizador");
    expect(page).toContain("Em análise");
  });
});

const baseTicket: TicketListItem = {
  id: "t1",
  orderId: "o1",
  orderTotalCents: 4000,
  paymentProvider: "mercadopago",
  buyerName: "Fulana de Tal",
  buyerEmail: "fulana@exemplo.com",
  kind: "inteira",
  typeLabel: "Inteira",
  status: "pago",
  orderStatus: "pago",
  decisionReason: null,
  priceCents: 4000,
  paidAt: "2026-10-01T12:00:00Z",
  recentlyPaid: false,
  checkedInAt: null,
  publicToken: "token-publico",
};

describe("página do evento: pedidos de estorno do organizador", () => {
  it("faixa com 1 pedido", () => {
    const html = text(
      render(
        createElement(OrganizerRefundRequests, {
          requests: [
            { id: ID(7), buyerName: "Fulana de Tal", reason: "Comprador desistiu da viagem.", createdAt: "14/10/2026 15:00" },
          ],
        }),
      ),
    );
    expect(html).toContain("1 pedido de estorno solicitado pelo organizador");
    expect(html).toContain("Comprador desistiu da viagem.");
    expect(html).toContain("Recusar pedido de estorno");
  });

  it("faixa com 2 pedidos fica no plural; sem pedidos, nada aparece", () => {
    const two = text(
      render(
        createElement(OrganizerRefundRequests, {
          requests: [
            { id: ID(7), buyerName: "Fulana de Tal", reason: "Motivo um.", createdAt: "14/10/2026 15:00" },
            { id: ID(8), buyerName: null, reason: "Motivo dois.", createdAt: "14/10/2026 16:00" },
          ],
        }),
      ),
    );
    expect(two).toContain("2 pedidos de estorno solicitados pelo organizador");
    expect(render(createElement(OrganizerRefundRequests, { requests: [] }))).toBe("");
  });

  it("o pedido na lista de participantes ganha o selo com o motivo", () => {
    const html = text(
      render(
        createElement(TicketList, {
          eventId: ID(2),
          tickets: [{ ...baseTicket, refundRequestReason: "Comprador desistiu da viagem." }],
        }),
      ),
    );
    expect(html).toContain("Estorno pedido pelo organizador: Comprador desistiu da viagem.");
  });

  it("pedido com vários ingressos: o selo aparece uma vez por pedido", () => {
    const reason = "Comprador desistiu da viagem.";
    const html = text(
      render(
        createElement(TicketList, {
          eventId: ID(2),
          tickets: ["t1", "t2", "t3"].map((id) => ({ ...baseTicket, id, refundRequestReason: reason })),
        }),
      ),
    );
    // A lista sai duas vezes no HTML (cartões do celular e tabela do computador).
    expect(html.match(/Estorno pedido pelo organizador/g)).toHaveLength(2);
  });

  it("pedido sem pedido de estorno: lista igual a antes", () => {
    const html = text(render(createElement(TicketList, { eventId: ID(1), tickets: [baseTicket] })));
    expect(html).not.toContain("Estorno pedido pelo organizador");
  });
});

const approvalEvent: ApprovalEvent = {
  id: ID(2),
  name: "Peça em análise",
  venue: "Sala principal",
  description: "Uma peça para toda a família. Classificação livre.",
  coverImageUrl: "https://exemplo.test/capa.jpg",
  producerName: "Produtora Fulana",
  organizerActive: true,
  submittedAt: "14/10/2026 10:00",
  sessions: [
    {
      id: ID(9),
      label: "sáb, 12/12 · 19h00",
      capacity: 80,
      inteiraQuota: null,
      meiaQuota: 30,
      prices: [
        { name: "Inteira", preset: "inteira", priceCents: 4000, maxUnits: null },
        { name: "Meia-entrada", preset: "meia", priceCents: 2000, maxUnits: null },
        { name: "Casadinha", preset: "casadinha", priceCents: 7000, maxUnits: 10 },
      ],
    },
  ],
};

describe("Aprovações", () => {
  it("meia é conferida contra a metade da inteira", () => {
    expect(halfPriceCheck(4000, 2000)).toBe("ok");
    expect(halfPriceCheck(4000, 2500)).toBe("diferente");
    expect(halfPriceCheck(4000, null)).toBe("sem_meia");
    expect(halfPriceCheck(null, 2000)).toBe("sem_inteira");
  });

  it("card do evento: produção, sessões, preços lado a lado, conferência e botões", () => {
    const html = text(render(createElement(ApprovalCard, { event: approvalEvent })));
    expect(html).toContain("Peça em análise");
    expect(html).toContain("Sala principal");
    expect(html).toContain("Produção: Produtora Fulana");
    expect(html).toContain("sáb, 12/12 · 19h00");
    expect(html).toContain("80 lugares");
    expect(html).toMatch(/Inteira R\$\s40,00/);
    expect(html).toMatch(/Meia-entrada R\$\s20,00/);
    expect(html).toContain("A meia é metade da inteira.");
    expect(html).toContain("Casadinha");
    expect(html).toContain("Uma peça para toda a família.");
    expect(html).toContain("Data e horários (sem choque com a agenda do Espaço)");
    expect(html).toContain("Organizador ativo");
    expect(html).toContain("Aprovar e publicar");
    expect(html).toContain("Aprovar sem publicar");
    expect(html).toContain("Recusar");
  });

  it("meia diferente da metade aparece como alerta", () => {
    const event = {
      ...approvalEvent,
      sessions: [
        {
          ...approvalEvent.sessions[0],
          prices: [
            { name: "Inteira", preset: "inteira", priceCents: 4000, maxUnits: null },
            { name: "Meia-entrada", preset: "meia", priceCents: 3000, maxUnits: null },
          ],
        },
      ],
    };
    expect(text(render(createElement(ApprovalCard, { event })))).toContain("Confira: a meia não é metade da inteira.");
  });

  it("exclusão: “Concluir exclusão” só habilita sem sessões ativas", () => {
    const request = {
      id: ID(7),
      kind: "exclusao" as const,
      eventId: ID(2),
      eventName: "Peça aprovada",
      producerName: "Produtora Fulana",
      what: null,
      reason: "O teatro fechou para reforma.",
      createdAt: "14/10/2026 15:00",
      paidOrders: 3,
      activeSessions: 1,
    };
    const blocked = render(createElement(OpsRequestCard, { request }));
    expect(text(blocked)).toContain("3 pedidos pagos");
    expect(text(blocked)).toContain("O teatro fechou para reforma.");
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Concluir exclusão/);
    expect(blocked).toContain(`href="/equipe/eventos/${ID(2)}#vendas"`);

    const ready = render(createElement(OpsRequestCard, { request: { ...request, activeSessions: 0 } }));
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Concluir exclusão/);
  });

  it("exclusão: o link abre a primeira sessão ativa, onde ficam “Cancelar sessão” e “Estornar todos”", () => {
    const html = render(
      createElement(OpsRequestCard, {
        request: {
          id: ID(7),
          kind: "exclusao" as const,
          eventId: ID(2),
          eventName: "Peça aprovada",
          producerName: "Produtora Fulana",
          what: null,
          reason: "O teatro fechou para reforma.",
          createdAt: "14/10/2026 15:00",
          paidOrders: 3,
          activeSessions: 2,
          firstActiveSessionId: ID(9),
        },
      }),
    );
    expect(html).toContain(`href="/equipe/eventos/${ID(2)}?sessao=${ID(9)}#vendas"`);
  });

  it("mudança: mostra o pedido, abre o evento e tem “Marcar como feito”", () => {
    const html = render(
      createElement(OpsRequestCard, {
        request: {
          id: ID(7),
          kind: "mudanca",
          eventId: ID(2),
          eventName: "Peça aprovada",
          producerName: "Produtora Fulana",
          what: "Sessão das 19h passa para 20h",
          reason: "Mudança de agenda do elenco.",
          createdAt: "14/10/2026 15:00",
        },
      }),
    );
    expect(text(html)).toContain("Sessão das 19h passa para 20h");
    expect(text(html)).toContain("Mudança de agenda do elenco.");
    expect(text(html)).toContain("Marcar como feito");
    expect(html).toContain(`href="/equipe/eventos/${ID(2)}"`);
  });

  it("página: secretaria e organizador não entram", async () => {
    for (const actor of [
      { kind: "equipe", userId: STAFF_ID, isAdmin: false, isDeveloper: false },
      { kind: "organizador", userId: ORGANIZER_ID },
      null,
    ]) {
      mocks.getActor.mockResolvedValue(actor);
      await expect(AprovacoesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("página do Admin: aba Eventos lista os eventos em análise com o nome da produção", async () => {
    mocks.getActor.mockResolvedValue({ kind: "equipe", userId: STAFF_ID, isAdmin: true, isDeveloper: false });
    mocks.adminTables.events = {
      data: [
        {
          id: ID(2),
          name: "Peça em análise",
          slug: "peca-em-analise",
          venue: "Sala principal",
          description: "Descrição da peça.",
          cover_image_url: null,
          submitted_at: "2026-10-14T13:00:00Z",
          organizer_id: ORGANIZER_ID,
          event_sessions: [],
          ticket_types: [],
        },
      ],
      error: null,
    };
    mocks.adminRpc.mockImplementation(async (fn: string) => {
      if (fn === "team_pending_counts") {
        return { data: [{ approvals: 1, changes: 2, deletions: 0, refunds: 0, signup_requests: 0 }], error: null };
      }
      if (fn === "event_producer_names") {
        return { data: [{ event_id: ID(2), public_name: "Produtora Fulana" }], error: null };
      }
      if (fn === "list_organizers") return { data: [{ user_id: ORGANIZER_ID, status: "ativo" }], error: null };
      return { data: [], error: null };
    });
    const page = text(render(await AprovacoesPage({ searchParams: Promise.resolve({}) })));
    expect(page).toContain("Aprovações");
    expect(page).toContain("Enviado para aprovação em");
    expect(page).toContain("Eventos (1)");
    expect(page).toContain("Mudanças (2)");
    expect(page).toContain("Exclusões");
    expect(page).toContain("Peça em análise");
    expect(page).toContain("Produção: Produtora Fulana");
  });

  it("página do Admin: aba Exclusões conta pedidos pagos e sessões ativas", async () => {
    mocks.getActor.mockResolvedValue({ kind: "equipe", userId: STAFF_ID, isAdmin: true, isDeveloper: false });
    mocks.adminTables.orders = { data: [{ event_id: ID(2) }, { event_id: ID(2) }], error: null };
    mocks.adminTables.event_sessions = {
      data: [
        { id: ID(8), event_id: ID(2), status: "cancelada", archived_at: null, starts_at: "2099-12-01T22:00:00Z" },
        { id: ID(9), event_id: ID(2), status: "ativa", archived_at: null, starts_at: "2099-12-12T22:00:00Z" },
      ],
      error: null,
    };
    mocks.adminRpc.mockImplementation(async (fn: string) => {
      if (fn === "list_ops_requests") {
        return {
          data: [
            {
              id: ID(7),
              kind: "exclusao",
              event_id: ID(2),
              event_name: "Peça aprovada",
              organizer_public_name: "Produtora Fulana",
              order_id: null,
              details: {},
              reason: "O teatro fechou para reforma.",
              status: "pendente",
              decision_note: null,
              created_at: "2026-10-14T15:00:00Z",
              decided_at: null,
            },
            {
              id: ID(8),
              kind: "mudanca",
              event_id: ID(3),
              event_name: "Outra peça",
              organizer_public_name: "Produtora Fulana",
              order_id: null,
              details: { o_que: "Trocar o horário" },
              reason: "Agenda do elenco.",
              status: "pendente",
              decision_note: null,
              created_at: "2026-10-14T15:00:00Z",
              decided_at: null,
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const html = render(await AprovacoesPage({ searchParams: Promise.resolve({ aba: "exclusoes" }) }));
    const page = text(html);
    expect(page).toContain("Peça aprovada");
    expect(page).not.toContain("Outra peça");
    expect(page).toContain("2 pedidos pagos · 1 sessão ativa");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Concluir exclusão/);
    expect(html).toContain(`href="/equipe/eventos/${ID(2)}?sessao=${ID(9)}#vendas"`);
    expect(mocks.adminRpc).toHaveBeenCalledWith("list_ops_requests", { p_staff: STAFF_ID, p_status: "pendente" });
  });
});
