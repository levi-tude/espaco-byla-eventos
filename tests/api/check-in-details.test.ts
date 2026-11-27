import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loginState: vi.fn(),
  adminRpc: vi.fn(),
  maybeSingle: vi.fn(),
  tables: {} as Record<string, { single?: unknown; list?: unknown[]; error?: unknown }>,
  calls: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: (name: string) =>
      name === "login_session_state"
        ? mocks.loginState()
        : Promise.resolve({ data: null, error: { message: "inesperado" } }),
  }),
}));

function query(table: string) {
  const call = { table, filters: [] as [string, unknown][] };
  mocks.calls.push(call);
  const config = () => mocks.tables[table] ?? {};
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    },
    in: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: config().single ?? null, error: config().error ?? null }),
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: config().list ?? [], error: config().error ?? null }),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc, from: query }),
}));

import { POST } from "@/app/api/check-in/route";

const eventId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const otherStaffId = "00000000-0000-4000-8000-0000000000ee";
const code = "11111111-1111-4111-8111-111111111111";
const ticketId = "22222222-2222-4222-8222-222222222222";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const okRow = {
  outcome: "ok",
  buyer_name: "Maria Souza",
  ticket_kind: "meia",
  type_name: "Meia-entrada",
  other_event_name: null,
  session_name: null,
  session_starts_at: "2026-11-28T20:00:00.000Z",
  event_name: "Cápsulas do Tempo",
};

const currentTicket = {
  id: ticketId,
  code,
  order_id: "o1",
  buyer_name: "Maria Souza",
  checked_in_at: "2026-11-28T20:04:00.000Z",
  checked_in_by: otherStaffId,
  kind: "meia",
  price_cents: 2500,
  session_id: sessionId,
};

const orderTickets = [
  { id: ticketId, kind: "meia", status: "check_in", checked_in_at: "2026-11-28T20:04:00.000Z", order_items: { name: "Meia-entrada" } },
  { id: "t2", kind: "inteira", status: "pago", checked_in_at: null, order_items: { name: "Inteira" } },
  { id: "t3", kind: "inteira", status: "check_in", checked_in_at: "2026-11-28T19:58:00.000Z", order_items: { name: "Inteira" } },
];

describe("POST /api/check-in — detalhes do pedido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.tables = {
      tickets: { single: currentTicket, list: orderTickets },
      staff_profiles: { single: { display_name: "Ana Portaria" } },
      events: { single: { organizer_id: "org" } },
      ticket_types: {
        list: [
          { id: "tp", kind: "inteira", preset: null, people_per_unit: 1, archived_at: null, sort_order: 0, price_cents: 2500 },
          { id: "ti", kind: "inteira", preset: "inteira", people_per_unit: 1, archived_at: null, sort_order: 1, price_cents: 4000 },
          { id: "tc", kind: "inteira", preset: "casadinha", people_per_unit: 2, archived_at: null, sort_order: 2, price_cents: 8000 },
        ],
      },
      session_ticket_types: { list: [{ ticket_type_id: "ti", price_cents: 5000 }] },
    };
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } } });
    mocks.loginState.mockResolvedValue({
      data: [{ status: "verificado", user_id: staffUserId, session_id: sessionId, code_expires_at: null, resend_at: null }],
      error: null,
    });
    mocks.adminRpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  });

  it("entrada ok devolve o pedido: quantos ingressos e quais já entraram (com horário)", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: okRow, error: null });
    const response = await post({ eventId, sessionId, code });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, buyerName: "Maria Souza", kind: "meia" });
    expect(body.order).toEqual({
      total: 3,
      entered: 2,
      tickets: [
        { typeLabel: "Meia-entrada", kind: "meia", entered: true, enteredAt: "17h04", current: true },
        { typeLabel: "Inteira", kind: "inteira", entered: false, enteredAt: null, current: false },
        { typeLabel: "Inteira", kind: "inteira", entered: true, enteredAt: "16h58", current: false },
      ],
    });
    // Meia: devolve o ingresso (para a conferência) e a diferença inteira (sessão) − meia.
    expect(body.ticketId).toBe(ticketId);
    expect(body.meiaDiffCents).toBe(2500);
    // Nunca devolve o código do QR, e-mail ou token.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(code);
    expect(raw).not.toMatch(/@|token/i);
  });

  it("inteira não devolve o id do ingresso nem diferença", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { ...okRow, ticket_kind: "inteira", type_name: "Inteira" },
      error: null,
    });
    const body = await (await post({ eventId, sessionId, code })).json();
    expect(body.ok).toBe(true);
    expect(body.ticketId).toBeUndefined();
    expect(body.meiaDiffCents).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(ticketId);
  });

  it("diferença indisponível não atrapalha a entrada da meia", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.tables.ticket_types = { error: { code: "XX000" } };
    mocks.maybeSingle.mockResolvedValue({ data: okRow, error: null });
    const body = await (await post({ eventId, sessionId, code })).json();
    expect(body).toMatchObject({ ok: true, ticketId, meiaDiffCents: null });
  });

  it("consultas extras ficam presas ao evento e ao pedido do ingresso lido", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: okRow, error: null });
    await post({ eventId, sessionId, code });
    const ticketCalls = mocks.calls.filter((call) => call.table === "tickets");
    expect(ticketCalls.length).toBeGreaterThan(0);
    for (const call of ticketCalls) {
      expect(call.filters).toContainEqual(["event_id", eventId]);
    }
    expect(ticketCalls.some((call) => call.filters.some(([c, v]) => c === "order_id" && v === "o1"))).toBe(true);
  });

  it("'Já utilizado' mostra quem comprou, a hora e quem validou", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { outcome: "ja_usado" }, error: null });
    const body = await (await post({ eventId, sessionId, code })).json();
    expect(body).toMatchObject({
      ok: false,
      reason: "ja_usado",
      message: "Já utilizado",
      buyerName: "Maria Souza",
      usedLine: "Entrou às 17h04 · validado por Ana Portaria",
    });
    expect(body.order.total).toBe(3);
  });

  it("'Já utilizado' pelo dono do evento aparece como organizador", async () => {
    mocks.tables.staff_profiles = { single: null };
    mocks.tables.events = { single: { organizer_id: otherStaffId } };
    mocks.maybeSingle.mockResolvedValue({ data: { outcome: "ja_usado" }, error: null });
    const body = await (await post({ eventId, sessionId, code })).json();
    expect(body.usedLine).toBe("Entrou às 17h04 · validado por organizador do evento");
  });

  it("se a consulta extra falhar, a entrada continua valendo com o card simples", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.tables.tickets = { error: { code: "XX000", message: "falhou" } };
    mocks.maybeSingle.mockResolvedValue({ data: okRow, error: null });
    const response = await post({ eventId, sessionId, code });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.order).toBeUndefined();
  });

  it.each(["evento_errado", "sessao_errada", "nao_encontrado", "estornado"])(
    "%s não faz consultas extras (nada de dados de outro evento/pedido)",
    async (outcome) => {
      mocks.maybeSingle.mockResolvedValue({ data: { outcome }, error: null });
      const body = await (await post({ eventId, sessionId, code })).json();
      expect(body.ok).toBe(false);
      expect(body.order).toBeUndefined();
      expect(body.buyerName).toBeUndefined();
      expect(mocks.calls).toHaveLength(0);
    },
  );
});

describe("POST /api/check-in — entrada pela lista (ticketId)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.tables = {
      tickets: { single: { ...currentTicket, checked_in_at: null, checked_in_by: null }, list: orderTickets },
    };
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } } });
    mocks.loginState.mockResolvedValue({
      data: [{ status: "verificado", user_id: staffUserId, session_id: sessionId, code_expires_at: null, resend_at: null }],
      error: null,
    });
    mocks.adminRpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.maybeSingle.mockResolvedValue({ data: okRow, error: null });
  });

  it("acha o código no servidor (só deste evento) e chama a MESMA função do banco", async () => {
    const response = await post({ eventId, sessionId, ticketId });
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith("check_in_ticket", {
      p_event_id: eventId,
      p_session_id: sessionId,
      p_code: code,
      p_staff_user_id: staffUserId,
    });
    expect(mocks.calls[0]).toEqual({
      table: "tickets",
      filters: [
        ["event_id", eventId],
        ["id", ticketId],
      ],
    });
    expect(JSON.stringify(await response.json())).not.toContain(code);
  });

  it("ingresso que não é do evento vai com código vazio: a função confere acesso e recusa", async () => {
    mocks.tables.tickets = { single: null };
    mocks.maybeSingle.mockResolvedValue({ data: { outcome: "nao_encontrado" }, error: null });
    const response = await post({ eventId, sessionId, ticketId });
    expect(response.status).toBe(404);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "check_in_ticket",
      expect.objectContaining({ p_code: "" }),
    );
  });

  it("sem permissão no evento: a função do banco nega (403)", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "CHECKIN_EQUIPE: Acesso restrito à equipe.", code: "P0001" },
    });
    const response = await post({ eventId, sessionId, ticketId });
    expect(response.status).toBe(403);
  });

  it.each([
    ["código e id juntos", { eventId, sessionId, code, ticketId }],
    ["id que não é UUID", { eventId, sessionId, ticketId: "abc" }],
    ["id de tipo errado", { eventId, sessionId, ticketId: 5 }],
    ["sem código nem id", { eventId, sessionId }],
  ])("%s responde 400", async (_caso, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("falha ao achar o ingresso responde erro genérico sem registrar entrada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.tables.tickets = { error: { code: "XX000", message: "falhou" } };
    const response = await post({ eventId, sessionId, ticketId });
    expect(response.status).toBe(500);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
