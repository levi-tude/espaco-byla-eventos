import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  refundPaidOrder: vi.fn(),
  runSessionNotices: vi.fn(),
  consumeRateLimit: vi.fn(),
  cancelPendingCharges: vi.fn(),
  confirmOrderPaid: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.serverRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/payments/confirm-order", () => ({ confirmOrderPaid: mocks.confirmOrderPaid }));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago", cancelPendingCharges: mocks.cancelPendingCharges }),
}));
vi.mock("@/lib/notices/process", () => ({ runSessionNotices: mocks.runSessionNotices }));
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/payments/refund", async () => {
  const { ActionError } = await import("@/lib/action-result");
  class RefundActionError extends ActionError {
    constructor(
      message: string,
      readonly kind: "blocked" | "rejected",
      readonly code: string,
    ) {
      super(message);
    }
  }
  return { RefundActionError, refundPaidOrder: mocks.refundPaidOrder };
});

import {
  cancelSession,
  continueSessionNotices,
  notifyScheduleChange,
  refundNextInBatch,
  retryRefundBatchFailures,
  retrySessionNotices,
  startRefundBatch,
} from "@/app/equipe/eventos/session-actions";
import { RefundActionError } from "@/lib/payments/refund";

const sessionId = "00000000-0000-4000-8000-000000000020";
const noticeId = "00000000-0000-4000-8000-000000000030";
const batchId = "00000000-0000-4000-8000-000000000040";
const itemId = "00000000-0000-4000-8000-000000000041";
const orderId = "00000000-0000-4000-8000-000000000010";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const progress = { notice_id: noticeId, total: 3, sent: 3, pending: 0, failed: 0, skipped: 0, paused_until: null };

function lookup(data: unknown) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data, error: null }) };
  return chain;
}

function rpcResults(results: Record<string, { data?: unknown; error?: { message: string } }>) {
  mocks.adminRpc.mockImplementation(async (name: string) => {
    const result = results[name];
    return { data: result?.data ?? null, error: result?.error ?? null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
  mocks.serverRpc.mockResolvedValue({ data: true, error: null });
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc, from: mocks.adminFrom });
  mocks.adminFrom.mockImplementation(() => lookup({ event_id: "evento-1", events: { slug: "show" } }));
  mocks.consumeRateLimit.mockResolvedValue(true);
  mocks.runSessionNotices.mockResolvedValue({ status: "ok", claimed: 3, sent: 3, failed: 0, pausedUntil: null });
  mocks.cancelPendingCharges.mockResolvedValue({ kind: "cleared" });
});

const allActions: Array<[string, () => Promise<unknown>]> = [
  ["notifyScheduleChange", () => notifyScheduleChange(sessionId)],
  ["continueSessionNotices", () => continueSessionNotices(noticeId)],
  ["retrySessionNotices", () => retrySessionNotices(noticeId)],
  ["cancelSession", () => cancelSession(sessionId, "Chuva forte", "CANCELAR", true)],
  ["startRefundBatch", () => startRefundBatch(sessionId, "Sessão cancelada", "150,00")],
  ["refundNextInBatch", () => refundNextInBatch(batchId)],
  ["retryRefundBatchFailures", () => retryRefundBatchFailures(batchId)],
];

describe("todas as ações de sessão", () => {
  it.each(allActions)("%s recusa quem não é da equipe antes de tocar no banco", async (_name, call) => {
    mocks.serverRpc.mockResolvedValue({ data: false, error: null });
    expect(await call()).toEqual({ ok: false, error: "Acesso restrito à equipe." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(allActions)("%s recusa quem não está logado", async (_name, call) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await call()).toEqual({ ok: false, error: "Acesso restrito à equipe." });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["notifyScheduleChange", () => notifyScheduleChange("abc")],
    ["continueSessionNotices", () => continueSessionNotices(`${noticeId}' or 1=1`)],
    ["retrySessionNotices", () => retrySessionNotices(123 as never)],
    ["cancelSession", () => cancelSession("", "Chuva forte", "CANCELAR", true)],
    ["startRefundBatch", () => startRefundBatch("x", "Sessão cancelada", "150,00")],
    ["refundNextInBatch", () => refundNextInBatch("x")],
    ["retryRefundBatchFailures", () => retryRefundBatchFailures(null as never)],
  ])("%s recusa identificador inválido", async (_name, call) => {
    const result = (await call()) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/inválid/);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("notifyScheduleChange", () => {
  it("cria o aviso com quem pediu, envia o primeiro lote e devolve o progresso", async () => {
    rpcResults({
      queue_schedule_change_notice: { data: { notice_id: noticeId, queued: 3, already: false } },
      session_notice_progress: { data: progress },
    });

    expect(await notifyScheduleChange(sessionId)).toEqual({
      ok: true,
      data: { noticeId, total: 3, sent: 3, pending: 0, failed: 0, skipped: 0, pausedUntil: null },
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("queue_schedule_change_notice", {
      p_session_id: sessionId,
      p_staff_user_id: staffUserId,
    });
    expect(mocks.runSessionNotices).toHaveBeenCalledWith(expect.anything(), { limit: 10, noticeId });
  });

  it("erro conhecido do banco vira mensagem; desconhecido fica genérico", async () => {
    rpcResults({ queue_schedule_change_notice: { error: { message: "AVISO_SEM_DESTINATARIOS: x" } } });
    expect(await notifyScheduleChange(sessionId)).toEqual({
      ok: false,
      error: expect.stringContaining("Nenhum comprador precisa ser avisado"),
    });

    rpcResults({ queue_schedule_change_notice: { error: { message: "connection refused" } } });
    expect(await notifyScheduleChange(sessionId)).toEqual({
      ok: false,
      error: "Não foi possível avisar os compradores.",
    });
  });

  it("muitos cliques seguidos são barrados", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);
    const result = await notifyScheduleChange(sessionId);
    expect(result.ok).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("sem e-mail configurado, avisa a equipe", async () => {
    rpcResults({ queue_schedule_change_notice: { data: { notice_id: noticeId } } });
    mocks.runSessionNotices.mockResolvedValue({ status: "not_configured" });
    expect(await notifyScheduleChange(sessionId)).toEqual({
      ok: false,
      error: expect.stringContaining("não configurado"),
    });
  });
});

describe("continueSessionNotices", () => {
  it("nada pendente: não envia", async () => {
    rpcResults({ session_notice_progress: { data: progress } });
    expect((await continueSessionNotices(noticeId)).ok).toBe(true);
    expect(mocks.runSessionNotices).not.toHaveBeenCalled();
  });

  it("aviso inexistente é recusado", async () => {
    rpcResults({ session_notice_progress: { data: { ...progress, total: 0 } } });
    expect(await continueSessionNotices(noticeId)).toEqual({ ok: false, error: expect.stringContaining("não encontrado") });
  });
});

describe("cancelSession", () => {
  it("confere motivo, confirmação e escolha do aviso no servidor", async () => {
    expect((await cancelSession(sessionId, "abc", "CANCELAR", true)).ok).toBe(false);
    expect(await cancelSession(sessionId, "Chuva forte", "cancela", true)).toEqual({
      ok: false,
      error: "Digite CANCELAR para confirmar.",
    });
    expect((await cancelSession(sessionId, "Chuva forte", "CANCELAR", "sim" as never)).ok).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("cancela, encerra as cobranças dos pendentes e envia o primeiro lote do aviso", async () => {
    rpcResults({
      cancel_event_session: {
        data: {
          already: false,
          notice_id: noticeId,
          queued: 3,
          pending_orders: [
            { id: orderId, created_at: "2026-10-04T12:00:00Z" },
            { id: "00000000-0000-4000-8000-000000000011", created_at: "2026-10-04T12:01:00Z" },
          ],
        },
      },
      session_notice_progress: { data: progress },
    });
    mocks.cancelPendingCharges
      .mockResolvedValueOnce({ kind: "paid", amountCents: 5000 })
      .mockResolvedValueOnce({ kind: "unavailable" });

    const result = await cancelSession(sessionId, "  Chuva forte  ", "cancelar", true);

    expect(result).toEqual({
      ok: true,
      data: {
        already: false,
        pendingCancelled: 2,
        chargesUnresolved: 1,
        notice: expect.objectContaining({ noticeId, sent: 3 }),
      },
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("cancel_event_session", {
      p_session_id: sessionId,
      p_staff_user_id: staffUserId,
      p_reason: "Chuva forte",
      p_confirmation: "cancelar",
      p_notify: true,
    });
    expect(mocks.confirmOrderPaid).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
      5000,
      expect.objectContaining({ kind: "paid" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });

  it("sem aviso: não envia nada", async () => {
    rpcResults({ cancel_event_session: { data: { already: false, notice_id: null, queued: 0, pending_orders: [] } } });
    const result = await cancelSession(sessionId, "Chuva forte", "CANCELAR", false);
    expect(result).toEqual({ ok: true, data: { already: false, pendingCancelled: 0, chargesUnresolved: 0, notice: null } });
    expect(mocks.runSessionNotices).not.toHaveBeenCalled();
  });
});

describe("startRefundBatch", () => {
  it("manda o valor digitado em centavos para o banco conferir", async () => {
    rpcResults({
      start_session_refund_batch: {
        data: { batch_id: batchId, already: false, expected_count: 2, expected_total_cents: 15000 },
      },
    });
    expect(await startRefundBatch(sessionId, "Sessão cancelada: chuva", "R$ 150,00")).toEqual({
      ok: true,
      data: { batchId, already: false, expectedCount: 2, expectedTotalCents: 15000 },
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("start_session_refund_batch", {
      p_session_id: sessionId,
      p_staff_user_id: staffUserId,
      p_reason: "Sessão cancelada: chuva",
      p_confirm_total_cents: 15000,
    });
  });

  it("valor em formato inválido é recusado antes do banco", async () => {
    expect((await startRefundBatch(sessionId, "Sessão cancelada", "150.00")).ok).toBe(false);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("total que mudou no banco pede para conferir de novo", async () => {
    rpcResults({ start_session_refund_batch: { error: { message: "LOTE_TOTAL_MUDOU:14000" } } });
    expect(await startRefundBatch(sessionId, "Sessão cancelada", "150,00")).toEqual({
      ok: false,
      error: "Os números mudaram. Confira de novo antes de confirmar.",
    });
  });
});

describe("refundNextInBatch", () => {
  const claimItem = { data: { state: "item", item_id: itemId, order_id: orderId, reason: "Sessão cancelada: chuva" } };
  const finished = (status: string, consecutive = 0) => ({ data: { status, noop: false, consecutive_errors: consecutive } });

  it("estorna o pedido com o motivo do lote e registra 'estornado'", async () => {
    rpcResults({ claim_session_refund_item: claimItem, finish_session_refund_item: finished("estornado") });
    mocks.refundPaidOrder.mockResolvedValue({ status: "refunded", emailSent: true });

    expect(await refundNextInBatch(batchId)).toEqual({
      ok: true,
      data: { state: "item", orderId, status: "estornado", code: null, pause: false },
    });
    expect(mocks.refundPaidOrder).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      orderId,
      staffUserId,
      reason: "Sessão cancelada: chuva",
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("finish_session_refund_item", {
      p_item_id: itemId,
      p_status: "estornado",
      p_code: null,
    });
  });

  it.each([
    [new RefundActionError("entrou", "blocked", "ESTORNO_CHECK_IN"), "pulado", "com_entrada"],
    [new RefundActionError("já", "blocked", "ESTORNO_JA_FEITO"), "pulado", "ja_estornado"],
    [new RefundActionError("saldo", "rejected", "insufficient_money"), "falhou", "insufficient_money"],
    [new Error("timeout"), "pendente", "erro_temporario"],
  ])("classifica o resultado (%s)", async (error, status, code) => {
    rpcResults({ claim_session_refund_item: claimItem, finish_session_refund_item: finished(status) });
    mocks.refundPaidOrder.mockRejectedValue(error);

    const result = await refundNextInBatch(batchId);
    expect(result).toMatchObject({ ok: true, data: { state: "item", status, code } });
    expect(mocks.adminRpc).toHaveBeenCalledWith("finish_session_refund_item", {
      p_item_id: itemId,
      p_status: status,
      p_code: code,
    });
  });

  it("3 erros temporários seguidos pedem pausa", async () => {
    rpcResults({ claim_session_refund_item: claimItem, finish_session_refund_item: finished("pendente", 3) });
    mocks.refundPaidOrder.mockRejectedValue(new Error("fora do ar"));
    expect(await refundNextInBatch(batchId)).toMatchObject({ ok: true, data: { pause: true } });
  });

  it("outra aba estornando: espera, sem estornar", async () => {
    rpcResults({ claim_session_refund_item: { data: { state: "busy" } } });
    expect(await refundNextInBatch(batchId)).toEqual({ ok: true, data: { state: "busy" } });
    expect(mocks.refundPaidOrder).not.toHaveBeenCalled();
  });

  it("rápido demais: espera, sem pegar pedido", async () => {
    mocks.consumeRateLimit.mockResolvedValue(false);
    expect(await refundNextInBatch(batchId)).toEqual({ ok: true, data: { state: "wait" } });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("lote terminado", async () => {
    rpcResults({ claim_session_refund_item: { data: { state: "done", status: "concluido" } } });
    expect(await refundNextInBatch(batchId)).toEqual({ ok: true, data: { state: "done", status: "concluido" } });
  });
});
