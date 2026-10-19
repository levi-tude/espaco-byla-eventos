import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tryConsumeRateLimit: vi.fn(),
  releaseRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
  getUserById: vi.fn(),
  staffLookup: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  tryConsumeRateLimit: mocks.tryConsumeRateLimit,
  releaseRateLimit: mocks.releaseRateLimit,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { sendOrganizerNotice } from "@/lib/email/send-organizer-notice";
import { buildOrganizerNotice } from "@/lib/email/organizer-notice-template";
import {
  notifyOrganizer,
  notifyTeam,
  notifyTeamEventSubmitted,
  notifyTeamSignupRequest,
  organizerNoticeLink,
} from "@/lib/organizer/notify";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

const TEAM_EMAIL = "equipe@exemplo.com";
const ORGANIZER_EMAIL = "fulana@exemplo.com";
const ORGANIZER_ID = "00000000-0000-4000-8000-0000000000a1";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000b2";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";

const admin = {
  auth: { admin: { getUserById: mocks.getUserById } },
  from: (table: string) => {
    expect(table).toBe("staff_profiles");
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: mocks.staffLookup,
    };
    return chain;
  },
  rpc: mocks.rpc,
};

const fetchMock = vi.fn();
let logged: string[] = [];

function captureLogs() {
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(
        args
          .map((arg) => (arg instanceof Error ? `${arg.name} ${arg.message}` : JSON.stringify(arg) ?? String(arg)))
          .join(" "),
      );
    });
  }
}

function sentBody(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ALERT_EMAIL", TEAM_EMAIL);
  vi.stubEnv("RESEND_API_KEY", "chave-de-teste");
  vi.stubEnv("RESEND_FROM_EMAIL", "ACDH Eventos <ingressos@exemplo.com>");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://site.example/");
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.tryConsumeRateLimit.mockResolvedValue("allowed");
  mocks.releaseRateLimit.mockResolvedValue(true);
  mocks.getUserById.mockResolvedValue({ data: { user: { id: ORGANIZER_ID, email: ORGANIZER_EMAIL } }, error: null });
  mocks.staffLookup.mockResolvedValue({ data: { user_id: ADMIN_ID }, error: null });
  mocks.rpc.mockResolvedValue({
    data: [{ approvals: 0, changes: 0, deletions: 0, refunds: 0, signup_requests: 4 }],
    error: null,
  });
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  captureLogs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function expectNoAddressInLogs() {
  for (const line of logged) {
    expect(line).not.toContain(ORGANIZER_EMAIL);
    expect(line).not.toContain(TEAM_EMAIL);
  }
}

describe("teto de avisos", () => {
  it("10 por dia, chave do site inteiro", () => {
    expect(RATE_LIMITS.organizerNoticeEmailPerDay).toEqual({
      bucket: "email-org:day",
      limit: 10,
      windowSeconds: 86_400,
    });
    expect(RATE_LIMITS.organizerSignupNotice).toEqual({
      bucket: "org-notice:signup",
      limit: 1,
      windowSeconds: 21_600,
    });
  });
});

describe("sendOrganizerNotice", () => {
  const content = buildOrganizerNotice("org_evento_aprovado", {
    eventName: "Festa",
    link: "https://site.example/organizador/eventos/x",
  });

  it("consome o teto diário e envia pelo remetente do site", async () => {
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("sent");
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      admin,
      RATE_LIMITS.organizerNoticeEmailPerDay,
      "site",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = sentBody();
    expect(body.from).toBe("ACDH Eventos <ingressos@exemplo.com>");
    expect(body.to).toEqual([ORGANIZER_EMAIL]);
    expect(body.subject).toBe("Seu evento foi aprovado");
    expect(body.html).toBe(content.html);
    expect(body.text).toBe(content.text);
  });

  it("com o teto estourado devolve capped sem enviar", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("limited");
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("capped");
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoAddressInLogs();
  });

  it("se o banco falha no teto, não envia (protege a cota dos ingressos)", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("error");
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["RESEND_API_KEY", "RESEND_FROM_EMAIL"])("sem %s devolve skipped sem consumir o teto", async (name) => {
    vi.stubEnv(name, "");
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.tryConsumeRateLimit).not.toHaveBeenCalled();
  });

  it("destinatário inválido devolve skipped", async () => {
    await expect(sendOrganizerNotice("sem-arroba", content)).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro HTTP devolve failed e o log não leva o endereço", async () => {
    fetchMock.mockResolvedValue(new Response("erro", { status: 500 }));
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("failed");
    expect(logged.length).toBeGreaterThan(0);
    expectNoAddressInLogs();
  });

  it("limite diário do serviço de e-mail devolve failed", async () => {
    fetchMock.mockResolvedValue(new Response('{"name":"daily_quota_exceeded"}', { status: 429 }));
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("failed");
    expectNoAddressInLogs();
  });

  it("queda de rede devolve failed e o log não leva o endereço", async () => {
    fetchMock.mockRejectedValue(new Error(`falhou para ${ORGANIZER_EMAIL}`));
    await expect(sendOrganizerNotice(ORGANIZER_EMAIL, content)).resolves.toBe("failed");
    expect(logged.length).toBeGreaterThan(0);
    expectNoAddressInLogs();
  });
});

describe("organizerNoticeLink", () => {
  it("monta o endereço com o site configurado", () => {
    expect(organizerNoticeLink("/equipe/aprovacoes")).toBe("https://site.example/equipe/aprovacoes");
  });
});

describe("notifyTeam", () => {
  it("envia para ALERT_EMAIL", async () => {
    await expect(
      notifyTeam("equipe_evento_enviado", {
        eventName: "Festa",
        link: organizerNoticeLink("/equipe/aprovacoes"),
      }),
    ).resolves.toBe("sent");
    const body = sentBody();
    expect(body.to).toEqual([TEAM_EMAIL]);
    expect(body.subject).toBe("Evento para aprovar: Festa");
    expect(body.text).toContain("https://site.example/equipe/aprovacoes");
  });

  it("sem ALERT_EMAIL não envia", async () => {
    vi.stubEnv("ALERT_EMAIL", "");
    await expect(notifyTeam("equipe_evento_enviado", { eventName: "Festa", link: "https://site.example" })).resolves.toBe(
      "skipped",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nunca lança, mesmo sem acesso ao banco", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("sem chave");
    });
    await expect(
      notifyTeam("equipe_pedido_organizador", {
        eventName: "Festa",
        requestKind: "estorno",
        link: "https://site.example",
      }),
    ).resolves.toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoAddressInLogs();
  });
});

describe("notifyOrganizer", () => {
  const data = {
    eventName: "Festa",
    link: organizerNoticeLink(`/organizador/eventos/${EVENT_ID}`),
  };

  it("lê o e-mail da conta e envia para ele", async () => {
    await expect(notifyOrganizer(ORGANIZER_ID, "org_evento_aprovado", data)).resolves.toBe("sent");
    expect(mocks.getUserById).toHaveBeenCalledWith(ORGANIZER_ID);
    expect(sentBody().to).toEqual([ORGANIZER_EMAIL]);
    expectNoAddressInLogs();
  });

  it("id inválido não consulta nem envia", async () => {
    await expect(notifyOrganizer("nao-e-uuid", "org_evento_aprovado", data)).resolves.toBe("skipped");
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conta sem e-mail não envia", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { message: "not found" } });
    await expect(notifyOrganizer(ORGANIZER_ID, "org_conta_suspensa", data)).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nunca lança e não loga o endereço", async () => {
    mocks.getUserById.mockRejectedValue(new Error("rede caiu"));
    await expect(notifyOrganizer(ORGANIZER_ID, "org_evento_recusado", { ...data, note: "Falta capa" })).resolves.toBe(
      "failed",
    );
    fetchMock.mockRejectedValue(new Error(`falhou ${ORGANIZER_EMAIL}`));
    mocks.getUserById.mockResolvedValue({ data: { user: { email: ORGANIZER_EMAIL } }, error: null });
    await expect(notifyOrganizer(ORGANIZER_ID, "org_evento_aprovado", data)).resolves.toBe("failed");
    expectNoAddressInLogs();
  });
});

describe("notifyTeamEventSubmitted", () => {
  it("regras: 10 envios por hora por conta e 1 aviso por evento a cada 6 h", () => {
    expect(RATE_LIMITS.organizerSubmitPerUser).toEqual({ bucket: "org-submit:user", limit: 10, windowSeconds: 3600 });
    expect(RATE_LIMITS.organizerSubmitNotice).toEqual({
      bucket: "org-notice:submit",
      limit: 1,
      windowSeconds: 21_600,
    });
  });

  it("avisa a equipe uma vez, com chave só do evento", async () => {
    await expect(notifyTeamEventSubmitted(admin as never, EVENT_ID, "Festa")).resolves.toBe("sent");
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      admin,
      RATE_LIMITS.organizerSubmitNotice,
      `evento:${EVENT_ID}`,
    );
    const body = sentBody();
    expect(body.to).toEqual([TEAM_EMAIL]);
    expect(body.subject).toBe("Evento para aprovar: Festa");
    expect(body.text).toContain("https://site.example/equipe/aprovacoes");
  });

  it("dentro das 6 h do mesmo evento não envia de novo", async () => {
    mocks.tryConsumeRateLimit.mockImplementation(async (_admin, rule) =>
      rule.bucket === "org-notice:submit" ? "limited" : "allowed",
    );
    await expect(notifyTeamEventSubmitted(admin as never, EVENT_ID, "Festa")).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("se o banco falha no limite de 6 h, não envia", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("error");
    await expect(notifyTeamEventSubmitted(admin as never, EVENT_ID, "Festa")).resolves.toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("se o envio falha, libera as 6 h do evento", async () => {
    fetchMock.mockResolvedValue(new Response("erro", { status: 500 }));
    await expect(notifyTeamEventSubmitted(admin as never, EVENT_ID, "Festa")).resolves.toBe("failed");
    expect(mocks.releaseRateLimit).toHaveBeenCalledWith(
      admin,
      RATE_LIMITS.organizerSubmitNotice,
      `evento:${EVENT_ID}`,
    );
  });

  it("sem ALERT_EMAIL ou com evento inválido, não consome as 6 h", async () => {
    vi.stubEnv("ALERT_EMAIL", "");
    await expect(notifyTeamEventSubmitted(admin as never, EVENT_ID, "Festa")).resolves.toBe("skipped");
    vi.stubEnv("ALERT_EMAIL", TEAM_EMAIL);
    await expect(notifyTeamEventSubmitted(admin as never, "nao-e-uuid", "Festa")).resolves.toBe("skipped");
    expect(mocks.tryConsumeRateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nunca lança", async () => {
    mocks.tryConsumeRateLimit.mockRejectedValue(new Error("boom"));
    await expect(notifyTeamEventSubmitted(admin as never, EVENT_ID, "Festa")).resolves.toBe("failed");
    expectNoAddressInLogs();
  });
});

describe("notifyTeamSignupRequest", () => {
  it("no máximo 1 a cada 6 h, com a contagem de pedidos novos", async () => {
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("sent");
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(admin, RATE_LIMITS.organizerSignupNotice, "site");
    expect(mocks.rpc).toHaveBeenCalledWith("team_pending_counts", { p_staff: ADMIN_ID });
    const body = sentBody();
    expect(body.to).toEqual([TEAM_EMAIL]);
    expect(body.subject).toBe("Novo pedido para fazer evento");
    expect(body.text).toContain("4 pedidos novos");
    expect(body.text).toContain("https://site.example/equipe/organizadores");
  });

  it("dentro das 6 h não envia", async () => {
    mocks.tryConsumeRateLimit.mockImplementation(async (_admin, rule) =>
      rule.bucket === "org-notice:signup" ? "limited" : "allowed",
    );
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("se o banco falha no limite de 6 h, não envia", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("error");
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem contagem, envia o aviso genérico", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "erro" } });
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("sent");
    expect(sentBody().text).toContain("pedido novo");
  });

  it("sem Admin cadastrado, envia o aviso genérico", async () => {
    mocks.staffLookup.mockResolvedValue({ data: null, error: null });
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("sent");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("se o envio falha, libera as 6 h para o próximo pedido tentar", async () => {
    fetchMock.mockResolvedValue(new Response("erro", { status: 500 }));
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("failed");
    expect(mocks.releaseRateLimit).toHaveBeenCalledWith(admin, RATE_LIMITS.organizerSignupNotice, "site");
  });

  it("sem ALERT_EMAIL não consome as 6 h", async () => {
    vi.stubEnv("ALERT_EMAIL", "");
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("skipped");
    expect(mocks.tryConsumeRateLimit).not.toHaveBeenCalled();
  });

  it("nunca lança", async () => {
    mocks.tryConsumeRateLimit.mockRejectedValue(new Error("boom"));
    await expect(notifyTeamSignupRequest(admin as never)).resolves.toBe("failed");
    expectNoAddressInLogs();
  });
});
