import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  areaEnabled: vi.fn(),
  notifyTeamSignupRequest: vi.fn(),
  notifyTeam: vi.fn(),
  notifyOrganizer: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeamSetup: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/organizer/settings", () => ({
  ORGANIZER_AREA_UNAVAILABLE_MESSAGE: "Esta área está indisponível no momento.",
  organizerAreaEnabled: mocks.areaEnabled,
}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyTeamSignupRequest: mocks.notifyTeamSignupRequest,
  notifyTeam: mocks.notifyTeam,
  notifyOrganizer: mocks.notifyOrganizer,
}));

import { submitOrganizerRequest } from "@/app/quero-fazer-meu-evento/actions";
import OrganizerRequestPage from "@/app/quero-fazer-meu-evento/page";
import { OrganizerRequestSent } from "@/components/public/OrganizerRequestForm";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/privacy";
import { BOT_BLOCKED_MESSAGE } from "@/lib/security/bot";
import { hashRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const validInput = {
  name: "  Fulana de Tal  ",
  contact: " fulana@exemplo.com ",
  idea: "Um show de forró com banda local",
  approxDate: "",
  privacyAccepted: true,
  humanToken: "token-humano",
};

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
}

/** Anti-robô configurado; o serviço responde com `body`. */
function humanCheckReplies(body: Record<string, unknown>) {
  vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo-de-teste");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "chave-publica");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Banco respondendo: limite liberado e pedido gravado (ou o erro indicado). */
function database({ limit = true, submitError }: { limit?: boolean; submitError?: string } = {}) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "consume_rate_limit") return { data: limit, error: null };
    if (fn === "submit_signup_request") {
      return submitError
        ? { data: null, error: { message: submitError, code: "P0001" } }
        : { data: "00000000-0000-4000-8000-000000000001", error: null };
    }
    return { data: null, error: { message: "inesperado" } };
  });
}

function submitCalls() {
  return mocks.rpc.mock.calls.filter(([fn]) => fn === "submit_signup_request");
}

describe("submitOrganizerRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.areaEnabled.mockResolvedValue(true);
    mocks.notifyTeamSignupRequest.mockResolvedValue("sent");
    database();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("com a área desligada recusa sem chamar o anti-robô nem o banco", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    const fetchMock = humanCheckReplies({ success: true, action: "org_request" });

    expect(await submitOrganizerRequest(validInput)).toEqual({
      ok: false,
      error: "Esta área está indisponível no momento.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.notifyTeamSignupRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["nome curto", { name: "F" }, "Informe seu nome (de 2 a 120 caracteres)."],
    ["contato vazio", { contact: "  " }, "Informe um WhatsApp ou e-mail para contato."],
    ["ideia curta", { idea: "show" }, "Conte a ideia do evento (de 10 a 1000 caracteres)."],
    ["data longa", { approxDate: "x".repeat(61) }, "A data aproximada pode ter no máximo 60 caracteres."],
    ["privacidade sem marcar", { privacyAccepted: false }, "Marque que leu a Política de Privacidade."],
    ["privacidade como texto", { privacyAccepted: "on" }, "Marque que leu a Política de Privacidade."],
  ])("dados inválidos (%s) voltam com a mensagem do campo, antes do anti-robô", async (_caso, override, message) => {
    const fetchMock = humanCheckReplies({ success: true, action: "org_request" });

    expect(await submitOrganizerRequest({ ...validInput, ...(override as object) } as typeof validInput)).toEqual({
      ok: false,
      error: message,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("chamada direta com corpo absurdo não chega ao banco", async () => {
    const result = await submitOrganizerRequest("lixo" as unknown as typeof validInput);
    expect(result).toEqual({ ok: false, error: "Confira os dados e tente de novo." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("anti-robô recusando não chega ao limite nem ao banco", async () => {
    humanCheckReplies({ success: false });

    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: false, error: BOT_BLOCKED_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("token de outra ação (ex.: checkout) é recusado", async () => {
    humanCheckReplies({ success: true, action: "checkout" });

    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: false, error: BOT_BLOCKED_MESSAGE });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("acima do limite por IP não grava; a chave do limite é só o hash do IP", async () => {
    database({ limit: false });

    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(submitCalls()).toHaveLength(0);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "org-request:ip",
      p_key_hash: hashRateLimitKey("203.0.113.7"),
      p_limit: 3,
      p_window_seconds: 3600,
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("203.0.113.7");
    expect(mocks.notifyTeamSignupRequest).not.toHaveBeenCalled();
  });

  it("falha ao consultar o limite bloqueia (falha fechada)", async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "consume_rate_limit" ? { data: null, error: { message: "fora do ar" } } : { data: "id", error: null },
    );

    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(submitCalls()).toHaveLength(0);
  });

  it("limite do dia no banco (ORG_LIMITE) mostra a mensagem de muitas tentativas", async () => {
    database({ submitError: "ORG_LIMITE: Limite de pedidos do dia atingido." });

    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(mocks.notifyTeamSignupRequest).not.toHaveBeenCalled();
  });

  it("área desligada no banco no meio do caminho (ORG_DESLIGADO) dá o mesmo aviso", async () => {
    database({ submitError: "ORG_DESLIGADO: Área de organizadores desligada." });

    expect(await submitOrganizerRequest(validInput)).toEqual({
      ok: false,
      error: "Esta área está indisponível no momento.",
    });
  });

  it("erro inesperado do banco vira mensagem genérica, sem o texto cru", async () => {
    database({ submitError: "relation organizer_signup_requests does not exist" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitOrganizerRequest(validInput);
    expect(result).toEqual({ ok: false, error: "Não foi possível enviar seu pedido agora. Tente de novo em alguns minutos." });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("fulana@exemplo.com");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("Fulana");
    errorLog.mockRestore();
  });

  it("sucesso grava os dados limpos com a versão da Política e avisa só a equipe", async () => {
    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: true, data: undefined });

    expect(mocks.rpc).toHaveBeenCalledWith("submit_signup_request", {
      p_name: "Fulana de Tal",
      p_contact: "fulana@exemplo.com",
      p_idea: "Um show de forró com banda local",
      p_approx_date: null,
      p_privacy_version: PRIVACY_POLICY_VERSION,
    });
    expect(mocks.notifyTeamSignupRequest).toHaveBeenCalledTimes(1);
    expect(mocks.notifyTeamSignupRequest).toHaveBeenCalledWith(expect.objectContaining({ rpc: mocks.rpc }));
    // Nenhum e-mail para quem pediu.
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(mocks.notifyTeam).not.toHaveBeenCalled();
  });

  it("segue a ordem: área → validação → anti-robô → limite → banco", async () => {
    const order: string[] = [];
    mocks.areaEnabled.mockImplementation(async () => {
      order.push("area");
      return true;
    });
    vi.stubEnv("TURNSTILE_SECRET_KEY", "segredo-de-teste");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "chave-publica");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        order.push("anti-robo");
        expect(String(init.body)).toContain("response=token-humano");
        return new Response(JSON.stringify({ success: true, action: "org_request" }), { status: 200 });
      }),
    );
    mocks.rpc.mockImplementation(async (fn: string) => {
      order.push(fn);
      return fn === "consume_rate_limit" ? { data: true, error: null } : { data: "id", error: null };
    });
    mocks.notifyTeamSignupRequest.mockImplementation(async () => {
      order.push("aviso");
      return "sent";
    });

    expect(await submitOrganizerRequest({ ...validInput, approxDate: " dezembro " })).toEqual({ ok: true, data: undefined });
    expect(order).toEqual(["area", "anti-robo", "consume_rate_limit", "submit_signup_request", "aviso"]);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_signup_request", expect.objectContaining({ p_approx_date: "dezembro" }));
  });

  it("aviso à equipe que falha não estraga o pedido", async () => {
    mocks.notifyTeamSignupRequest.mockResolvedValue("failed");
    expect(await submitOrganizerRequest(validInput)).toEqual({ ok: true, data: undefined });
  });
});

describe("página Quero fazer meu evento", () => {
  beforeEach(() => vi.clearAllMocks());

  it("com a área desligada responde 404", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    await expect(OrganizerRequestPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("com a área ligada mostra o texto, os campos com limite e os links", async () => {
    mocks.areaEnabled.mockResolvedValue(true);
    const html = renderToStaticMarkup(await OrganizerRequestPage());
    const page = text(html);

    expect(page).toContain(
      "Você produz eventos e quer vender ingressos pelo site do ACDH Eventos? Conte sua ideia que a gente responde pelo WhatsApp.",
    );
    for (const max of [120, 160, 1000, 60]) expect(html).toMatch(new RegExp(`maxlength="${max}"`, "i"));
    expect(page).toContain("Nome");
    expect(page).toContain("WhatsApp ou e-mail para contato");
    expect(page).toContain("Ideia do evento");
    expect(page).toContain("Data aproximada (opcional)");
    expect(html).toMatch(/type="checkbox"[^>]*required/);
    expect(page).toContain("Li a Política de Privacidade");
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain('href="/termos-organizador"');
    expect(page).toContain("Veja como funciona para organizadores");
    expect(html).toMatch(/autocomplete="name"/i);
  });

  it("não cita fornecedores", async () => {
    mocks.areaEnabled.mockResolvedValue(true);
    const html = renderToStaticMarkup(await OrganizerRequestPage()).toLowerCase();
    for (const word of ["mercado pago", "supabase", "vercel", "resend", "cloudflare", "turnstile", "google"]) {
      expect(html).not.toContain(word);
    }
  });

  it("tela de sucesso confirma o recebimento", () => {
    const page = text(renderToStaticMarkup(createElement(OrganizerRequestSent)));
    expect(page).toContain("Recebemos! A equipe do ACDH Eventos vai falar com você pelo contato informado.");
  });
});
