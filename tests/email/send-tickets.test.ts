import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tickets/qr", () => ({
  ticketQrPng: vi.fn(async () => Buffer.from("qr")),
}));

import { sendTicketsEmail } from "@/lib/email/send-tickets";

const input = {
  buyerEmail: "compradora@exemplo.com",
  buyerName: "Catharina",
  eventName: "Cápsulas do Tempo",
  sessionName: null,
  venue: "ACDH",
  startsAt: "2026-11-28T20:00:00.000Z",
  endsAt: null,
  orderNumber: "F1C09337",
  tickets: [{ code: "codigo-1", holderName: "Catharina", kind: "inteira" as const }],
  publicToken: "token-publico",
};

describe("sendTicketsEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "ingressos@exemplo.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://exemplo.test");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("envia assunto único e cabeçalho X-Entity-Ref-ID do pedido", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await sendTicketsEmail(input)).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.subject).toBe(
      "Seu ingresso INTEIRA — Cápsulas do Tempo · sáb 28/11 às 17h00 · Pedido F1C09337",
    );
    expect(body.headers["X-Entity-Ref-ID"]).toBe("F1C09337");
    expect(body.to).toEqual(["compradora@exemplo.com"]);
  });

  it("recusa do serviço não inclui e-mail do comprador no log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await sendTicketsEmail(input)).toBe("failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain("compradora@exemplo.com");
  });
});
