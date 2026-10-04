import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  insert: vi.fn(),
  deleteEq: vi.fn(),
  sessions: { value: [] as { id: string; name: string | null; starts_at: string; ends_at: string | null }[] },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-0000000000ff" } }, error: null }),
    },
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
        is: async () => ({ data: mocks.sessions.value, error: null }),
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

import { createEvent, type EventInput, updateEvent } from "@/app/equipe/eventos/actions";

const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const eventId = "00000000-0000-4000-8000-000000000001";
const customId = "30000000-0000-4000-8000-000000000001";
const sessionId = "40000000-0000-4000-8000-000000000001";

const session = (overrides: Partial<EventInput["sessions"][number]> = {}) => ({
  id: null as string | null,
  name: "",
  startsAt: "2026-12-01T20:00",
  endsAt: "",
  capacity: 100,
  inteiraQuota: 60 as number | null,
  meiaQuota: 40 as number | null,
  prices: [
    { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
    { typeIndex: 1, priceCents: 9000, maxUnits: 20, onSale: true },
    { typeIndex: 2, priceCents: 30000, maxUnits: null, onSale: true },
  ],
  ...overrides,
});

const input: EventInput = {
  name: "Show",
  venue: "Espaço Byla",
  description: "",
  ticketTypes: [
    { preset: "inteira", priceCents: 0, maxUnits: null },
    { preset: "casadinha", priceCents: 0, maxUnits: null },
    { preset: null, id: customId, name: "Mesa", peoplePerUnit: 6, priceCents: 0, maxUnits: null },
  ],
  sessions: [session()],
};

const rpcTypes = [
  { preset: "inteira", price_cents: 5000, max_units: null },
  { preset: "casadinha", price_cents: 9000, max_units: null },
  { id: customId, name: "Mesa", people_per_unit: 6, price_cents: 30000, max_units: null },
];

const rpcSession = {
  id: null,
  name: null,
  starts_at: "2026-12-01T23:00:00.000Z",
  ends_at: null,
  capacity: 100,
  inteira_quota: 60,
  meia_quota: 40,
  prices: [
    { type_index: 0, price_cents: 5000, max_units: null, on_sale: true },
    { type_index: 1, price_cents: 9000, max_units: 20, on_sale: true },
    { type_index: 2, price_cents: 30000, max_units: null, on_sale: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.adminRpc.mockResolvedValue({ error: null });
  mocks.deleteEq.mockResolvedValue({ error: null });
  mocks.sessions.value = [];
});

describe("criar evento com sessões", () => {
  it("cria o evento com o resumo da primeira sessão e grava tudo pela função do banco", async () => {
    expect(await createEvent(input)).toEqual({ ok: true, data: { id: "evento-novo" } });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        capacity: 100,
        inteira_quota: 60,
        meia_quota: 40,
        starts_at: "2026-12-01T23:00:00.000Z",
      }),
    );
    expect(mocks.adminRpc).toHaveBeenCalledWith("save_event_with_sessions", {
      p_event_id: "evento-novo",
      p_name: "Show",
      p_venue: "Espaço Byla",
      p_description: "",
      p_cover_image_url: null,
      p_ticket_types: rpcTypes,
      p_sessions: [rpcSession],
      p_staff_user_id: staffUserId,
    });
  });

  it("várias sessões: o evento nasce com a mais cedo", async () => {
    await createEvent({
      ...input,
      sessions: [session({ startsAt: "2026-12-02T20:00" }), session({ startsAt: "2026-12-01T16:00", capacity: 50, inteiraQuota: null, meiaQuota: null })],
    });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ starts_at: "2026-12-01T19:00:00.000Z", capacity: 50, inteira_quota: null }),
    );
  });

  it("se o banco recusar, desfaz o evento e explica", async () => {
    mocks.adminRpc.mockResolvedValue({ error: { message: "TIPOS_NOME_RESERVADO:Inteira" } });
    expect(await createEvent(input)).toEqual({
      ok: false,
      error: "O nome “Inteira” é de um tipo pronto. Use outro nome para o tipo novo.",
    });
    expect(mocks.deleteEq).toHaveBeenCalledWith("id", "evento-novo");
  });

  it("tipo sem preço em nenhuma sessão é recusado antes do banco", async () => {
    const result = await createEvent({
      ...input,
      sessions: [
        session({
          prices: [
            { typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true },
            { typeIndex: 1, priceCents: null, maxUnits: null, onSale: false },
            { typeIndex: 2, priceCents: 30000, maxUnits: null, onSale: true },
          ],
        }),
      ],
    });
    expect(result).toEqual({ ok: false, error: "Informe o preço de “Casadinha” em pelo menos uma sessão." });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("tipo à venda sem preço é recusado antes do banco", async () => {
    const result = await createEvent({
      ...input,
      sessions: [session({ prices: [{ typeIndex: 0, priceCents: null, maxUnits: null, onSale: true }] })],
    });
    expect(result).toEqual({ ok: false, error: "Informe o preço de “Inteira” (ex.: 45,00)." });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("editar evento com sessões", () => {
  it("salva evento, tipos e sessões juntos, na mesma função", async () => {
    expect(await updateEvent(eventId, { ...input, sessions: [session({ id: sessionId })] })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "save_event_with_sessions",
      expect.objectContaining({
        p_event_id: eventId,
        p_ticket_types: rpcTypes,
        p_sessions: [{ ...rpcSession, id: sessionId }],
        p_staff_user_id: staffUserId,
      }),
    );
  });

  it("evento com id inválido é recusado antes do banco", async () => {
    expect(await updateEvent("x", input)).toEqual({ ok: false, error: "Evento não encontrado." });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ inteiraQuota: 70, meiaQuota: 40 }, "Inteiras + meias não podem passar do total de ingressos (100)."],
    [{ inteiraQuota: 101, meiaQuota: null }, "A quantidade de inteiras não pode passar do total de ingressos."],
    [{ inteiraQuota: 0, meiaQuota: null }, "Use números inteiros nas quantidades de inteiras e meias, ou deixe em branco."],
    [{ inteiraQuota: null, meiaQuota: 2.5 }, "Use números inteiros nas quantidades de inteiras e meias, ou deixe em branco."],
  ])("cota inválida %o é recusada antes do banco", async (quotas, error) => {
    expect(await updateEvent(eventId, { ...input, sessions: [session(quotas)] })).toEqual({ ok: false, error });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      session({ capacity: 10, inteiraQuota: null, meiaQuota: null, prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: 50, onSale: true }, { typeIndex: 1, priceCents: 9000, maxUnits: null, onSale: true }, { typeIndex: 2, priceCents: 30000, maxUnits: null, onSale: true }] }),
      "O limite de “Inteira” (50) passa do total da sessão (10). Diminua o limite ou aumente o total.",
    ],
    [
      session({ prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }, { typeIndex: 1, priceCents: 9000, maxUnits: 31, onSale: true }, { typeIndex: 2, priceCents: 30000, maxUnits: null, onSale: true }] }),
      "O limite de “Casadinha” (31 × 2 pessoas = 62 ingressos) passa da quantidade de inteiras (60). Diminua o limite ou aumente a quantidade de inteiras.",
    ],
  ])("limite fora do total ou da cota é recusado antes do banco (%#)", async (changed, error) => {
    expect(await updateEvent(eventId, { ...input, sessions: [changed] })).toEqual({ ok: false, error });
    expect(await createEvent({ ...input, sessions: [changed] })).toEqual({ ok: false, error });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("erro de várias sessões mostra qual sessão", async () => {
    const result = await updateEvent(eventId, {
      ...input,
      sessions: [session(), session({ startsAt: "2026-12-01T22:00", capacity: 5, inteiraQuota: null, meiaQuota: null, prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }, { typeIndex: 1, priceCents: 9000, maxUnits: 3, onSale: true }, { typeIndex: 2, priceCents: 30000, maxUnits: null, onSale: true }] })],
    });
    expect(result).toEqual({
      ok: false,
      error: "Sessão 2 (ter, 01/12 · 22h00): O limite de “Casadinha” (3 × 2 pessoas = 6 ingressos) passa do total da sessão (5). Diminua o limite ou aumente o total.",
    });
  });

  it("lotação abaixo do já vendido é recusada com a sessão e o número", async () => {
    mocks.adminRpc.mockResolvedValue({ error: { message: "SESSAO_LOTACAO_MENOR:2:7" } });
    const result = await updateEvent(eventId, {
      ...input,
      sessions: [session(), session({ startsAt: "2026-12-01T22:00" })],
    });
    expect(result).toEqual({
      ok: false,
      error: "Sessão 2 (ter, 01/12 · 22h00): O total não pode ser menor que 7 (já vendidos ou reservados).",
    });
  });

  it("remover sessão com vendas explica qual", async () => {
    mocks.sessions.value = [{ id: sessionId, name: "Matinê", starts_at: "2026-12-01T19:00:00.000Z", ends_at: null }];
    mocks.adminRpc.mockResolvedValue({ error: { message: `SESSAO_COM_VENDAS:${sessionId}` } });
    expect(await updateEvent(eventId, input)).toEqual({
      ok: false,
      error: "A sessão Matinê · ter, 01/12 · 16h00 tem vendas e não pode ser removida. Recarregue a página.",
    });
  });

  it("cota abaixo do já vendido (sessão única) sem rótulo de sessão", async () => {
    mocks.adminRpc.mockResolvedValue({ error: { message: "SESSAO_COTA_MENOR:1:inteira:62" } });
    expect(await updateEvent(eventId, input)).toEqual({
      ok: false,
      error: "A quantidade de inteiras não pode ser menor que 62 (já vendidos ou reservados).",
    });
  });

  it("tipo com vendas não pode mudar o número de pessoas", async () => {
    mocks.adminRpc.mockResolvedValue({ error: { message: "TIPOS_PESSOAS_COM_VENDAS:Mesa" } });
    expect(await updateEvent(eventId, input)).toEqual({
      ok: false,
      error: "“Mesa” já tem vendas, então o número de pessoas não pode mudar. Crie um tipo novo se precisar.",
    });
  });

  it("nenhum tipo marcado é recusado antes do banco", async () => {
    expect(await updateEvent(eventId, { ...input, ticketTypes: [] })).toEqual({
      ok: false,
      error: "Marque pelo menos um tipo de ingresso para vender.",
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("sem sessões é recusado antes do banco", async () => {
    expect(await updateEvent(eventId, { ...input, sessions: [] })).toEqual({
      ok: false,
      error: "Cadastre pelo menos uma sessão.",
    });
  });
});
