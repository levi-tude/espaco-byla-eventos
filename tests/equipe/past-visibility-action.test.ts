import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { setHiddenFromPast } from "@/app/equipe/eventos/actions";

const eventId = "00000000-0000-4000-8000-000000000001";

function updateChain(result: { data: unknown; error: unknown }) {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

describe("setHiddenFromPast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("recusa quem não é da equipe sem tocar no banco", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await setHiddenFromPast(eventId, true)).toEqual({
      ok: false,
      error: "Acesso restrito à equipe.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("recusa id inválido", async () => {
    expect(await setHiddenFromPast("abc", true)).toEqual({
      ok: false,
      error: "Evento não encontrado.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("recusa valor que não é ligado/desligado", async () => {
    expect(await setHiddenFromPast(eventId, "sim" as unknown as boolean)).toEqual({
      ok: false,
      error: "Evento não encontrado.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("grava e atualiza a página inicial e a do evento", async () => {
    const chain = updateChain({ data: { slug: "show" }, error: null });
    mocks.from.mockReturnValue(chain);

    expect(await setHiddenFromPast(eventId, true)).toEqual({ ok: true, data: undefined });
    expect(mocks.from).toHaveBeenCalledWith("events");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ hidden_from_past: true }),
    );
    expect(chain.eq).toHaveBeenCalledWith("id", eventId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });

  it("falha do banco vira mensagem genérica", async () => {
    mocks.from.mockReturnValue(updateChain({ data: null, error: { message: "boom" } }));
    expect(await setHiddenFromPast(eventId, false)).toEqual({
      ok: false,
      error: "Não foi possível alterar a exibição do evento.",
    });
  });

  it("evento inexistente (nenhuma linha) também falha", async () => {
    mocks.from.mockReturnValue(updateChain({ data: null, error: null }));
    expect(await setHiddenFromPast(eventId, false)).toEqual({
      ok: false,
      error: "Não foi possível alterar a exibição do evento.",
    });
  });
});
