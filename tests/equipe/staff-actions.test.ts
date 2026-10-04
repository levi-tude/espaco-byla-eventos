import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  adminRpc: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    from: mocks.from,
    auth: { getUser: mocks.getUser },
  }),
}));

import {
  cancelTicket,
  createEvent,
  issueCourtesy,
  setSalesOpen,
  setSessionSalesOpen,
  updateEvent,
} from "@/app/equipe/eventos/actions";

const eventId = "00000000-0000-4000-8000-000000000001";
const eventInput = {
  name: "Show de teste",
  venue: "Espaço Byla",
  description: "",
  ticketTypes: [{ preset: "inteira" as const, priceCents: 5000, maxUnits: null }],
  sessions: [
    {
      id: null,
      name: "",
      startsAt: "2026-12-01T20:00",
      endsAt: "",
      capacity: 100,
      inteiraQuota: null,
      meiaQuota: null,
      prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }],
    },
  ],
};

const staffActions = {
  createEvent: () => createEvent(eventInput),
  updateEvent: () => updateEvent(eventId, eventInput),
  setSalesOpen: () => setSalesOpen(eventId, true),
  setSessionSalesOpen: () => setSessionSalesOpen("00000000-0000-4000-8000-000000000003", false),
  issueCourtesy: () =>
    issueCourtesy({ eventId, name: "Convidado", email: "convidado@example.com" }),
  cancelTicket: () => cancelTicket(eventId, "00000000-0000-4000-8000-000000000002"),
};

const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const ticketId = "00000000-0000-4000-8000-000000000002";

describe("ações da equipe sem login de equipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
  });

  it.each(Object.entries(staffActions))(
    "%s é recusada antes de tocar no banco",
    async (_name, action) => {
      expect(await action()).toEqual({ ok: false, error: "Acesso restrito à equipe." });
      expect(mocks.rpc).toHaveBeenCalledWith("is_staff");
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("recusa também quando a checagem de equipe falha", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "falhou" } });
    expect(await setSalesOpen(eventId, false)).toEqual({
      ok: false,
      error: "Acesso restrito à equipe.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("erro inesperado vira mensagem genérica, sem detalhes internos", async () => {
    mocks.rpc.mockRejectedValue(new Error("connection refused 10.0.0.1:5432"));
    const result = await setSalesOpen(eventId, true);
    expect(result).toEqual({ ok: false, error: "Não foi possível alterar a venda." });
  });
});

describe("vendas por sessão e cortesia com sessão", () => {
  const sessionId = "00000000-0000-4000-8000-000000000003";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.from.mockImplementation(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { slug: "show" }, error: null }),
      };
      return chain;
    });
    mocks.createAdminClient.mockReturnValue({
      rpc: mocks.adminRpc,
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { event_id: eventId, events: { slug: "show" } }, error: null }),
        };
        return chain;
      },
    });
  });

  it.each(["", "abc", `${sessionId}' or 1=1`])("recusa sessão inválida (%s)", async (invalid) => {
    expect(await setSessionSalesOpen(invalid, false)).toEqual({ ok: false, error: "Sessão inválida." });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("encerra a venda da sessão pela função do banco, com quem pediu", async () => {
    mocks.adminRpc.mockResolvedValue({ data: false, error: null });
    expect(await setSessionSalesOpen(sessionId, false)).toEqual({ ok: true, data: undefined });
    expect(mocks.adminRpc).toHaveBeenCalledWith("set_session_sales_open", {
      p_session_id: sessionId,
      p_open: false,
      p_staff_user_id: staffUserId,
    });
  });

  it("sessão cancelada ou removida vira mensagem clara", async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: "SESSAO_INDISPONIVEL: x" } });
    expect(await setSessionSalesOpen(sessionId, true)).toEqual({
      ok: false,
      error: "Esta sessão não está mais disponível. Recarregue a página.",
    });
  });

  it("cortesia vai para a sessão escolhida", async () => {
    mocks.adminRpc.mockResolvedValue({ data: [{ order_id: "o", ticket_id: "t" }], error: null });
    const result = await issueCourtesy({ eventId, name: "Convidado", email: "convidado@example.com", sessionId });
    expect(result.ok).toBe(true);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "issue_courtesy_ticket",
      expect.objectContaining({ p_event_id: eventId, p_session_id: sessionId }),
    );
  });

  it("cortesia com sessão inválida é recusada antes do banco", async () => {
    expect(
      await issueCourtesy({ eventId, name: "Convidado", email: "convidado@example.com", sessionId: "x" }),
    ).toEqual({ ok: false, error: "Escolha a sessão da cortesia." });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("cancelTicket (cortesia)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc });
    mocks.from.mockImplementation(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { slug: "show" }, error: null }),
      };
      return chain;
    });
  });

  it("sem login é recusado antes de tocar no banco", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await cancelTicket(eventId, ticketId)).toEqual({
      ok: false,
      error: "Acesso restrito à equipe.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["", "abc", `${ticketId}' or 1=1`])("recusa identificador inválido (%s)", async (invalid) => {
    expect(await cancelTicket(eventId, invalid)).toEqual({
      ok: false,
      error: "Ingresso inválido.",
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("cancela pela função do banco registrando quem pediu", async () => {
    mocks.adminRpc.mockResolvedValue({ data: "cancelled", error: null });
    expect(await cancelTicket(eventId, ticketId)).toEqual({ ok: true, data: undefined });
    expect(mocks.adminRpc).toHaveBeenCalledWith("cancel_courtesy_ticket", {
      p_event_id: eventId,
      p_ticket_id: ticketId,
      p_staff_user_id: staffUserId,
    });
    expect(mocks.from).not.toHaveBeenCalledWith("tickets");
  });

  it("ingresso que não é cortesia sem entrada vira mensagem clara", async () => {
    mocks.adminRpc.mockResolvedValue({ data: "not_allowed", error: null });
    expect(await cancelTicket(eventId, ticketId)).toEqual({
      ok: false,
      error:
        "Só cortesias sem check-in podem ser canceladas. Ingresso pago se resolve com “Estornar pedido”.",
    });
  });
});
