import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
type Calls = [string, unknown[]][];

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  serverFrom: vi.fn(),
  adminRpc: vi.fn(),
  adminQueries: [] as { table: string; calls: Calls }[],
  adminTables: {} as Record<string, (calls: Calls) => Result>,
  revalidatePath: vi.fn(),
  notifyTeam: vi.fn(),
  notifyTeamEventSubmitted: vi.fn(),
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: mocks.serverFrom,
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
  notifyTeamEventSubmitted: mocks.notifyTeamEventSubmitted,
  organizerNoticeLink: (path: string) => `https://ingressos.exemplo.com${path}`,
}));

import {
  createOrganizerEvent,
  requestEventChange,
  setOrganizerEventSales,
  setOrganizerSessionSales,
  submitEventForApproval,
  updateOrganizerEvent,
  withdrawEventSubmission,
} from "@/app/organizador/eventos/actions";
import { COVER_IN_USE_MESSAGE, COVER_NOT_FOUND_MESSAGE, COVER_UPLOAD_ONLY_MESSAGE } from "@/lib/media/rules";
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const NEW_EVENT_ID = "00000000-0000-4000-8000-000000000003";
const ACCESS_DENIED = { ok: false, error: "Acesso não permitido." };
const NOT_FOUND = { ok: false, error: "Evento não encontrado." };
const MEDIA = "https://proj.supabase.co/storage/v1/object/public/event-media";

const input = {
  name: "Peça Y",
  venue: "Espaço Byla",
  description: "Uma peça de teatro.",
  ticketTypes: [{ preset: "inteira" as const, priceCents: 5000, maxUnits: null }],
  sessions: [
    {
      id: null,
      name: "",
      startsAt: "2099-12-01T20:00",
      endsAt: "",
      capacity: 80,
      inteiraQuota: null,
      meiaQuota: null,
      prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }],
    },
  ],
  coverImageUrl: `${MEDIA}/covers/11111111-1111-4111-8111-111111111111.webp`,
};

type Kind = "anonimo" | "equipe" | "organizador";
const state = {
  kind: "organizador" as Kind,
  access: "dono" as string | null,
  rateAllowed: true,
  rpcResults: {} as Record<string, Result>,
  /** Resposta da busca "outro evento usa este arquivo de capa?", pelo padrão consultado. */
  coverUsers: (() => ({ data: [], error: null })) as (pattern: string) => Result,
  previousCover: null as string | null,
};

function coverPattern(calls: Calls): string | undefined {
  const like = calls.find(([method, args]) => method === "like" && args[0] === "cover_image_url");
  return like?.[1][1] as string | undefined;
}

function coverQueries() {
  return mocks.adminQueries.filter((q) => q.table === "events" && coverPattern(q.calls) !== undefined);
}

function as(kind: Kind, access: string | null = kind === "organizador" ? "dono" : kind === "equipe" ? "equipe" : null) {
  state.kind = kind;
  state.access = access;
}

function adminCalls(name: string) {
  return mocks.adminRpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args);
}

function revalidated(): string[] {
  return mocks.revalidatePath.mock.calls.map(([path]) => path as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.adminQueries = [];
  as("organizador");
  state.rateAllowed = true;
  state.rpcResults = {};
  state.coverUsers = () => ({ data: [], error: null });
  state.previousCover = null;
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
    if (name === "staff_finance_role") return { data: "admin", error: null };
    if (name === "actor_event_access") return { data: state.access, error: null };
    if (name === "consume_rate_limit") return { data: state.rateAllowed, error: null };
    if (name === "create_organizer_event") {
      return state.rpcResults[name] ?? { data: NEW_EVENT_ID, error: null };
    }
    return state.rpcResults[name] ?? { data: null, error: null };
  });
  mocks.adminTables = {
    events: (calls) => {
      const pattern = coverPattern(calls);
      if (pattern !== undefined) return state.coverUsers(pattern);
      return calls.some(([method]) => method === "like")
        ? { data: [{ slug: "peca-y" }], error: null }
        : { data: { slug: "peca-y", name: "Peça Y", cover_image_url: state.previousCover }, error: null };
    },
    event_sessions: () => ({ data: { event_id: EVENT_ID }, error: null }),
  };
  mocks.mediaObjectExists.mockResolvedValue(true);
  mocks.notifyTeam.mockResolvedValue("sent");
  mocks.notifyTeamEventSubmitted.mockResolvedValue("sent");
});

const actions: [string, () => Promise<unknown>][] = [
  ["createOrganizerEvent", () => createOrganizerEvent(input)],
  ["updateOrganizerEvent", () => updateOrganizerEvent(EVENT_ID, input)],
  ["submitEventForApproval", () => submitEventForApproval(EVENT_ID)],
  ["withdrawEventSubmission", () => withdrawEventSubmission(EVENT_ID)],
  ["setOrganizerEventSales", () => setOrganizerEventSales(EVENT_ID, false)],
  ["setOrganizerSessionSales", () => setOrganizerSessionSales(SESSION_ID, false)],
  [
    "requestEventChange",
    () => requestEventChange(EVENT_ID, { what: "Mudar o local para o salão 2", reason: "O palco é maior." }),
  ],
];

const WRITE_RPCS = [
  "create_organizer_event",
  "save_event_with_sessions",
  "submit_event_for_approval",
  "withdraw_event_submission",
  "set_event_sales_open",
  "set_session_sales_open",
  "request_event_change",
];

function wroteAnything(): boolean {
  return mocks.adminRpc.mock.calls.some(([name]) => WRITE_RPCS.includes(name as string));
}

describe("quem pode usar as ações do organizador", () => {
  it.each(actions)("%s recusa quem não entrou", async (_name, run) => {
    as("anonimo");
    expect(await run()).toEqual(ACCESS_DENIED);
    expect(wroteAnything()).toBe(false);
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it.each(actions)("%s recusa conta da equipe (área do organizador)", async (_name, run) => {
    as("equipe");
    expect(await run()).toEqual(ACCESS_DENIED);
    expect(wroteAnything()).toBe(false);
  });

  it.each(actions.filter(([name]) => name !== "createOrganizerEvent"))(
    "%s recusa evento de outro organizador",
    async (_name, run) => {
      as("organizador", null);
      expect(await run()).toEqual(NOT_FOUND);
      expect(wroteAnything()).toBe(false);
      expect(mocks.notifyTeam).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["updateOrganizerEvent", () => updateOrganizerEvent("nao-e-uuid", input)],
    ["submitEventForApproval", () => submitEventForApproval("1; drop table")],
    ["withdrawEventSubmission", () => withdrawEventSubmission("")],
    ["setOrganizerEventSales", () => setOrganizerEventSales("x", true)],
    ["requestEventChange", () => requestEventChange("x", { what: "Mudar o nome", reason: "Erro de digitação" })],
  ])("%s com id inválido não consulta nada", async (_name, run) => {
    expect(await run()).toEqual(NOT_FOUND);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("createOrganizerEvent", () => {
  it("cria rascunho com o slug achado pelo servidor e sem abrir vendas", async () => {
    expect(await createOrganizerEvent(input)).toEqual({ ok: true, data: { id: NEW_EVENT_ID } });

    const limit = adminCalls("consume_rate_limit")[0] as Record<string, unknown>;
    expect(limit).toMatchObject({ p_bucket: "org-save:user", p_limit: 120 });
    expect(limit.p_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(limit)).not.toContain(USER_ID);

    // O slug é buscado com a chave do servidor: a RLS esconderia eventos de outros.
    expect(mocks.serverFrom).not.toHaveBeenCalled();
    const slugQuery = mocks.adminQueries.find(
      (q) => q.table === "events" && q.calls.some(([method, args]) => method === "like" && args[0] === "slug"),
    );
    expect(slugQuery?.calls).toContainEqual(["like", ["slug", "peca-y%"]]);

    const [args] = adminCalls("create_organizer_event") as Record<string, unknown>[];
    expect(args).toMatchObject({
      p_actor: USER_ID,
      p_slug: "peca-y-2",
      p_name: "Peça Y",
      p_venue: "Espaço Byla",
      p_description: "Uma peça de teatro.",
      p_cover_image_url: input.coverImageUrl,
    });
    expect(JSON.stringify(args)).not.toContain("sales_open");
    expect(adminCalls("save_event_with_sessions")).toEqual([]);

    expect(revalidated()).toEqual(
      expect.arrayContaining(["/organizador", `/organizador/eventos/${NEW_EVENT_ID}`, "/equipe/aprovacoes"]),
    );
  });

  it("limite de salvamentos: recusa antes de gravar", async () => {
    state.rateAllowed = false;
    expect(await createOrganizerEvent(input)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(adminCalls("create_organizer_event")).toEqual([]);
  });

  it("capa do nosso armazenamento que não chegou é recusada", async () => {
    mocks.mediaObjectExists.mockResolvedValue(false);
    expect(await createOrganizerEvent(input)).toEqual({ ok: false, error: COVER_NOT_FOUND_MESSAGE });
    expect(adminCalls("create_organizer_event")).toEqual([]);
  });

  it("capa que já é de outro evento é recusada (inclusive evento apagado)", async () => {
    state.coverUsers = () => ({ data: [{ id: EVENT_ID }], error: null });
    expect(await createOrganizerEvent(input)).toEqual({ ok: false, error: COVER_IN_USE_MESSAGE });
    expect(adminCalls("create_organizer_event")).toEqual([]);
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();

    const [query] = coverQueries();
    expect(coverPattern(query.calls)).toBe("%covers/11111111-1111-4111-8111-111111111111.webp%");
    expect(query.calls.some(([method]) => method === "is")).toBe(false);
  });

  it("falha ao conferir se a capa é de outro evento: recusa", async () => {
    state.coverUsers = () => ({ data: null, error: { message: "falhou" } });
    expect(await createOrganizerEvent(input)).toEqual({ ok: false, error: COVER_IN_USE_MESSAGE });
    expect(adminCalls("create_organizer_event")).toEqual([]);
  });

  it.each([
    ["link externo", "https://exemplo.com/capa.jpg"],
    ["link externo que imita o caminho", "https://exemplo.com/storage/v1/object/public/event-media/covers/11111111-1111-4111-8111-111111111111.webp"],
    ["foto da galeria, fora de covers/", `${MEDIA}/events/${EVENT_ID}/11111111-1111-4111-8111-111111111111.webp`],
    ["arquivo solto no armazenamento", `${MEDIA}/qualquer.webp`],
  ])("capa por %s é recusada sem consultar nem gravar nada", async (_name, coverImageUrl) => {
    expect(await createOrganizerEvent({ ...input, coverImageUrl })).toEqual({
      ok: false,
      error: COVER_UPLOAD_ONLY_MESSAGE,
    });
    expect(wroteAnything()).toBe(false);
    expect(coverQueries()).toEqual([]);
    expect(mocks.mediaObjectExists).not.toHaveBeenCalled();
  });

  it("sem capa continua permitido (a capa é cobrada só ao enviar para aprovação)", async () => {
    expect(await createOrganizerEvent({ ...input, coverImageUrl: "" })).toEqual({
      ok: true,
      data: { id: NEW_EVENT_ID },
    });
    expect(adminCalls("create_organizer_event")[0]).toMatchObject({ p_cover_image_url: null });
  });

  it("dados inválidos não chegam ao banco", async () => {
    expect(await createOrganizerEvent({ ...input, name: "  " })).toEqual({
      ok: false,
      error: "Preencha nome e local do evento.",
    });
    expect(adminCalls("create_organizer_event")).toEqual([]);
  });

  it.each([
    ["ORG_LOTACAO:100", "Cada sessão pode ter no máximo 100 lugares."],
    ["ORG_DADOS:slug", "Não foi possível criar o endereço do evento. Tente de novo."],
    ["ORG_ACESSO: Acesso negado.", "Acesso não permitido."],
    ["erro interno qualquer", "Não foi possível salvar o evento."],
  ])("erro %s vira mensagem simples", async (message, expected) => {
    state.rpcResults.create_organizer_event = { data: null, error: { code: "P0001", message } };
    expect(await createOrganizerEvent(input)).toEqual({ ok: false, error: expected });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateOrganizerEvent", () => {
  it("salva pela função do banco em nome do dono", async () => {
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("actor_event_access")).toContainEqual({ p_actor_user_id: USER_ID, p_event_id: EVENT_ID });
    expect(adminCalls("save_event_with_sessions")[0]).toMatchObject({
      p_event_id: EVENT_ID,
      p_name: "Peça Y",
      p_venue: "Espaço Byla",
      p_staff_user_id: USER_ID,
    });
    expect(adminCalls("consume_rate_limit")[0]).toMatchObject({ p_bucket: "org-save:user" });
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/organizador", `/organizador/eventos/${EVENT_ID}`, "/equipe/aprovacoes"]),
    );
  });

  it("mudança que pede o Admin vira o texto do botão Pedir mudança", async () => {
    state.rpcResults.save_event_with_sessions = {
      data: null,
      error: { code: "P0001", message: "ORG_ESTADO:mudanca:local,nome" },
    };
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({
      ok: false,
      error:
        "Depois da aprovação, mudar nome do evento e local precisa ser pedido ao Espaço Byla (botão “Pedir mudança”).",
    });
  });

  it("em análise: explica como voltar a editar", async () => {
    state.rpcResults.save_event_with_sessions = { data: null, error: { message: "ORG_ESTADO:em_analise" } };
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({
      ok: false,
      error: "O evento está em análise. Toque em “Voltar para rascunho” para editar.",
    });
  });

  const OLD_COVER = `${MEDIA}/covers/22222222-2222-4222-8222-222222222222.webp`;
  const OLD_PATTERN = "%covers/22222222-2222-4222-8222-222222222222.webp%";

  it("troca de capa enviada apaga a antiga", async () => {
    state.previousCover = OLD_COVER;
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: true, data: undefined });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith(["covers/22222222-2222-4222-8222-222222222222.webp"]);

    // As duas buscas (capa nova e capa antiga) ignoram o próprio evento.
    const queries = coverQueries();
    expect(queries.map((q) => coverPattern(q.calls))).toEqual(
      expect.arrayContaining(["%covers/11111111-1111-4111-8111-111111111111.webp%", OLD_PATTERN]),
    );
    for (const query of queries) expect(query.calls).toContainEqual(["neq", ["id", EVENT_ID]]);
  });

  it("capa que já é de outro evento é recusada sem gravar nem apagar nada", async () => {
    state.previousCover = OLD_COVER;
    state.coverUsers = (pattern) =>
      pattern === OLD_PATTERN ? { data: [], error: null } : { data: [{ id: NEW_EVENT_ID }], error: null };
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: false, error: COVER_IN_USE_MESSAGE });
    expect(adminCalls("save_event_with_sessions")).toEqual([]);
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("capa por link externo é recusada sem gravar nem apagar nada", async () => {
    state.previousCover = OLD_COVER;
    expect(await updateOrganizerEvent(EVENT_ID, { ...input, coverImageUrl: "https://exemplo.com/capa.jpg" })).toEqual({
      ok: false,
      error: COVER_UPLOAD_ONLY_MESSAGE,
    });
    expect(wroteAnything()).toBe(false);
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("manter a própria capa não é recusado nem apaga nada", async () => {
    state.previousCover = input.coverImageUrl;
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: true, data: undefined });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("capa antiga ainda usada por outro evento não é apagada", async () => {
    state.previousCover = OLD_COVER;
    state.coverUsers = (pattern) =>
      pattern === OLD_PATTERN ? { data: [{ id: NEW_EVENT_ID }], error: null } : { data: [], error: null };
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("save_event_with_sessions")).toHaveLength(1);
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("falha ao conferir a capa antiga: mantém o arquivo", async () => {
    state.previousCover = OLD_COVER;
    state.coverUsers = (pattern) =>
      pattern === OLD_PATTERN ? { data: null, error: { message: "falhou" } } : { data: [], error: null };
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: true, data: undefined });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("erro desconhecido ao salvar fica no log (só o código)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpcResults.save_event_with_sessions = { data: null, error: { code: "XX000", message: "erro interno" } };
    expect(await updateOrganizerEvent(EVENT_ID, input)).toEqual({ ok: false, error: "Não foi possível salvar o evento." });
    expect(log).toHaveBeenCalledWith("[organizador] Falha ao salvar o evento.", "XX000");
    log.mockRestore();
  });
});

describe("enviar e voltar para rascunho", () => {
  it("enviar chama o banco e avisa a equipe (uma vez por evento) só no sucesso", async () => {
    expect(await submitEventForApproval(EVENT_ID)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("submit_event_for_approval")).toEqual([{ p_actor: USER_ID, p_event_id: EVENT_ID }]);
    expect(mocks.notifyTeamEventSubmitted).toHaveBeenCalledWith(expect.anything(), EVENT_ID, "Peça Y");
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/organizador", `/organizador/eventos/${EVENT_ID}`, "/equipe/aprovacoes"]),
    );
  });

  it.each([
    ["enviar", () => submitEventForApproval(EVENT_ID), "submit_event_for_approval"],
    ["voltar para rascunho", () => withdrawEventSubmission(EVENT_ID), "withdraw_event_submission"],
  ])("%s tem limite por conta (sem a conta em claro)", async (_name, run, rpc) => {
    expect(await run()).toEqual({ ok: true, data: undefined });
    const limit = adminCalls("consume_rate_limit")[0] as Record<string, unknown>;
    expect(limit).toMatchObject({ p_bucket: "org-submit:user", p_limit: 10, p_window_seconds: 3600 });
    expect(JSON.stringify(limit)).not.toContain(USER_ID);

    vi.clearAllMocks();
    state.rateAllowed = false;
    expect(await run()).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(adminCalls(rpc)).toEqual([]);
    expect(mocks.notifyTeamEventSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    ["ORG_ESTADO:capa", "Adicione uma capa antes de enviar para aprovação."],
    ["ORG_ESTADO:sem_sessao_futura", "Cadastre pelo menos uma sessão com data futura."],
    ["ORG_ESTADO:sem_preco", "Cada sessão precisa de pelo menos um tipo de ingresso à venda."],
    ["ORG_DONO: Evento de outro organizador.", "Evento não encontrado."],
  ])("recusa %s sem avisar a equipe", async (message, expected) => {
    state.rpcResults.submit_event_for_approval = { data: null, error: { message } };
    expect(await submitEventForApproval(EVENT_ID)).toEqual({ ok: false, error: expected });
    expect(mocks.notifyTeamEventSubmitted).not.toHaveBeenCalled();
  });

  it("voltar para rascunho", async () => {
    expect(await withdrawEventSubmission(EVENT_ID)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("withdraw_event_submission")).toEqual([{ p_actor: USER_ID, p_event_id: EVENT_ID }]);
    expect(revalidated()).toContain(`/organizador/eventos/${EVENT_ID}`);
  });

  it("voltar para rascunho fora de análise", async () => {
    state.rpcResults.withdraw_event_submission = { data: null, error: { message: "ORG_ESTADO:estado" } };
    expect(await withdrawEventSubmission(EVENT_ID)).toEqual({
      ok: false,
      error: "Esta ação não está disponível agora. Recarregue a página.",
    });
  });
});

describe("vendas", () => {
  it("pausar o evento chama a função do dono e atualiza o site", async () => {
    expect(await setOrganizerEventSales(EVENT_ID, false)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("set_event_sales_open")).toEqual([
      { p_actor: USER_ID, p_event_id: EVENT_ID, p_open: false },
    ]);
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/", "/eventos/peca-y", "/organizador", `/organizador/eventos/${EVENT_ID}`]),
    );
  });

  it("reabrir antes da aprovação: mensagem do banco", async () => {
    state.rpcResults.set_event_sales_open = { data: null, error: { message: "ORG_ESTADO:nao_aprovado" } };
    expect(await setOrganizerEventSales(EVENT_ID, true)).toEqual({
      ok: false,
      error: "As vendas abrem depois que o Espaço Byla aprovar o evento.",
    });
  });

  it("valor que não é sim/não é recusado", async () => {
    expect(await setOrganizerEventSales(EVENT_ID, "true" as unknown as boolean)).toMatchObject({ ok: false });
    expect(adminCalls("set_event_sales_open")).toEqual([]);
  });

  it("sessão: o evento vem do banco e o acesso é conferido com ele", async () => {
    expect(await setOrganizerSessionSales(SESSION_ID, true)).toEqual({ ok: true, data: undefined });
    const sessionQuery = mocks.adminQueries.find((q) => q.table === "event_sessions");
    expect(sessionQuery?.calls).toContainEqual(["eq", ["id", SESSION_ID]]);
    expect(adminCalls("actor_event_access")).toContainEqual({ p_actor_user_id: USER_ID, p_event_id: EVENT_ID });
    expect(adminCalls("set_session_sales_open")).toEqual([
      { p_session_id: SESSION_ID, p_open: true, p_staff_user_id: USER_ID },
    ]);
    expect(revalidated()).toEqual(expect.arrayContaining(["/", "/eventos/peca-y", `/organizador/eventos/${EVENT_ID}`]));
  });

  it("sessão que não existe: evento não encontrado, sem gravar", async () => {
    mocks.adminTables.event_sessions = () => ({ data: null, error: null });
    expect(await setOrganizerSessionSales(SESSION_ID, false)).toEqual(NOT_FOUND);
    expect(adminCalls("set_session_sales_open")).toEqual([]);
  });

  it("sessão com id inválido", async () => {
    expect(await setOrganizerSessionSales("abc", false)).toMatchObject({ ok: false });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("sessão cancelada ou removida", async () => {
    state.rpcResults.set_session_sales_open = { data: null, error: { message: "SESSAO_INDISPONIVEL: Sessão não encontrada." } };
    expect(await setOrganizerSessionSales(SESSION_ID, true)).toEqual({
      ok: false,
      error: "Esta sessão não está mais disponível. Recarregue a página.",
    });
  });
});

describe("requestEventChange", () => {
  it("cria o pedido e avisa a equipe", async () => {
    expect(
      await requestEventChange(EVENT_ID, { what: "  Mudar o local para o salão 2 ", reason: " O palco é maior. " }),
    ).toEqual({ ok: true, data: undefined });
    expect(adminCalls("request_event_change")).toEqual([
      { p_actor: USER_ID, p_event_id: EVENT_ID, p_what: "Mudar o local para o salão 2", p_reason: "O palco é maior." },
    ]);
    expect(mocks.notifyTeam).toHaveBeenCalledWith("equipe_pedido_organizador", {
      eventName: "Peça Y",
      requestKind: "mudanca",
      note: "O palco é maior.",
      link: "https://ingressos.exemplo.com/equipe/aprovacoes",
    });
    expect(revalidated()).toEqual(expect.arrayContaining([`/organizador/eventos/${EVENT_ID}`, "/equipe/aprovacoes"]));
  });

  it.each([
    [{ what: "abc", reason: "Motivo válido" }, "Descreva a mudança (de 5 a 500 caracteres)."],
    [{ what: "x".repeat(501), reason: "Motivo válido" }, "Descreva a mudança (de 5 a 500 caracteres)."],
    [{ what: "Mudar o nome", reason: "    " }, "Escreva o motivo (de 5 a 500 caracteres)."],
    [{ what: "Mudar o nome", reason: "y".repeat(501) }, "Escreva o motivo (de 5 a 500 caracteres)."],
    [null, "Descreva a mudança (de 5 a 500 caracteres)."],
  ])("valida o texto (%#)", async (body, expected) => {
    expect(await requestEventChange(EVENT_ID, body as { what: string; reason: string })).toEqual({
      ok: false,
      error: expected,
    });
    expect(adminCalls("request_event_change")).toEqual([]);
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it.each([
    ["Local", "Local: "],
    ["Local", "Local:"],
    ["Local", "  Local:   abc  "],
    ["Horário da Sessão 1", "Horário da Sessão 1: x"],
  ])("assunto %s sem conteúdo depois dele é recusado (%#)", async (topic, what) => {
    expect(await requestEventChange(EVENT_ID, { topic, what, reason: "O palco é maior." })).toEqual({
      ok: false,
      error: "Descreva a mudança (de 5 a 500 caracteres).",
    });
    expect(adminCalls("request_event_change")).toEqual([]);
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("assunto seguido de conteúdo é enviado inteiro", async () => {
    expect(
      await requestEventChange(EVENT_ID, { topic: "Local", what: "Local: Salão 2", reason: "O palco é maior." }),
    ).toEqual({ ok: true, data: undefined });
    expect(adminCalls("request_event_change")).toEqual([
      { p_actor: USER_ID, p_event_id: EVENT_ID, p_what: "Local: Salão 2", p_reason: "O palco é maior." },
    ]);
  });

  it("assunto inválido é ignorado e vale o texto inteiro", async () => {
    expect(
      await requestEventChange(EVENT_ID, {
        topic: 42 as unknown as string,
        what: "Mudar o local para o salão 2",
        reason: "O palco é maior.",
      }),
    ).toEqual({ ok: true, data: undefined });
  });

  it("evento ainda não aprovado: manda editar direto, sem aviso", async () => {
    state.rpcResults.request_event_change = { data: null, error: { message: "ORG_ESTADO:nao_aprovado" } };
    expect(await requestEventChange(EVENT_ID, { what: "Mudar o nome", reason: "Erro de digitação" })).toEqual({
      ok: false,
      error: "Antes da aprovação, você mesmo edita o evento no formulário e salva.",
    });
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });
});
