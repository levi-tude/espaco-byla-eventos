import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  insert: vi.fn(),
  deleteEq: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        like: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: { slug: "show" }, error: null }),
        single: async () => ({ data: { id: "evento-novo" }, error: null }),
        insert: (row: unknown) => {
          mocks.insert(row);
          return chain;
        },
        delete: () => ({ eq: mocks.deleteEq }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { cover_image_url: null }, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/media/storage", () => ({
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
}));

import { createEvent, updateEvent } from "@/app/equipe/eventos/actions";

const eventId = "00000000-0000-4000-8000-000000000001";
const customId = "30000000-0000-4000-8000-000000000001";
const input = {
  name: "Show",
  startsAt: "2026-12-01T20:00",
  venue: "Espaço Byla",
  description: "",
  capacity: 100,
  ticketTypes: [
    { preset: "inteira" as const, priceCents: 5000, maxUnits: null },
    { preset: "casadinha" as const, priceCents: 9000, maxUnits: 20 },
    {
      preset: null,
      id: customId,
      name: "Mesa",
      peoplePerUnit: 6,
      priceCents: 30000,
      maxUnits: null,
    },
  ],
};

const rpcTypes = [
  { preset: "inteira", price_cents: 5000, max_units: null },
  { preset: "casadinha", price_cents: 9000, max_units: 20 },
  { id: customId, name: "Mesa", people_per_unit: 6, price_cents: 30000, max_units: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.adminRpc.mockResolvedValue({ error: null });
  mocks.deleteEq.mockResolvedValue({ error: null });
});

describe("tipos de ingresso ao criar evento", () => {
  it("cria o evento sem preços e grava os tipos pela função do banco", async () => {
    expect(await createEvent(input)).toEqual({ ok: true, data: { id: "evento-novo" } });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ full_price_cents: expect.anything() }),
    );
    expect(mocks.adminRpc).toHaveBeenCalledWith("save_event_ticket_types", {
      p_event_id: "evento-novo",
      p_types: rpcTypes,
    });
  });

  it("se os tipos forem recusados, desfaz o evento e explica", async () => {
    mocks.adminRpc.mockResolvedValue({ error: { message: "TIPOS_NOME_RESERVADO:Inteira" } });
    expect(await createEvent(input)).toEqual({
      ok: false,
      error: "O nome “Inteira” é de um tipo pronto. Use outro nome para o tipo novo.",
    });
    expect(mocks.deleteEq).toHaveBeenCalledWith("id", "evento-novo");
  });

  it("tipo marcado sem preço é recusado antes do banco", async () => {
    const result = await createEvent({
      ...input,
      ticketTypes: [{ preset: "familia", priceCents: 0, maxUnits: null }],
    });
    expect(result).toEqual({ ok: false, error: "Informe um preço válido para “Pacote família”." });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("tipos de ingresso ao editar evento", () => {
  it("salva evento e tipos juntos, na mesma função", async () => {
    expect(await updateEvent(eventId, input)).toEqual({ ok: true, data: undefined });
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "update_event_with_capacity",
      expect.objectContaining({ p_event_id: eventId, p_ticket_types: rpcTypes }),
    );
  });

  it("tipo com vendas não pode mudar o número de pessoas", async () => {
    mocks.adminRpc.mockResolvedValue({
      error: { message: "TIPOS_PESSOAS_COM_VENDAS:Mesa" },
    });
    expect(await updateEvent(eventId, input)).toEqual({
      ok: false,
      error:
        "“Mesa” já tem vendas, então o número de pessoas não pode mudar. Crie um tipo novo se precisar.",
    });
  });

  it("limite abaixo do já vendido é recusado com o número", async () => {
    mocks.adminRpc.mockResolvedValue({ error: { message: "TIPOS_LIMITE_MENOR:7:Casadinha" } });
    expect(await updateEvent(eventId, input)).toEqual({
      ok: false,
      error: "O limite de “Casadinha” não pode ser menor que 7 (já vendidos ou reservados).",
    });
  });

  it("nenhum tipo marcado é recusado antes do banco", async () => {
    expect(await updateEvent(eventId, { ...input, ticketTypes: [] })).toEqual({
      ok: false,
      error: "Marque pelo menos um tipo de ingresso para vender.",
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});
