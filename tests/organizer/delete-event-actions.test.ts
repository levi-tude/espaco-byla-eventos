import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
type Calls = [string, unknown[]][];

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  adminQueries: [] as { table: string; calls: Calls }[],
  adminTables: {} as Record<string, (calls: Calls) => Result>,
  revalidatePath: vi.fn(),
  notifyTeam: vi.fn(),
  removeMediaObjects: vi.fn(),
  mediaObjectExists: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table: string) => {
      const query = { table, calls: [] as Calls };
      mocks.adminQueries.push(query);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              mocks.order.push(`from:${table}`);
              const result = mocks.adminTables[table]?.(query.calls) ?? {
                data: null,
                error: { message: "sem tabela" },
              };
              return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.calls.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  }),
}));
vi.mock("@/lib/media/storage", () => ({
  mediaObjectExists: mocks.mediaObjectExists,
  removeMediaObjects: mocks.removeMediaObjects,
}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyTeam: mocks.notifyTeam,
  organizerNoticeLink: (path: string) => `https://ingressos.exemplo.com${path}`,
}));

import { deleteOwnEvent, requestEventDeletion } from "@/app/organizador/eventos/actions";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-000000000009";
const MEDIA = "https://proj.supabase.co/storage/v1/object/public/event-media";
const COVER_PATH = "covers/11111111-1111-4111-8111-111111111111.webp";
const GALLERY_PATHS = [
  `events/${EVENT_ID}/22222222-2222-4222-8222-222222222222.webp`,
  `events/${EVENT_ID}/33333333-3333-4333-8333-333333333333.jpg`,
];
const ACCESS_DENIED = { ok: false, error: "Acesso não permitido." };
const NOT_FOUND = { ok: false, error: "Evento não encontrado." };
const REASON = "O artista cancelou a turnê inteira.";

type Kind = "anonimo" | "equipe" | "organizador";
const state = {
  kind: "organizador" as Kind,
  access: "dono" as string | null,
  rpcResults: {} as Record<string, Result>,
  coverUsedElsewhere: false,
};

function as(kind: Kind, access: string | null = kind === "organizador" ? "dono" : kind === "equipe" ? "equipe" : null) {
  state.kind = kind;
  state.access = access;
}

function adminCalls(name: string) {
  return mocks.adminRpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args);
}

function removedPaths(): string[] {
  return mocks.removeMediaObjects.mock.calls.flatMap(([paths]) => paths as string[]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.adminQueries = [];
  mocks.order = [];
  as("organizador");
  state.rpcResults = {};
  state.coverUsedElsewhere = false;
  mocks.getUser.mockImplementation(async () => ({
    data: { user: state.kind === "anonimo" ? null : { id: USER_ID } },
    error: null,
  }));
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      (name === "is_staff" && state.kind === "equipe") ||
      (name === "is_organizer" && state.kind === "organizador"),
    error: null,
  }));
  mocks.adminRpc.mockImplementation(async (name: string) => {
    mocks.order.push(`rpc:${name}`);
    if (name === "staff_finance_role") return { data: "admin", error: null };
    if (name === "actor_event_access") return { data: state.access, error: null };
    if (name === "delete_own_event") return state.rpcResults[name] ?? { data: "apagado", error: null };
    if (name === "request_event_deletion") {
      return state.rpcResults[name] ?? { data: "00000000-0000-4000-8000-000000000030", error: null };
    }
    return { data: null, error: null };
  });
  mocks.adminTables = {
    events: (calls) =>
      calls.some(([method]) => method === "like")
        ? { data: state.coverUsedElsewhere ? [{ id: OTHER_EVENT_ID }] : [], error: null }
        : { data: { slug: "peca-y", name: "Peça Y", cover_image_url: `${MEDIA}/${COVER_PATH}` }, error: null },
    event_images: () => ({
      data: [
        ...GALLERY_PATHS.map((storage_path) => ({ storage_path })),
        { storage_path: `events/${OTHER_EVENT_ID}/44444444-4444-4444-8444-444444444444.webp` },
      ],
      error: null,
    }),
  };
  mocks.removeMediaObjects.mockResolvedValue(undefined);
  mocks.notifyTeam.mockResolvedValue("sent");
});

describe("deleteOwnEvent", () => {
  it("recusa quem não entrou", async () => {
    as("anonimo");
    expect(await deleteOwnEvent(EVENT_ID, "Peça Y")).toEqual(ACCESS_DENIED);
    expect(adminCalls("delete_own_event")).toHaveLength(0);
  });

  it("recusa a conta da equipe (esta ação é só do dono)", async () => {
    as("equipe");
    expect(await deleteOwnEvent(EVENT_ID, "Peça Y")).toEqual(ACCESS_DENIED);
    expect(adminCalls("delete_own_event")).toHaveLength(0);
  });

  it("recusa evento de outro organizador", async () => {
    as("organizador", null);
    expect(await deleteOwnEvent(EVENT_ID, "Peça Y")).toEqual(NOT_FOUND);
    expect(adminCalls("delete_own_event")).toHaveLength(0);
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it.each(["", "abc", 5])("recusa ID inválido (%s)", async (invalid) => {
    expect(await deleteOwnEvent(invalid as string, "Peça Y")).toEqual(NOT_FOUND);
    expect(adminCalls("delete_own_event")).toHaveLength(0);
  });

  it.each(["", "   ", "x".repeat(201), 9])("pede o nome digitado (%s)", async (invalid) => {
    expect(await deleteOwnEvent(EVENT_ID, invalid as string)).toEqual({
      ok: false,
      error: "Digite o nome do evento para confirmar.",
    });
    expect(adminCalls("delete_own_event")).toHaveLength(0);
  });

  it("evento sem nenhum pedido: apaga e remove capa e fotos lidas antes, depois vai para Meus eventos", async () => {
    await expect(deleteOwnEvent(EVENT_ID, "  Peça Y ")).rejects.toThrow("NEXT_REDIRECT:/organizador");
    expect(adminCalls("delete_own_event")).toEqual([
      { p_actor: USER_ID, p_event_id: EVENT_ID, p_confirm_name: "Peça Y" },
    ]);
    const rpcAt = mocks.order.indexOf("rpc:delete_own_event");
    expect(mocks.order.indexOf("from:event_images")).toBeLessThan(rpcAt);
    expect(mocks.order.indexOf("from:events")).toBeLessThan(rpcAt);
    expect(removedPaths().sort()).toEqual([COVER_PATH, ...GALLERY_PATHS].sort());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/organizador");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/peca-y");
  });

  it("capa usada por outro evento não é apagada", async () => {
    state.coverUsedElsewhere = true;
    await expect(deleteOwnEvent(EVENT_ID, "Peça Y")).rejects.toThrow("NEXT_REDIRECT:/organizador");
    expect(removedPaths()).not.toContain(COVER_PATH);
    expect(removedPaths().sort()).toEqual([...GALLERY_PATHS].sort());
  });

  it("falha ao limpar os arquivos depois de apagar: a exclusão vale e vai para Meus eventos", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.removeMediaObjects.mockRejectedValue(new Error(`sem chave para ${COVER_PATH}`));
    await expect(deleteOwnEvent(EVENT_ID, "Peça Y")).rejects.toThrow("NEXT_REDIRECT:/organizador");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/organizador");
    expect(log).toHaveBeenCalledWith("[organizador] Falha ao apagar os arquivos do evento apagado.", "Error");
    expect(JSON.stringify(log.mock.calls)).not.toContain(COVER_PATH);
  });

  it("exclusão lógica (pedidos expirados) mantém os arquivos", async () => {
    state.rpcResults.delete_own_event = { data: "excluido", error: null };
    await expect(deleteOwnEvent(EVENT_ID, "Peça Y")).rejects.toThrow("NEXT_REDIRECT:/organizador");
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("evento que já teve vendas manda usar “Pedir exclusão”", async () => {
    state.rpcResults.delete_own_event = { data: null, error: { code: "P0001", message: "ORG_ESTADO:com_vendas" } };
    expect(await deleteOwnEvent(EVENT_ID, "Peça Y")).toEqual({
      ok: false,
      error: "Este evento já teve vendas. Use “Pedir exclusão”.",
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("nome que não confere vira mensagem clara", async () => {
    state.rpcResults.delete_own_event = {
      data: null,
      error: { code: "P0001", message: "ORG_DADOS: O nome digitado não confere." },
    };
    expect(await deleteOwnEvent(EVENT_ID, "Outro nome")).toEqual({
      ok: false,
      error: "O nome digitado não confere. Digite o nome do evento como aparece na tela.",
    });
  });

  it("resposta estranha do banco não apaga arquivos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpcResults.delete_own_event = { data: "outra-coisa", error: null };
    expect(await deleteOwnEvent(EVENT_ID, "Peça Y")).toEqual({
      ok: false,
      error: "Não foi possível excluir o evento.",
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});

describe("requestEventDeletion", () => {
  it.each([
    ["anônimo", "anonimo"],
    ["conta da equipe", "equipe"],
  ] as const)("recusa %s", async (_label, kind) => {
    as(kind);
    expect(await requestEventDeletion(EVENT_ID, REASON)).toEqual(ACCESS_DENIED);
    expect(adminCalls("request_event_deletion")).toHaveLength(0);
  });

  it("recusa evento de outro organizador", async () => {
    as("organizador", null);
    expect(await requestEventDeletion(EVENT_ID, REASON)).toEqual(NOT_FOUND);
    expect(adminCalls("request_event_deletion")).toHaveLength(0);
  });

  it.each(["", "abcd", "a".repeat(501)])("recusa motivo inválido (%s)", async (invalid) => {
    expect(await requestEventDeletion(EVENT_ID, invalid)).toEqual({
      ok: false,
      error: "Escreva o motivo (de 5 a 500 caracteres).",
    });
    expect(adminCalls("request_event_deletion")).toHaveLength(0);
  });

  it("envia o pedido (vendas pausam no banco) e avisa a equipe", async () => {
    expect(await requestEventDeletion(EVENT_ID, REASON)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("request_event_deletion")).toEqual([
      { p_actor: USER_ID, p_event_id: EVENT_ID, p_reason: REASON },
    ]);
    expect(mocks.notifyTeam).toHaveBeenCalledWith("equipe_pedido_organizador", {
      eventName: "Peça Y",
      requestKind: "exclusao",
      note: REASON,
      link: "https://ingressos.exemplo.com/equipe/aprovacoes",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/organizador/eventos/${EVENT_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/peca-y");
  });

  it("evento sem vendas manda usar “Excluir evento”", async () => {
    state.rpcResults.request_event_deletion = {
      data: null,
      error: { code: "P0001", message: "ORG_ESTADO:sem_vendas" },
    };
    expect(await requestEventDeletion(EVENT_ID, REASON)).toEqual({
      ok: false,
      error: "Este evento não tem vendas. Use “Excluir evento”.",
    });
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("aviso que falha não desfaz o pedido", async () => {
    mocks.notifyTeam.mockResolvedValue("failed");
    expect(await requestEventDeletion(EVENT_ID, REASON)).toEqual({ ok: true, data: undefined });
  });
});
