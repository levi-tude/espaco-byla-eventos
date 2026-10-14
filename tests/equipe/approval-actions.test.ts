import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  revalidatePath: vi.fn(),
  notifyOrganizer: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table: string) => {
      const result = () => mocks.tables[table] ?? { data: null, error: { message: "sem tabela" } };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: async () => result(),
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  organizerNoticeLink: (path: string) => `https://ingressos.exemplo.test${path}`,
}));

import {
  declineOpsRequest,
  decideEventApproval,
  finishEventChange,
  finishEventDeletion,
} from "@/app/equipe/aprovacoes/actions";

const STAFF_ID = "00000000-0000-4000-8000-0000000000aa";
const ORGANIZER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const DENIED = { ok: false, error: "Acesso não permitido." };
const EVENT_ROW = { id: EVENT_ID, slug: "peca-de-dezembro", name: "Peça de dezembro", organizer_id: ORGANIZER_ID };

type Role = "admin" | "admin_dev" | "secretaria" | "organizador" | "anonimo";
type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null };

const ACTION_RPCS = ["decide_event_approval", "finish_event_change", "finish_event_deletion", "decline_ops_request"];

function pendingRequest(kind: "estorno" | "mudanca" | "exclusao") {
  return {
    id: REQUEST_ID,
    kind,
    event_id: EVENT_ID,
    event_name: "Peça de dezembro",
    organizer_public_name: "Produtora Fulana",
    order_id: kind === "estorno" ? ORDER_ID : null,
    details: kind === "mudanca" ? { o_que: "Sessão das 19h passa para 20h" } : {},
    reason: "Mudança de agenda do elenco.",
    status: "pendente",
    decision_note: null,
    created_at: "2026-10-14T15:00:00Z",
    decided_at: null,
  };
}

function as(role: Role, results: Record<string, RpcResult> = {}) {
  mocks.getUser.mockResolvedValue(
    role === "anonimo" ? { data: { user: null }, error: null } : { data: { user: { id: STAFF_ID } }, error: null },
  );
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "is_staff") return { data: role !== "organizador" && role !== "anonimo", error: null };
    if (fn === "is_organizer") return { data: role === "organizador", error: null };
    return { data: null, error: { message: "inesperado" } };
  });
  mocks.adminRpc.mockImplementation(async (fn: string) => {
    if (fn === "staff_finance_role") return { data: role, error: null };
    const result = results[fn];
    return { data: result?.data ?? null, error: result?.error ?? null };
  });
}

function calls(fn: string) {
  return mocks.adminRpc.mock.calls.filter(([name]) => name === fn);
}

function actionCalls() {
  return mocks.adminRpc.mock.calls.filter(([name]) => ACTION_RPCS.includes(name));
}

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

function everythingLogged(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args: unknown[]) => args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg))).join(" "))
    .join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleSpies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  mocks.tables = { events: { data: EVENT_ROW, error: null } };
  as("admin");
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore());
});

describe("decideEventApproval", () => {
  it.each(["secretaria", "organizador", "anonimo"] as const)("%s → Acesso não permitido, sem tocar no banco", async (role) => {
    as(role);
    expect(await decideEventApproval(EVENT_ID, { decision: "aprovar", publish: true, note: "" })).toEqual(DENIED);
    expect(actionCalls()).toHaveLength(0);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it.each([["vazio", ""], ["texto", "evento-1"], ["nulo", null]])("ID inválido (%s) → sem chamar o banco", async (_l, id) => {
    expect(await decideEventApproval(id as string, { decision: "aprovar", publish: true, note: "" })).toEqual({
      ok: false,
      error: "Evento não encontrado.",
    });
    expect(actionCalls()).toHaveLength(0);
  });

  it.each([
    ["decisão desconhecida", { decision: "publicar", publish: true, note: "" }],
    ["publicar não booleano", { decision: "aprovar", publish: "sim", note: "" }],
    ["entrada nula", null],
  ])("%s → recusado sem chamar o banco", async (_l, input) => {
    const result = await decideEventApproval(EVENT_ID, input as never);
    expect(result.ok).toBe(false);
    expect(actionCalls()).toHaveLength(0);
  });

  it.each([["sem motivo", ""], ["só espaços", "     "], ["curto", "abc"], ["longo", "a".repeat(501)], ["não texto", 7]])(
    "recusar %s → erro sem chamar o banco nem avisar",
    async (_l, note) => {
      expect(await decideEventApproval(EVENT_ID, { decision: "recusar", publish: false, note: note as string })).toEqual({
        ok: false,
        error: "Escreva o motivo da recusa (de 5 a 500 caracteres).",
      });
      expect(actionCalls()).toHaveLength(0);
      expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    },
  );

  it("aprovar e publicar: chama o banco com o Admin, avisa o organizador e revalida as páginas", async () => {
    expect(await decideEventApproval(EVENT_ID, { decision: "aprovar", publish: true, note: "ignorada" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(calls("decide_event_approval")).toEqual([
      [
        "decide_event_approval",
        { p_admin: STAFF_ID, p_event_id: EVENT_ID, p_decision: "aprovar", p_publish: true, p_note: null },
      ],
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_evento_aprovado",
      expect.objectContaining({
        eventName: "Peça de dezembro",
        link: `https://ingressos.exemplo.test/organizador/eventos/${EVENT_ID}`,
      }),
    );
    for (const path of ["/", "/eventos/peca-de-dezembro", "/equipe/aprovacoes", `/organizador/eventos/${EVENT_ID}`]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("aprovar sem publicar manda p_publish falso", async () => {
    expect((await decideEventApproval(EVENT_ID, { decision: "aprovar", publish: false, note: "" })).ok).toBe(true);
    expect(calls("decide_event_approval")[0][1]).toMatchObject({ p_decision: "aprovar", p_publish: false });
  });

  it("recusar: manda o motivo limpo, nunca publica e avisa com a nota", async () => {
    const result = await decideEventApproval(EVENT_ID, {
      decision: "recusar",
      publish: true,
      note: "  Falta a classificação etária.  ",
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls("decide_event_approval")[0][1]).toEqual({
      p_admin: STAFF_ID,
      p_event_id: EVENT_ID,
      p_decision: "recusar",
      p_publish: false,
      p_note: "Falta a classificação etária.",
    });
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_evento_recusado",
      expect.objectContaining({ eventName: "Peça de dezembro", note: "Falta a classificação etária." }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/aprovacoes");
  });

  it("evento que não é de organizador → não encontrado, sem decidir", async () => {
    mocks.tables.events = { data: { ...EVENT_ROW, organizer_id: null }, error: null };
    expect(await decideEventApproval(EVENT_ID, { decision: "aprovar", publish: true, note: "" })).toEqual({
      ok: false,
      error: "Evento não encontrado.",
    });
    expect(actionCalls()).toHaveLength(0);
  });

  it("erro do banco → mensagem traduzida, sem aviso nem revalidação", async () => {
    as("admin", { decide_event_approval: { error: { message: "ORG_ESTADO:organizador_inativo", code: "P0001" } } });
    expect(await decideEventApproval(EVENT_ID, { decision: "aprovar", publish: true, note: "" })).toEqual({
      ok: false,
      error: "A conta deste organizador não está ativa.",
    });
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("erro desconhecido do banco → mensagem genérica, sem texto cru nos registros", async () => {
    as("admin", { decide_event_approval: { error: { message: "fulana@exemplo.com quebrou", code: "XX000" } } });
    const result = await decideEventApproval(EVENT_ID, { decision: "aprovar", publish: true, note: "" });
    expect(result).toEqual({ ok: false, error: "Não foi possível registrar a decisão. Tente de novo." });
    expect(everythingLogged()).not.toContain("fulana@exemplo.com");
  });
});

describe("finishEventChange", () => {
  it.each(["secretaria", "organizador", "anonimo"] as const)("%s → Acesso não permitido", async (role) => {
    as(role);
    expect(await finishEventChange(REQUEST_ID)).toEqual(DENIED);
    expect(actionCalls()).toHaveLength(0);
  });

  it("ID inválido → sem chamar o banco", async () => {
    expect(await finishEventChange("pedido")).toEqual({ ok: false, error: "Pedido não encontrado." });
    expect(actionCalls()).toHaveLength(0);
  });

  it("marca como feito e avisa o organizador que foi atendido", async () => {
    as("admin", { list_ops_requests: { data: [pendingRequest("mudanca")] } });
    expect(await finishEventChange(REQUEST_ID)).toEqual({ ok: true, data: undefined });
    expect(calls("finish_event_change")).toEqual([
      ["finish_event_change", { p_admin: STAFF_ID, p_request_id: REQUEST_ID }],
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_pedido_respondido",
      expect.objectContaining({ eventName: "Peça de dezembro", requestKind: "mudanca", outcome: "atendido" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/aprovacoes");
  });

  it("pedido já respondido → mensagem do banco traduzida e nenhum aviso", async () => {
    as("admin", {
      list_ops_requests: { data: [] },
      finish_event_change: { error: { message: "ORG_ESTADO:estado", code: "P0001" } },
    });
    expect(await finishEventChange(REQUEST_ID)).toEqual({
      ok: false,
      error: "Esta ação não está disponível agora. Recarregue a página.",
    });
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });
});

describe("finishEventDeletion", () => {
  it.each(["secretaria", "organizador", "anonimo"] as const)("%s → Acesso não permitido", async (role) => {
    as(role);
    expect(await finishEventDeletion(REQUEST_ID)).toEqual(DENIED);
    expect(actionCalls()).toHaveLength(0);
  });

  it("ID inválido → sem chamar o banco", async () => {
    expect(await finishEventDeletion("")).toEqual({ ok: false, error: "Pedido não encontrado." });
    expect(actionCalls()).toHaveLength(0);
  });

  it("sessões ativas → pede para cancelar antes", async () => {
    as("admin", {
      list_ops_requests: { data: [pendingRequest("exclusao")] },
      finish_event_deletion: { error: { message: "ORG_ESTADO:sessoes_ativas", code: "P0001" } },
    });
    expect(await finishEventDeletion(REQUEST_ID)).toEqual({
      ok: false,
      error: "Cancele todas as sessões ativas antes de concluir a exclusão.",
    });
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it("conclui, avisa o organizador e tira o evento do site", async () => {
    as("admin", { list_ops_requests: { data: [pendingRequest("exclusao")] } });
    expect(await finishEventDeletion(REQUEST_ID)).toEqual({ ok: true, data: undefined });
    expect(calls("finish_event_deletion")).toEqual([
      ["finish_event_deletion", { p_admin: STAFF_ID, p_request_id: REQUEST_ID }],
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_pedido_respondido",
      expect.objectContaining({ requestKind: "exclusao", outcome: "atendido" }),
    );
    for (const path of ["/", "/eventos/peca-de-dezembro", "/equipe/aprovacoes"]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });
});

describe("falha ao ler o pedido antes de responder", () => {
  const RETRY = { ok: false, error: "Não foi possível concluir. Tente de novo." };

  it.each([
    ["finishEventChange", () => finishEventChange(REQUEST_ID)],
    ["finishEventDeletion", () => finishEventDeletion(REQUEST_ID)],
    ["declineOpsRequest", () => declineOpsRequest(REQUEST_ID, "Fora do prazo dos Termos.")],
  ])("%s não responde, não avisa e pede para tentar de novo", async (_name, run) => {
    as("admin", { list_ops_requests: { error: { message: "timeout", code: "57014" } } });
    expect(await run()).toEqual(RETRY);
    expect(actionCalls()).toHaveLength(0);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(everythingLogged()).not.toContain("timeout");
  });
});

describe("declineOpsRequest", () => {
  it.each(["organizador", "anonimo"] as const)("%s → recusado sem tocar no banco", async (role) => {
    as(role);
    const result = await declineOpsRequest(REQUEST_ID, "Fora do prazo dos Termos.");
    expect(result.ok).toBe(false);
    expect(actionCalls()).toHaveLength(0);
  });

  it("ID inválido → sem chamar o banco", async () => {
    expect(await declineOpsRequest("abc", "Fora do prazo dos Termos.")).toEqual({
      ok: false,
      error: "Pedido não encontrado.",
    });
    expect(actionCalls()).toHaveLength(0);
  });

  it.each([["sem motivo", ""], ["curto", "abc"], ["longo", "a".repeat(501)], ["não texto", null]])(
    "%s → erro sem chamar o banco",
    async (_l, note) => {
      expect(await declineOpsRequest(REQUEST_ID, note as string)).toEqual({
        ok: false,
        error: "Escreva o motivo da recusa (de 5 a 500 caracteres).",
      });
      expect(actionCalls()).toHaveLength(0);
    },
  );

  it("secretaria pode recusar pedido de estorno e o organizador é avisado", async () => {
    as("secretaria", { list_ops_requests: { data: [pendingRequest("estorno")] } });
    expect(await declineOpsRequest(REQUEST_ID, "  Fora do prazo dos Termos de compra.  ")).toEqual({
      ok: true,
      data: undefined,
    });
    expect(calls("decline_ops_request")).toEqual([
      [
        "decline_ops_request",
        { p_staff: STAFF_ID, p_request_id: REQUEST_ID, p_note: "Fora do prazo dos Termos de compra." },
      ],
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_pedido_respondido",
      expect.objectContaining({
        eventName: "Peça de dezembro",
        requestKind: "estorno",
        outcome: "recusado",
        note: "Fora do prazo dos Termos de compra.",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/equipe/eventos/${EVENT_ID}`);
  });

  it("banco recusa mudança da secretaria (ORG_ACESSO) → Acesso não permitido, sem aviso", async () => {
    as("secretaria", {
      list_ops_requests: { data: [] },
      decline_ops_request: { error: { message: "ORG_ACESSO: Acesso negado.", code: "P0001" } },
    });
    expect(await declineOpsRequest(REQUEST_ID, "Não dá para mudar agora.")).toEqual(DENIED);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("pedido fora da lista (não encontrado): responde e só atualiza a página, sem aviso", async () => {
    as("admin", { list_ops_requests: { data: [] } });
    expect(await declineOpsRequest(REQUEST_ID, "Fora do prazo dos Termos.")).toEqual({ ok: true, data: undefined });
    expect(calls("decline_ops_request")).toHaveLength(1);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls).toEqual([["/equipe/aprovacoes"]]);
  });

  it("Admin recusa mudança com motivo e avisa", async () => {
    as("admin", { list_ops_requests: { data: [pendingRequest("mudanca")] } });
    expect((await declineOpsRequest(REQUEST_ID, "Evento acontece amanhã, vamos conversar.")).ok).toBe(true);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(
      ORGANIZER_ID,
      "org_pedido_respondido",
      expect.objectContaining({ requestKind: "mudanca", outcome: "recusado" }),
    );
  });
});
