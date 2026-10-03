import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import {
  cancelTicket,
  createEvent,
  issueCourtesy,
  setSalesOpen,
  updateEvent,
} from "@/app/equipe/eventos/actions";

const eventId = "00000000-0000-4000-8000-000000000001";
const eventInput = {
  name: "Show de teste",
  startsAt: "2026-12-01T20:00",
  venue: "Espaço Byla",
  description: "",
  capacity: 100,
  ticketTypes: [{ preset: "inteira" as const, priceCents: 5000, maxUnits: null }],
};

const staffActions = {
  createEvent: () => createEvent(eventInput),
  updateEvent: () => updateEvent(eventId, eventInput),
  setSalesOpen: () => setSalesOpen(eventId, true),
  issueCourtesy: () =>
    issueCourtesy({ eventId, name: "Convidado", email: "convidado@example.com" }),
  cancelTicket: () => cancelTicket(eventId, "00000000-0000-4000-8000-000000000002"),
};

describe("ações da equipe sem login de equipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
