import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";

type Result = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  pathname: "/organizador" as string | null,
  cookies: {} as Record<string, string>,
  readLoginState: vi.fn(),
  getActor: vi.fn(),
  areaEnabled: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  tables: {} as Record<string, Result>,
  queries: [] as { table: string; calls: [string, unknown[]][] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mocks.pathname ? { "x-pathname": mocks.pathname } : {}),
  cookies: async () => ({
    get: (name: string) => (name in mocks.cookies ? { name, value: mocks.cookies[name] } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/auth/login-verification", () => ({ readLoginState: mocks.readLoginState }));
vi.mock("@/lib/auth/actor", () => ({ getActor: mocks.getActor }));
vi.mock("@/lib/organizer/settings", () => ({ organizerAreaEnabled: mocks.areaEnabled }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = { table, calls: [] as [string, unknown[]][] };
      mocks.queries.push(query);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              const result = mocks.tables[table] ?? { data: null, error: { message: "sem tabela" } };
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
vi.mock("@/app/organizador/verificar/actions", () => ({
  startOrganizerLoginAction: vi.fn(),
  resendOrganizerLoginCodeAction: vi.fn(),
  submitOrganizerLoginCodeAction: vi.fn(),
  signOutOrganizerAction: vi.fn(),
}));
vi.mock("@/app/equipe/verificar/actions", () => ({
  resendLoginCodeAction: vi.fn(),
  signOutTeamAction: vi.fn(),
  submitLoginCodeAction: vi.fn(),
}));
vi.mock("@/app/organizador/conta/actions", () => ({ forgetMyDeviceAction: vi.fn() }));

import AccountPage from "@/app/organizador/conta/page";
import { signInOrganizer } from "@/app/organizador/entrar/OrganizerLoginForm";
import EnterPage from "@/app/organizador/entrar/page";
import OrganizerLayout from "@/app/organizador/layout";
import MyEventsPage from "@/app/organizador/page";
import VerifyPage from "@/app/organizador/verificar/page";
import { formatEventDays, organizerEventStatus } from "@/components/organizer/OrganizerEventCard";
import { maskPixKey } from "@/lib/organizer/documents";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

function render(element: ReactNode): string {
  return renderToStaticMarkup(element as ReactElement);
}

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const match = /^NEXT_REDIRECT:(.+)$/.exec((error as Error).message);
    if (!match) throw error;
    return match[1];
  }
}

const loggedOut = { status: "fora", userId: null, sessionId: null, codeExpiresAt: null, resendAt: null };
const verified = { ...loggedOut, status: "verificado", userId: USER_ID, sessionId: "s1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/organizador";
  mocks.cookies = {};
  mocks.tables = {};
  mocks.queries = [];
  mocks.areaEnabled.mockResolvedValue(true);
  mocks.readLoginState.mockResolvedValue(verified);
  mocks.getActor.mockResolvedValue({ kind: "organizador", userId: USER_ID });
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID, email: "fulana@exemplo.com" } }, error: null });
});

describe("layout da área do organizador", () => {
  it.each(["/organizador/entrar", "/organizador/verificar"])("em %s mostra só a página", async (path) => {
    mocks.pathname = path;
    const html = render(await OrganizerLayout({ children: createElement("p", null, "conteúdo") }));
    expect(html).toBe("<p>conteúdo</p>");
    expect(mocks.readLoginState).not.toHaveBeenCalled();
  });

  it("senha certa sem código → tela do código", async () => {
    mocks.readLoginState.mockResolvedValue({ ...verified, status: "pendente" });
    expect(await redirectOf(OrganizerLayout({ children: null }))).toBe("/organizador/verificar");
    expect(mocks.readLoginState).toHaveBeenCalledWith(expect.anything(), "organizador");
  });

  it.each([["sem login", "/organizador"], ["sem cabeçalho de caminho", null]])("%s → entrar", async (_label, path) => {
    mocks.pathname = path;
    mocks.readLoginState.mockResolvedValue(loggedOut);
    expect(await redirectOf(OrganizerLayout({ children: null }))).toBe("/organizador/entrar");
  });

  it("verificado: menu Meus eventos · Minha conta · Sair", async () => {
    mocks.pathname = "/organizador/conta";
    const html = render(await OrganizerLayout({ children: createElement("p", null, "conteúdo") }));
    expect(html).toMatch(/<a[^>]*href="\/organizador"[^>]*>Meus eventos<\/a>/);
    const accountLink = /<a[^>]*href="\/organizador\/conta"[^>]*>Minha conta<\/a>/.exec(html)?.[0];
    expect(accountLink).toContain('aria-current="page"');
    expect(text(html)).toContain("Sair");
    expect(text(html)).toContain("conteúdo");
  });
});

describe("entrar", () => {
  it("área desligada: avisa e não mostra o formulário", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    const html = render(await EnterPage());
    expect(text(html)).toContain("A área do organizador ainda não está disponível.");
    expect(html).not.toMatch(/type="password"/);
    expect(html).not.toMatch(/type="email"/);
  });

  it("área ligada: título, e-mail e senha", async () => {
    const html = render(await EnterPage());
    expect(text(html)).toContain("Área do organizador");
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).not.toMatch(/supabase|resend\b|mercado pago/i);
  });

  function deps({ signInError = null as unknown, start = { ok: true, data: { next: "/organizador/verificar" } } as unknown } = {}) {
    return {
      signIn: vi.fn(async () => ({ error: signInError })),
      start: vi.fn(async () => {
        if (start instanceof Error) throw start;
        return start as { ok: true; data: { next: string } } | { ok: false; error: string };
      }),
      signOut: vi.fn(async () => undefined),
    };
  }

  it("senha errada → mensagem única, sem chamar o servidor", async () => {
    const d = deps({ signInError: { message: "Invalid login credentials" } });
    expect(await signInOrganizer({ email: "fulana@exemplo.com", password: "errada" }, d)).toEqual({
      ok: false,
      error: "Não foi possível entrar",
    });
    expect(d.start).not.toHaveBeenCalled();
  });

  it("conta da equipe (servidor recusa) → mesma mensagem e sai da sessão", async () => {
    const d = deps({ start: { ok: false, error: "Não foi possível entrar." } });
    expect(await signInOrganizer({ email: "equipe@exemplo.com", password: "senha-certa-123" }, d)).toEqual({
      ok: false,
      error: "Não foi possível entrar",
    });
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });

  it("falha inesperada do servidor → mesma mensagem e sai da sessão", async () => {
    const d = deps({ start: new Error("rede") });
    expect(await signInOrganizer({ email: "fulana@exemplo.com", password: "senha-certa-123" }, d)).toEqual({
      ok: false,
      error: "Não foi possível entrar",
    });
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });

  it("senha certa → segue para onde o servidor mandar", async () => {
    const d = deps();
    expect(await signInOrganizer({ email: "fulana@exemplo.com", password: "senha-certa-123" }, d)).toEqual({
      ok: true,
      next: "/organizador/verificar",
    });
    expect(d.signIn).toHaveBeenCalledWith("fulana@exemplo.com", "senha-certa-123");
    expect(d.signOut).not.toHaveBeenCalled();
  });
});

describe("verificar", () => {
  it("sem login → entrar; já verificado → Meus eventos", async () => {
    mocks.readLoginState.mockResolvedValue(loggedOut);
    expect(await redirectOf(VerifyPage())).toBe("/organizador/entrar");
    mocks.readLoginState.mockResolvedValue(verified);
    expect(await redirectOf(VerifyPage())).toBe("/organizador");
    expect(mocks.readLoginState).toHaveBeenCalledWith(expect.anything(), "organizador");
  });

  it("pendente: e-mail mascarado, código e Sair", async () => {
    mocks.readLoginState.mockResolvedValue({
      ...verified,
      status: "pendente",
      codeExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      resendAt: null,
    });
    const html = render(await VerifyPage());
    expect(text(html)).toContain("Confirme que é você");
    expect(text(html)).toContain("fu***@ex***.com");
    expect(html).not.toContain("fulana@exemplo.com");
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(text(html)).toContain("Sair");
  });
});

describe("selos e datas dos cards", () => {
  const future = "2099-12-12T22:00:00Z";
  const past = "2020-01-10T22:00:00Z";

  it.each([
    [{ approvalStatus: "rascunho", salesOpen: false, lastSessionAt: future }, "Rascunho"],
    [{ approvalStatus: "em_analise", salesOpen: false, lastSessionAt: future }, "Em análise"],
    [{ approvalStatus: "recusado", salesOpen: false, lastSessionAt: future }, "Recusado"],
    [{ approvalStatus: "aprovado", salesOpen: true, lastSessionAt: future }, "À venda"],
    [{ approvalStatus: "aprovado", salesOpen: false, lastSessionAt: future }, "Vendas pausadas"],
    [{ approvalStatus: "aprovado", salesOpen: true, lastSessionAt: past }, "Encerrado"],
    [{ approvalStatus: "aprovado", salesOpen: false, lastSessionAt: past }, "Encerrado"],
    [{ approvalStatus: "desconhecido", salesOpen: true, lastSessionAt: future }, "Rascunho"],
  ])("%o → %s", (input, label) => {
    expect(organizerEventStatus(input).label).toBe(label);
  });

  it("datas: mesmo mês junta os dias; meses diferentes ficam separados; uma sessão mostra o horário", () => {
    expect(formatEventDays(["2099-12-12T22:00:00Z", "2099-12-13T22:00:00Z"])).toBe("12 e 13 de dezembro · 2 sessões");
    expect(formatEventDays(["2099-12-12T22:00:00Z", "2099-12-12T23:30:00Z"])).toBe("12 de dezembro · 2 sessões");
    expect(formatEventDays(["2099-11-30T22:00:00Z", "2099-12-01T22:00:00Z", "2099-12-02T22:00:00Z"])).toBe(
      "30 de novembro, 1 e 2 de dezembro · 3 sessões",
    );
    expect(formatEventDays(["2099-12-12T22:00:00Z"])).toBe("12 de dezembro · 19h00");
    expect(formatEventDays([])).toBe("");
  });
});

describe("Meus eventos", () => {
  const SESSION_A = "11111111-1111-4111-8111-111111111111";
  const SESSION_B = "22222222-2222-4222-8222-222222222222";

  function events() {
    mocks.tables.events = {
      error: null,
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Peça Y",
          starts_at: "2099-12-12T22:00:00Z",
          cover_image_url: "https://exemplo.com/capa.jpg",
          sales_open: true,
          approval_status: "aprovado",
          approval_note: null,
          organizer_id: USER_ID,
          event_sessions: [
            { id: SESSION_B, starts_at: "2099-12-13T22:00:00Z", ends_at: null, status: "ativa", archived_at: null, capacity: 50 },
            { id: SESSION_A, starts_at: "2099-12-12T22:00:00Z", ends_at: null, status: "ativa", archived_at: null, capacity: 50 },
            { id: "33333333-3333-4333-8333-333333333333", starts_at: "2099-12-14T22:00:00Z", ends_at: null, status: "cancelada", archived_at: null, capacity: 50 },
          ],
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Show Z",
          starts_at: "2099-11-20T23:00:00Z",
          cover_image_url: null,
          sales_open: false,
          approval_status: "recusado",
          approval_note: "Falta a descrição do show.",
          organizer_id: USER_ID,
          event_sessions: [
            { id: "44444444-4444-4444-8444-444444444444", starts_at: "2099-11-20T23:00:00Z", ends_at: null, status: "ativa", archived_at: null, capacity: 80 },
          ],
        },
      ],
    };
    mocks.adminRpc.mockImplementation(async (fn: string, args: { p_session_id: string }) => {
      if (fn !== "session_availability") return { data: null, error: { message: "inesperado" } };
      const sold = args.p_session_id === SESSION_A ? 20 : 18;
      return { data: { capacity: 50, sold, held: 0, categories: {}, types: [] }, error: null };
    });
  }

  it("lista só os próprios eventos não excluídos, com capa, datas, selo e vendidos", async () => {
    events();
    const html = render(await MyEventsPage());
    const page = text(html);

    const query = mocks.queries.find((q) => q.table === "events");
    expect(query?.calls).toContainEqual(["eq", ["organizer_id", USER_ID]]);
    expect(query?.calls).toContainEqual(["is", ["deleted_at", null]]);

    expect(page).toContain("Meus eventos");
    expect(page).toContain("Peça Y");
    expect(html).toContain('src="https://exemplo.com/capa.jpg"');
    expect(page).toContain("12 e 13 de dezembro · 2 sessões");
    expect(page).toContain("À venda");
    expect(page).toContain("38 de 100 vendidos");
    expect(html).toContain('href="/organizador/eventos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');

    expect(page).toContain("Show Z");
    expect(page).toContain("Recusado");
    expect(page).toContain("Falta a descrição do show.");
    expect(page).toContain("80 lugares");

    expect(page).toContain("+ Criar evento");
    expect(html).toContain('href="/organizador/eventos/novo"');
    expect(page).toContain("Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp.");

    const sessionsAsked = mocks.adminRpc.mock.calls.map(([, args]) => (args as { p_session_id: string }).p_session_id);
    expect(sessionsAsked.sort()).toEqual([SESSION_A, SESSION_B].sort());
  });

  it("sem eventos: convida a criar o primeiro", async () => {
    mocks.tables.events = { data: [], error: null };
    const page = text(render(await MyEventsPage()));
    expect(page).toContain("+ Criar evento");
    expect(page).toContain("Você ainda não tem eventos.");
  });

  it("falha ao contar vendidos mostra só a lotação", async () => {
    events();
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const page = text(render(await MyEventsPage()));
    expect(page).not.toContain("vendidos");
    expect(page).toContain("100 lugares");
  });

  it("quem não é organizador verificado não vê dados", async () => {
    mocks.getActor.mockResolvedValue(null);
    events();
    const page = text(render(await MyEventsPage()));
    expect(page).toContain("Sua conta não tem acesso à área do organizador agora.");
    expect(page).not.toContain("Peça Y");
    expect(mocks.queries).toHaveLength(0);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("conta da equipe também não", async () => {
    mocks.getActor.mockResolvedValue({ kind: "equipe", userId: USER_ID, isAdmin: true, isDeveloper: false });
    const page = text(render(await MyEventsPage()));
    expect(page).toContain("Sua conta não tem acesso à área do organizador agora.");
    expect(mocks.queries).toHaveLength(0);
  });

  it("área desligada: avisa que ainda não está disponível", async () => {
    mocks.getActor.mockResolvedValue(null);
    mocks.areaEnabled.mockResolvedValue(false);
    const page = text(render(await MyEventsPage()));
    expect(page).toContain("A área do organizador ainda não está disponível.");
  });
});

describe("Minha conta", () => {
  const DEVICE_TOKEN = "a".repeat(43);

  function profile(overrides: Record<string, unknown> = {}) {
    mocks.tables.organizer_profiles = {
      error: null,
      data: {
        full_name: "Fulana de Tal",
        public_name: "Coletivo Exemplo",
        phone: "71999998888",
        pix_key_type: "cpf",
        pix_key: "52998224725",
        pix_holder_name: "Fulana de Tal",
        pix_holder_document: "52998224725",
        terms_version: "2026-10-14",
        terms_accepted_at: "2026-10-14T15:00:00Z",
        ...overrides,
      },
    };
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "list_my_devices"
        ? {
            data: [
              {
                id: "3f6c2a4e-8b1d-4c7e-9a2f-5d6e7f8a9b0c",
                label: "Chrome no Android",
                created_at: "2026-10-01T15:00:00Z",
                last_used_at: "2026-10-14T15:00:00Z",
                expires_at: "2026-11-13T15:00:00Z",
                is_current: true,
              },
            ],
            error: null,
          }
        : { data: null, error: { message: "inesperado" } },
    );
  }

  it("mostra os dados com chave PIX, CPF/CNPJ e e-mail mascarados no servidor", async () => {
    profile();
    mocks.cookies = { byla_org_aparelho: DEVICE_TOKEN };
    const html = render(await AccountPage());
    const page = text(html);

    const query = mocks.queries.find((q) => q.table === "organizer_profiles");
    expect(query?.calls).toContainEqual(["eq", ["user_id", USER_ID]]);

    expect(page).toContain("Minha conta");
    expect(page).toContain("Fulana de Tal");
    expect(page).toContain("Coletivo Exemplo");
    expect(page).toContain("(71) 99999-8888");
    expect(page).toContain("fu***@ex***.com");
    expect(html).not.toContain("fulana@exemplo.com");

    expect(page).toContain("•••.982.247-••");
    expect(html).not.toContain("52998224725");
    expect(html).not.toContain("529.982.247-25");

    expect(page).toContain("Para trocar a chave PIX, fale com o Espaço Byla");
    expect(page).not.toMatch(/Trocar chave PIX/);

    expect(page).toContain("Versão 2026-10-14");
    expect(page).toContain("14/10/2026");

    expect(page).toContain("Meus aparelhos");
    expect(page).toContain("Chrome no Android");
    expect(page).toContain("Esquecer");
    expect(mocks.rpc).toHaveBeenCalledWith("list_my_devices", { p_current_token: DEVICE_TOKEN });
  });

  it("chave PIX de e-mail também mascarada", async () => {
    profile({ pix_key_type: "email", pix_key: "pix.fulana@exemplo.com", pix_holder_document: "11222333000181" });
    const html = render(await AccountPage());
    expect(html).not.toContain("pix.fulana");
    expect(html).not.toContain("11222333000181");
    expect(text(html)).toContain("•••@•••.com");
    expect(text(html)).toContain("••.•••.333/0001-••");
    expect(mocks.rpc).toHaveBeenCalledWith("list_my_devices", { p_current_token: null });
  });

  it("quem não é organizador verificado não vê dados", async () => {
    mocks.getActor.mockResolvedValue(null);
    profile();
    const html = render(await AccountPage());
    expect(text(html)).toContain("Sua conta não tem acesso à área do organizador agora.");
    expect(html).not.toContain("Fulana");
    expect(mocks.queries).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("perfil não encontrado → aviso genérico", async () => {
    mocks.tables.organizer_profiles = { data: null, error: null };
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const page = text(render(await AccountPage()));
    expect(page).toContain("Não foi possível carregar seus dados.");
  });
});

describe("maskPixKey", () => {
  it.each([
    ["cpf", "52998224725", "•••.982.247-••"],
    ["cnpj", "11222333000181", "••.•••.333/0001-••"],
    ["email", "pix.fulana@exemplo.com.br", "•••@•••.br"],
    ["telefone", "+5571999998888", "(••) •••••-8888"],
    ["aleatoria", "123e4567-e89b-12d3-a456-426614174000", "••••••••-••••-••••-••••-••••••••4000"],
    ["outro", "qualquer", "•••"],
    ["email", "sem-arroba", "•••"],
  ])("%s", (type, key, masked) => {
    expect(maskPixKey(type, key)).toBe(masked);
  });
});
