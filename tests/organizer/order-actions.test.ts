import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
type Calls = [string, unknown[]][];

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  adminTables: {} as Record<string, (calls: Calls) => Result>,
  revalidatePath: vi.fn(),
  notifyTeam: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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
      const calls: Calls = [];
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              const result = mocks.adminTables[table]?.(calls) ?? { data: null, error: { message: "sem tabela" } };
              return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              calls.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  }),
}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyTeam: mocks.notifyTeam,
  organizerNoticeLink: (path: string) => `https://ingressos.exemplo.com${path}`,
}));

import { cancelOpsRequest, requestOrderRefund } from "@/app/organizador/eventos/order-actions";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const ORDER_ID = "00000000-0000-4000-8000-000000000010";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000020";
const ACCESS_DENIED = { ok: false, error: "Acesso não permitido." };
const REASON = "Comprador desistiu e pediu o dinheiro de volta.";

type Kind = "anonimo" | "equipe" | "organizador";
const state = {
  kind: "organizador" as Kind,
  rpcResults: {} as Record<string, Result>,
};

function adminCalls(name: string) {
  return mocks.adminRpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.kind = "organizador";
  state.rpcResults = {};
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
    if (name === "request_order_refund") return state.rpcResults[name] ?? { data: REQUEST_ID, error: null };
    if (name === "cancel_ops_request") return state.rpcResults[name] ?? { data: true, error: null };
    return { data: null, error: null };
  });
  mocks.adminTables = {
    orders: () => ({ data: { event_id: EVENT_ID, events: { name: "Peça Y" } }, error: null }),
  };
  mocks.notifyTeam.mockResolvedValue("sent");
});

describe("requestOrderRefund", () => {
  it.each([
    ["anônimo", "anonimo"],
    ["conta da equipe", "equipe"],
  ] as const)("recusa %s sem tocar no banco", async (_label, kind) => {
    state.kind = kind;
    expect(await requestOrderRefund(ORDER_ID, REASON)).toEqual(ACCESS_DENIED);
    expect(adminCalls("request_order_refund")).toHaveLength(0);
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it.each(["", "abc", `${ORDER_ID}' or 1=1`, 42])("recusa pedido com ID inválido (%s)", async (invalid) => {
    expect(await requestOrderRefund(invalid as string, REASON)).toEqual({ ok: false, error: "Pedido inválido." });
    expect(adminCalls("request_order_refund")).toHaveLength(0);
  });

  it.each(["", "abcd", "  ok  ", "a".repeat(501), 7])("recusa motivo fora de 5 a 500 caracteres (%s)", async (invalid) => {
    expect(await requestOrderRefund(ORDER_ID, invalid as string)).toEqual({
      ok: false,
      error: "Escreva o motivo (de 5 a 500 caracteres).",
    });
    expect(adminCalls("request_order_refund")).toHaveLength(0);
  });

  it("pedido de outro organizador vira “Evento não encontrado.”", async () => {
    state.rpcResults.request_order_refund = {
      data: null,
      error: { code: "P0001", message: "ORG_DONO: Pedido não encontrado." },
    };
    expect(await requestOrderRefund(ORDER_ID, REASON)).toEqual({ ok: false, error: "Evento não encontrado." });
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("pedido com entrada registrada mostra a mensagem combinada", async () => {
    state.rpcResults.request_order_refund = {
      data: null,
      error: { code: "P0001", message: "ORG_ESTADO:check_in" },
    };
    expect(await requestOrderRefund(ORDER_ID, REASON)).toEqual({
      ok: false,
      error: "Este pedido já tem ingresso usado na entrada.",
    });
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("erro inesperado vira mensagem genérica e não vaza detalhes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpcResults.request_order_refund = {
      data: null,
      error: { code: "08006", message: "connection refused 10.0.0.1:5432" },
    };
    expect(await requestOrderRefund(ORDER_ID, REASON)).toEqual({
      ok: false,
      error: "Não foi possível enviar o pedido de estorno.",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("10.0.0.1");
  });

  it("envia pelo banco (o dono é conferido pelo pedido) e avisa a equipe", async () => {
    expect(await requestOrderRefund(ORDER_ID, `  ${REASON}  `)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("request_order_refund")).toEqual([
      { p_actor: USER_ID, p_order_id: ORDER_ID, p_reason: REASON },
    ]);
    expect(mocks.notifyTeam).toHaveBeenCalledWith("equipe_pedido_organizador", {
      eventName: "Peça Y",
      requestKind: "estorno",
      note: REASON,
      link: `https://ingressos.exemplo.com/equipe/eventos/${EVENT_ID}`,
    });
    const paths = mocks.revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain(`/organizador/eventos/${EVENT_ID}`);
    expect(paths).toContain(`/equipe/eventos/${EVENT_ID}`);
  });

  it("aviso que falha não desfaz o pedido", async () => {
    mocks.notifyTeam.mockResolvedValue("failed");
    expect(await requestOrderRefund(ORDER_ID, REASON)).toEqual({ ok: true, data: undefined });
  });
});

describe("cancelOpsRequest", () => {
  it.each([
    ["anônimo", "anonimo"],
    ["conta da equipe", "equipe"],
  ] as const)("recusa %s sem tocar no banco", async (_label, kind) => {
    state.kind = kind;
    expect(await cancelOpsRequest(REQUEST_ID)).toEqual(ACCESS_DENIED);
    expect(adminCalls("cancel_ops_request")).toHaveLength(0);
  });

  it.each(["", "x", 3])("recusa ID inválido (%s)", async (invalid) => {
    expect(await cancelOpsRequest(invalid as string)).toEqual({ ok: false, error: "Pedido não encontrado." });
    expect(adminCalls("cancel_ops_request")).toHaveLength(0);
  });

  it("cancela o próprio pedido pendente", async () => {
    expect(await cancelOpsRequest(REQUEST_ID)).toEqual({ ok: true, data: undefined });
    expect(adminCalls("cancel_ops_request")).toEqual([{ p_actor: USER_ID, p_request_id: REQUEST_ID }]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/organizador/eventos/[id]", "page");
  });

  it("pedido que já foi respondido avisa para atualizar", async () => {
    state.rpcResults.cancel_ops_request = { data: false, error: null };
    expect(await cancelOpsRequest(REQUEST_ID)).toEqual({
      ok: false,
      error: "Este pedido já foi respondido. Atualize a página.",
    });
  });

  it("pedido de outro organizador não é encontrado", async () => {
    state.rpcResults.cancel_ops_request = {
      data: null,
      error: { code: "P0001", message: "ORG_DONO: Pedido não encontrado." },
    };
    expect(await cancelOpsRequest(REQUEST_ID)).toEqual({ ok: false, error: "Pedido não encontrado." });
  });
});
