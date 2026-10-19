import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  adminRpc: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  function testCache<T extends (...args: unknown[]) => unknown>(fn: T): T {
    const stored = new Map<string, ReturnType<T>>();
    return ((...args: Parameters<T>) => {
      const key = JSON.stringify(args);
      if (!stored.has(key)) {
        stored.set(key, fn(...args) as ReturnType<T>);
      }
      return stored.get(key)!;
    }) as T;
  }
  return { ...actual, cache: testCache };
});
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { ACCESS_DENIED_MESSAGE, EVENT_NOT_FOUND_MESSAGE } from "@/lib/auth/actor";

const userId = "00000000-0000-4000-8000-0000000000aa";
const eventId = "00000000-0000-4000-8000-000000000001";

type RpcResult = { data: unknown; error: unknown };

type ActorModule = typeof import("@/lib/auth/actor");
type ActionErrorClass = typeof import("@/lib/action-result").ActionError;

let actorModule: ActorModule;
let ActionError: ActionErrorClass;

/** Respostas das funções do banco chamadas com a sessão do usuário. */
function session(answers: { is_staff?: RpcResult; is_organizer?: RpcResult }) {
  mocks.rpc.mockImplementation(async (name: string) => {
    const answer = answers[name as keyof typeof answers];
    return answer ?? { data: false, error: null };
  });
}

/** Respostas das funções do banco chamadas com a chave do servidor. */
function server(answers: { staff_finance_role?: RpcResult; actor_event_access?: RpcResult }) {
  mocks.adminRpc.mockImplementation(async (name: string) => {
    const answer = answers[name as keyof typeof answers];
    return answer ?? { data: null, error: null };
  });
}

const yes = { data: true, error: null };
const no = { data: false, error: null };
const failure = { data: null, error: { code: "XX000", message: "falhou" } };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc });
  session({});
  server({});
  ({ ActionError } = await import("@/lib/action-result"));
  actorModule = await import("@/lib/auth/actor");
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("esperava recusa");
}

describe("getActor / requireActor", () => {
  it("sem login: nulo e recusa com mensagem genérica", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await actorModule.getActor()).toBeNull();
    const error = await rejection(actorModule.requireActor());
    expect(error).toBeInstanceOf(ActionError);
    expect((error as Error).message).toBe(ACCESS_DENIED_MESSAGE);
    expect(ACCESS_DENIED_MESSAGE).toBe("Acesso não permitido.");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("erro ao ler o usuário: nulo", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "jwt" } });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("equipe Admin desenvolvedor", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: { data: "admin_dev", error: null } });
    expect(await actorModule.getActor()).toEqual({ kind: "equipe", userId, isAdmin: true, isDeveloper: true });
    expect(mocks.adminRpc).toHaveBeenCalledWith("staff_finance_role", { p_staff_user_id: userId });
  });

  it("equipe Admin do Espaço", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: { data: "admin", error: null } });
    expect(await actorModule.getActor()).toEqual({ kind: "equipe", userId, isAdmin: true, isDeveloper: false });
  });

  it("secretaria", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: { data: "secretaria", error: null } });
    expect(await actorModule.getActor()).toEqual({ kind: "equipe", userId, isAdmin: false, isDeveloper: false });
  });

  it("organizador", async () => {
    session({ is_staff: no, is_organizer: yes });
    expect(await actorModule.getActor()).toEqual({ kind: "organizador", userId });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("nem equipe nem organizador: nulo", async () => {
    session({ is_staff: no, is_organizer: no });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("falha em is_staff e is_organizer: nulo (falha fechada)", async () => {
    session({ is_staff: failure, is_organizer: failure });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("falha em is_staff mesmo com is_organizer verdadeiro: nulo", async () => {
    session({ is_staff: failure, is_organizer: yes });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("falha em is_organizer mesmo com is_staff verdadeiro: nulo", async () => {
    session({ is_staff: yes, is_organizer: failure });
    server({ staff_finance_role: { data: "admin", error: null } });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("falha em is_organizer sem equipe: nulo", async () => {
    session({ is_staff: no, is_organizer: failure });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("falha ao ler o papel da equipe: nulo", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: failure });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("resposta que não é verdadeiro estrito não conta", async () => {
    session({ is_staff: { data: "true", error: null }, is_organizer: { data: 1, error: null } });
    expect(await actorModule.getActor()).toBeNull();
  });

  it("duas chamadas seguidas consultam o usuário só uma vez", async () => {
    session({ is_organizer: yes });
    await actorModule.getActor();
    await actorModule.getActor();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
});

describe("requireOrganizer", () => {
  it("devolve o organizador", async () => {
    session({ is_organizer: yes });
    expect(await actorModule.requireOrganizer()).toEqual({ userId });
  });

  it("recusa equipe", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: { data: "admin", error: null } });
    expect(((await rejection(actorModule.requireOrganizer())) as Error).message).toBe(ACCESS_DENIED_MESSAGE);
  });

  it("recusa sem login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(((await rejection(actorModule.requireOrganizer())) as Error).message).toBe(ACCESS_DENIED_MESSAGE);
  });
});

describe("requireTeamAdmin", () => {
  it("devolve o Admin e se é desenvolvedor", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: { data: "admin_dev", error: null } });
    expect(await actorModule.requireTeamAdmin()).toEqual({ userId, isDeveloper: true });
  });

  it("recusa secretaria", async () => {
    session({ is_staff: yes });
    server({ staff_finance_role: { data: "secretaria", error: null } });
    expect(((await rejection(actorModule.requireTeamAdmin())) as Error).message).toBe(ACCESS_DENIED_MESSAGE);
  });

  it("recusa organizador", async () => {
    session({ is_organizer: yes });
    expect(((await rejection(actorModule.requireTeamAdmin())) as Error).message).toBe(ACCESS_DENIED_MESSAGE);
  });
});

describe("requireEventAccess", () => {
  it.each([["x"], [""], [null], [undefined], [42], [`${eventId}x`]])(
    "id inválido %j: Evento não encontrado sem tocar no banco",
    async (bad) => {
      const error = await rejection(actorModule.requireEventAccess(bad));
      expect(error).toBeInstanceOf(ActionError);
      expect((error as Error).message).toBe(EVENT_NOT_FOUND_MESSAGE);
      expect(EVENT_NOT_FOUND_MESSAGE).toBe("Evento não encontrado.");
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("sem login: Acesso não permitido", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(((await rejection(actorModule.requireEventAccess(eventId))) as Error).message).toBe(ACCESS_DENIED_MESSAGE);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("equipe com acesso", async () => {
    session({ is_staff: yes });
    server({
      staff_finance_role: { data: "secretaria", error: null },
      actor_event_access: { data: "equipe", error: null },
    });
    expect(await actorModule.requireEventAccess(eventId)).toEqual({
      actor: { kind: "equipe", userId, isAdmin: false, isDeveloper: false },
      access: "equipe",
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("actor_event_access", {
      p_actor_user_id: userId,
      p_event_id: eventId,
    });
  });

  it("dono do evento", async () => {
    session({ is_organizer: yes });
    server({ actor_event_access: { data: "dono", error: null } });
    expect(await actorModule.requireEventAccess(eventId)).toEqual({
      actor: { kind: "organizador", userId },
      access: "dono",
    });
  });

  it("evento de outro dono (nulo): Evento não encontrado", async () => {
    session({ is_organizer: yes });
    server({ actor_event_access: { data: null, error: null } });
    expect(((await rejection(actorModule.requireEventAccess(eventId))) as Error).message).toBe(EVENT_NOT_FOUND_MESSAGE);
  });

  it("valor inesperado: Evento não encontrado", async () => {
    session({ is_organizer: yes });
    server({ actor_event_access: { data: "admin", error: null } });
    expect(((await rejection(actorModule.requireEventAccess(eventId))) as Error).message).toBe(EVENT_NOT_FOUND_MESSAGE);
  });

  it("erro na consulta: Evento não encontrado", async () => {
    session({ is_organizer: yes });
    server({ actor_event_access: failure });
    const error = await rejection(actorModule.requireEventAccess(eventId));
    expect(error).toBeInstanceOf(ActionError);
    expect((error as Error).message).toBe(EVENT_NOT_FOUND_MESSAGE);
  });
});
