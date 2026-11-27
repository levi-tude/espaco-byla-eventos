import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loginState: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: (name: string, args: unknown) =>
      name === "login_session_state" ? mocks.loginState() : mocks.rpc(name, args),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/check-in/meia/route";

const eventId = "00000000-0000-4000-8000-000000000001";
const ticketId = "22222222-2222-4222-8222-222222222222";
const userId = "00000000-0000-4000-8000-0000000000ff";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/check-in/meia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function rpcReturns(data: unknown, error: unknown = null) {
  mocks.maybeSingle.mockResolvedValue({ data, error });
}

describe("POST /api/check-in/meia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    mocks.loginState.mockResolvedValue({
      data: [{ status: "verificado", user_id: userId, session_id: "s", code_expires_at: null, resend_at: null }],
      error: null,
    });
    mocks.rpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  });

  it("sem login: 401 sem chamar o banco", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await post({ eventId, ticketId, result: "comprovante_ok" })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sem o código do e-mail confirmado: 403 sem chamar o banco", async () => {
    mocks.loginState.mockResolvedValue({
      data: [{ status: "pendente", user_id: userId, session_id: "s", code_expires_at: null, resend_at: null }],
      error: null,
    });
    expect((await post({ eventId, ticketId, result: "comprovante_ok" })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON quebrado", "{"],
    ["resultado inválido", { eventId, ticketId, result: "talvez" }],
    ["ingresso não é UUID", { eventId, ticketId: "x", result: "recusado" }],
    ["sem evento", { ticketId, result: "recusado" }],
  ])("%s: 400", async (_caso, body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("registra com a sessão do usuário (nunca service_role)", async () => {
    rpcReturns({ outcome: "ok", result: "pagou_diferenca", diff_cents: 2500, checked_at: "2026-11-28T20:05:00Z", checked_in: true });
    const response = await post({ eventId, ticketId, result: "pagou_diferenca" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: "pagou_diferenca",
      diffCents: 2500,
      checkedAt: "2026-11-28T20:05:00Z",
      checkedIn: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("record_meia_check", {
      p_event_id: eventId,
      p_ticket_id: ticketId,
      p_result: "pagou_diferenca",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("recusado devolve checkedIn=false (entrada desfeita)", async () => {
    rpcReturns({ outcome: "ok", result: "recusado", diff_cents: null, checked_at: "2026-11-28T20:05:00Z", checked_in: false });
    const body = await (await post({ eventId, ticketId, result: "recusado" })).json();
    expect(body).toMatchObject({ ok: true, result: "recusado", checkedIn: false });
  });

  it.each([
    ["nao_meia", 409, "Este ingresso não é meia-entrada."],
    ["sem_entrada", 409, "Este ingresso está sem entrada registrada. Leia o QR de novo para dar entrada."],
    ["nao_encontrado", 404, "Ingresso não encontrado."],
  ])("%s vira mensagem clara", async (outcome, status, message) => {
    rpcReturns({ outcome, result: null, diff_cents: null, checked_at: null, checked_in: null });
    const response = await post({ eventId, ticketId, result: "comprovante_ok" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, reason: outcome, message });
  });

  it("banco sem a migration: 503 'ainda não está ativo' (a portaria esconde os botões)", async () => {
    rpcReturns(null, { code: "PGRST202", message: "Could not find the function public.record_meia_check" });
    const response = await post({ eventId, ticketId, result: "comprovante_ok" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, unavailable: true });
  });

  it("sem permissão no evento (MEIA_ACESSO): 403", async () => {
    rpcReturns(null, { code: "P0001", message: "MEIA_ACESSO: Acesso não autorizado." });
    expect((await post({ eventId, ticketId, result: "comprovante_ok" })).status).toBe(403);
  });

  it("erro inesperado: 500 genérico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcReturns(null, { code: "08006", message: "connection refused 10.0.0.1" });
    const response = await post({ eventId, ticketId, result: "comprovante_ok" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: "Não foi possível registrar a conferência" });
  });
});
