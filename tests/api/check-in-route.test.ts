import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  staffProfile: vi.fn(),
  adminRpc: vi.fn(),
  maybeSingle: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: mocks.staffProfile,
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { POST } from "@/app/api/check-in/route";

const eventId = "00000000-0000-4000-8000-000000000001";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const code = "11111111-1111-4111-8111-111111111111";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function rpcReturns(data: unknown, error: unknown = null) {
  mocks.maybeSingle.mockResolvedValue({ data, error });
}

const rejected = {
  buyer_name: null,
  ticket_kind: null,
  type_name: null,
  other_event_name: null,
};

describe("POST /api/check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } } });
    mocks.staffProfile.mockResolvedValue({ data: { user_id: staffUserId } });
    mocks.adminRpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc });
  });

  it("sem login responde 401 sem chamar o banco", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await post({ eventId, code });
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("logado fora da equipe responde 403 sem chamar o banco", async () => {
    mocks.staffProfile.mockResolvedValue({ data: null });
    const response = await post({ eventId, code });
    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON quebrado", "{"],
    ["sem código", { eventId }],
    ["evento não é UUID", { eventId: "abc", code }],
    ["código vazio", { eventId, code: "   " }],
    ["código gigante", { eventId, code: "x".repeat(101) }],
    ["tipos errados", { eventId: 1, code: 2 }],
  ])("%s responde 400", async (_caso, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Dados inválidos" });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("libera chamando só a função do banco, com quem fez o check-in", async () => {
    rpcReturns({
      outcome: "ok",
      buyer_name: "Comprador Teste",
      ticket_kind: "inteira",
      type_name: "Casadinha",
      other_event_name: null,
    });
    const response = await post({ eventId, code: `  ${code}  ` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      buyerName: "Comprador Teste",
      kind: "inteira",
      typeLabel: "Casadinha — Inteira",
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("check_in_ticket", {
      p_event_id: eventId,
      p_code: code,
      p_staff_user_id: staffUserId,
    });
  });

  it("ingresso de outro evento mostra o nome do evento", async () => {
    rpcReturns({ ...rejected, outcome: "evento_errado", other_event_name: "Festa Junina" });
    const response = await post({ eventId, code });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Ingresso de outro evento: Festa Junina",
    });
  });

  it.each([
    ["ja_usado", "Já utilizado", 200],
    ["estornado", "Estornado — não liberar entrada", 200],
    ["nao_pago", "Ingresso não pago", 200],
    ["cancelado", "Cancelado", 200],
    ["nao_encontrado", "Ingresso não encontrado", 404],
    ["algo_novo", "Ingresso inválido — não liberar entrada", 200],
  ])("%s vira mensagem clara", async (outcome, message, status) => {
    rpcReturns({ ...rejected, outcome });
    const response = await post({ eventId, code });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, message });
  });

  it("equipe removida entre a checagem e a função responde 403", async () => {
    rpcReturns(null, { message: "CHECKIN_EQUIPE: Acesso restrito à equipe.", code: "P0001" });
    const response = await post({ eventId, code });
    expect(response.status).toBe(403);
  });

  it("erro inesperado responde mensagem genérica, sem detalhes internos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcReturns(null, { message: "connection refused 10.0.0.1:5432", code: "08006" });
    const response = await post({ eventId, code });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Não foi possível realizar o check-in",
    });
  });
});
