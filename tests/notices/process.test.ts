import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SendSessionNoticeInput } from "@/lib/email/send-session-notice";
import { runSessionNotices } from "@/lib/notices/process";
import { NOTICE_DAILY_SOFT_CAP, NOTICE_SEND_INTERVAL_MS } from "@/lib/notices/rules";

const config = {
  apiKey: "chave-teste",
  from: "Espaço Byla <teste@exemplo.test>",
  appUrl: "https://eventos.exemplo",
  replyTo: "contato@exemplo.test",
};
const NOW = Date.parse("2026-10-04T15:00:00.000Z");

function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    delivery_id: `00000000-0000-4000-8000-00000000000${n}`,
    notice_id: "00000000-0000-4000-8000-0000000000aa",
    kind: "alteracao_horario",
    order_id: `00000000-0000-4000-8000-0000000001${n}0`,
    public_token: `token-${n}`,
    buyer_name: "Comprador Teste",
    buyer_email: `comprador${n}@example.com`,
    total_cents: 5000,
    event_name: "Show Teste",
    event_venue: "Local Teste",
    session_name: null,
    session_starts_at: "2026-12-01T23:00:00.000Z",
    session_ends_at: null,
    previous_starts_at: "2026-12-01T22:00:00.000Z",
    previous_ends_at: null,
    reason: null,
    refund_amount_cents: null,
    tickets: null,
    ...overrides,
  };
}

function adminMock(claim: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_session_notice_deliveries") return claim;
    return { data: true, error: null };
  });
  return { rpc, admin: { rpc } as never };
}

const sent = (quotaUsed: number | null = 10) => ({ status: "sent" as const, quotaUsed });

describe("runSessionNotices", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sem e-mail configurado, não reivindica nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc, admin } = adminMock({ data: [row(1)], error: null });
    await expect(runSessionNotices(admin, { limit: 10 }, { config: null })).resolves.toEqual({
      status: "not_configured",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reivindica pelo comunicado e pedido pedidos", async () => {
    const { rpc, admin } = adminMock({ data: [], error: null });
    await runSessionNotices(admin, { limit: 3, noticeId: "n", orderId: "o" }, { config, send: vi.fn() });
    expect(rpc).toHaveBeenCalledWith("claim_session_notice_deliveries", { p_limit: 3, p_notice_id: "n", p_order_id: "o" });
  });

  it("envia o aviso de horário com chave por entrega e marca o enviado", async () => {
    const { rpc, admin } = adminMock({ data: [row(1)], error: null });
    const send = vi.fn(async (input: SendSessionNoticeInput) => {
      void input;
      return sent();
    });

    const result = await runSessionNotices(admin, { limit: 10 }, { config, send, pause: vi.fn(), now: () => NOW });

    expect(result).toEqual({ status: "ok", claimed: 1, sent: 1, failed: 0, pausedUntil: null });
    const input = send.mock.calls[0][0];
    expect(input.to).toBe("comprador1@example.com");
    expect(input.idempotencyKey).toBe(`aviso-sessao/${row(1).delivery_id}`);
    expect(input.content.subject).toBe("Mudança de horário — Show Teste");
    expect(input.content.text).toContain("Ver meus ingressos: https://eventos.exemplo/pedidos/token-1");
    expect(input.content.text).toContain("responda este e-mail");
    expect(rpc).toHaveBeenCalledWith("mark_session_notice_sent", { p_delivery_id: row(1).delivery_id });
  });

  it("monta cancelamento (cortesia sem devolução) e 'valor devolvido'", async () => {
    const { admin } = adminMock({
      data: [
        row(1, { kind: "cancelamento", reason: "Chuva", total_cents: 0 }),
        row(2, {
          kind: "estorno_cancelamento",
          refund_amount_cents: 5000,
          tickets: [{ holder_name: "Titular", kind: "meia", item_name: "Meia-entrada" }, { bad: true }],
        }),
      ],
      error: null,
    });
    const send = vi.fn(async (input: SendSessionNoticeInput) => {
      void input;
      return sent();
    });

    await runSessionNotices(admin, { limit: 10 }, { config, send, pause: vi.fn(), now: () => NOW });

    const cancel = send.mock.calls[0][0].content;
    expect(cancel.subject).toBe("Sessão cancelada — Show Teste");
    expect(cancel.text).toContain("Motivo: Chuva");
    expect(cancel.text).not.toContain("devolvido");
    const refund = send.mock.calls[1][0].content;
    expect(refund.subject).toBe("Sessão cancelada — valor devolvido — Show Teste");
    expect(refund.text).toContain("Titular (Meia-entrada)");
  });

  it("ao chegar no teto do dia, pausa até a renovação e devolve o resto sem gastar tentativa", async () => {
    const { rpc, admin } = adminMock({ data: [row(1), row(2), row(3)], error: null });
    const send = vi.fn().mockResolvedValueOnce(sent(NOTICE_DAILY_SOFT_CAP));

    const result = await runSessionNotices(admin, { limit: 10 }, { config, send, pause: vi.fn(), now: () => NOW });

    expect(result).toEqual({ status: "ok", claimed: 3, sent: 1, failed: 0, pausedUntil: "2026-10-05T00:00:00.000Z" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("pause_session_notice_emails", { p_until: "2026-10-05T00:00:00.000Z" });
    for (const n of [2, 3]) {
      expect(rpc).toHaveBeenCalledWith("release_session_notice_delivery", {
        p_delivery_id: row(n).delivery_id,
        p_error_code: "cota",
        p_quota: true,
      });
    }
  });

  it("limite estourado: devolve a entrega atual e o resto, e pausa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc, admin } = adminMock({ data: [row(1), row(2)], error: null });
    const send = vi.fn().mockResolvedValueOnce({ status: "quota" });

    const result = await runSessionNotices(admin, { limit: 10 }, { config, send, pause: vi.fn(), now: () => NOW });

    expect(result).toMatchObject({ sent: 0, failed: 0, pausedUntil: "2026-10-05T00:00:00.000Z" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("release_session_notice_delivery", {
      p_delivery_id: row(1).delivery_id,
      p_error_code: "cota",
      p_quota: true,
    });
    expect(rpc).toHaveBeenCalledWith("release_session_notice_delivery", {
      p_delivery_id: row(2).delivery_id,
      p_error_code: "cota",
      p_quota: true,
    });
  });

  it("falha comum volta para a fila contando tentativa; segue para o próximo", async () => {
    const { rpc, admin } = adminMock({ data: [row(1), row(2)], error: null });
    const send = vi.fn().mockResolvedValueOnce({ status: "failed" }).mockResolvedValueOnce(sent());
    const pause = vi.fn(async () => {});

    const result = await runSessionNotices(admin, { limit: 10 }, { config, send, pause, now: () => NOW });

    expect(result).toMatchObject({ sent: 1, failed: 1, pausedUntil: null });
    expect(rpc).toHaveBeenCalledWith("release_session_notice_delivery", {
      p_delivery_id: row(1).delivery_id,
      p_error_code: "envio_falhou",
      p_quota: false,
    });
    expect(pause).toHaveBeenCalledWith(NOTICE_SEND_INTERVAL_MS);
  });

  it("dados incompletos não envia e devolve para a fila", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = adminMock({ data: [row(1, { previous_starts_at: null })], error: null });
    const send = vi.fn();

    const result = await runSessionNotices(admin, { limit: 10 }, { config, send, pause: vi.fn(), now: () => NOW });

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("@example.com");
  });

  it("falha do banco ao reivindicar não envia nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = adminMock({ data: null, error: { message: "falhou" } });
    const send = vi.fn();
    await expect(runSessionNotices(admin, { limit: 10 }, { config, send })).resolves.toEqual({ status: "error" });
    expect(send).not.toHaveBeenCalled();
  });
});
