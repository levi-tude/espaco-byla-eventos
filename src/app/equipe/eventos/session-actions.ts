"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { requireStaffUser } from "@/lib/auth/staff-user";
import type { SupabaseAdmin } from "@/lib/domain/orders";
import { normalizeRefundReason } from "@/lib/domain/refund";
import {
  isCancelConfirmation,
  type NoticeProgress,
  parseMoneyToCents,
  parseNoticeProgress,
  REFUND_BATCH_PAUSE_AFTER_ERRORS,
  type RefundBatchItemStatus,
  sessionOpsErrorMessage,
} from "@/lib/domain/session-ops";
import { runSessionNotices } from "@/lib/notices/process";
import { NOTICE_BATCH_SIZE } from "@/lib/notices/rules";
import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import { getPaymentProvider } from "@/lib/payments/provider";
import { RefundActionError, refundPaidOrder } from "@/lib/payments/refund";
import {
  consumeRateLimit,
  RATE_LIMIT_MESSAGE,
  RATE_LIMITS,
  type RateLimitRule,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pendentes cuja cobrança é encerrada no provedor logo após o cancelamento (o resto vence sozinho). */
const MAX_CHARGES_TO_CANCEL = 30;

const EMAIL_NOT_CONFIGURED = "Envio de e-mail não configurado no servidor. Fale com o suporte.";

export type NoticeSendResult = NoticeProgress & { noticeId: string };

export type CancelSessionResult = {
  already: boolean;
  pendingCancelled: number;
  /** Cobranças que não deu para encerrar agora; se forem pagas, caem em "decidir". */
  chargesUnresolved: number;
  notice: NoticeSendResult | null;
};

export type StartRefundBatchResult = {
  batchId: string;
  already: boolean;
  expectedCount: number;
  expectedTotalCents: number;
};

export type RefundStepResult =
  | { state: "done"; status: string }
  | { state: "busy" }
  | { state: "wait" }
  | {
      state: "item";
      orderId: string;
      status: RefundBatchItemStatus;
      code: string | null;
      /** Erros temporários seguidos: a tela para e pede para continuar depois. */
      pause: boolean;
    };

type Obj = Record<string, unknown>;
const asObj = (value: Json | null): Obj | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;

function assertUuid(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ActionError(message);
}

/** Erro conhecido do banco vira mensagem para a equipe; o resto fica só no log. */
function dbError(fn: string, message: string): Error {
  const friendly = sessionOpsErrorMessage(message);
  return friendly ? new ActionError(friendly) : new Error(`${fn} falhou: ${message}`);
}

async function withinLimit(admin: SupabaseAdmin, rule: RateLimitRule, key: string) {
  if (!(await consumeRateLimit(admin, rule, key))) throw new ActionError(RATE_LIMIT_MESSAGE);
}

async function noticeProgress(admin: SupabaseAdmin, noticeId: string): Promise<NoticeSendResult> {
  const { data, error } = await admin.rpc("session_notice_progress", { p_notice_id: noticeId });
  const progress = error ? null : parseNoticeProgress(data);
  if (!progress) throw new Error("session_notice_progress falhou.");
  return { ...progress, noticeId };
}

/** Envia um lote de até 10 e-mails do comunicado e devolve o progresso atualizado. */
async function sendNoticeBatch(admin: SupabaseAdmin, noticeId: string): Promise<NoticeSendResult> {
  const run = await runSessionNotices(admin, { limit: NOTICE_BATCH_SIZE, noticeId });
  if (run.status === "not_configured") throw new ActionError(EMAIL_NOT_CONFIGURED);
  return noticeProgress(admin, noticeId);
}

function revalidateTeamPanel() {
  revalidatePath("/equipe/eventos/[id]", "page");
}

// ---------------------------------------------------------------------------
// Aviso de mudança de horário

/** "Avisar compradores": cria o comunicado (uma vez) e envia o primeiro lote. */
export async function notifyScheduleChange(sessionId: string): Promise<ActionResult<NoticeSendResult>> {
  return runAction(() => notifyScheduleChangeOrThrow(sessionId), "Não foi possível avisar os compradores.");
}

async function notifyScheduleChangeOrThrow(sessionId: unknown): Promise<NoticeSendResult> {
  const { userId } = await requireStaffUser();
  assertUuid(sessionId, "Sessão inválida.");
  const admin = createAdminClient();
  await withinLimit(admin, RATE_LIMITS.sessionNoticesPerStaff, userId);

  const { data, error } = await admin.rpc("queue_schedule_change_notice", {
    p_session_id: sessionId,
    p_staff_user_id: userId,
  });
  if (error) throw dbError("queue_schedule_change_notice", error.message);
  const noticeId = asObj(data)?.notice_id;
  if (typeof noticeId !== "string") throw new Error("Resposta inválida ao criar o aviso.");

  try {
    return await sendNoticeBatch(admin, noticeId);
  } finally {
    revalidateTeamPanel();
  }
}

/** "Continuar envio": envia mais um lote do comunicado (a tela repete enquanto houver pendentes). */
export async function continueSessionNotices(noticeId: string): Promise<ActionResult<NoticeSendResult>> {
  return runAction(() => continueSessionNoticesOrThrow(noticeId), "Não foi possível continuar o envio.");
}

async function continueSessionNoticesOrThrow(noticeId: unknown): Promise<NoticeSendResult> {
  const { userId } = await requireStaffUser();
  assertUuid(noticeId, "Aviso inválido.");
  const admin = createAdminClient();
  await withinLimit(admin, RATE_LIMITS.sessionNoticesPerStaff, userId);

  const before = await noticeProgress(admin, noticeId);
  if (before.total === 0) throw new ActionError("Aviso não encontrado. Atualize a página.");
  if (before.pending === 0) return before;
  try {
    return await sendNoticeBatch(admin, noticeId);
  } finally {
    revalidateTeamPanel();
  }
}

/** "Tentar de novo": volta para a fila os e-mails que falharam 3 vezes e envia um lote. */
export async function retrySessionNotices(noticeId: string): Promise<ActionResult<NoticeSendResult>> {
  return runAction(() => retrySessionNoticesOrThrow(noticeId), "Não foi possível tentar de novo.");
}

async function retrySessionNoticesOrThrow(noticeId: unknown): Promise<NoticeSendResult> {
  const { userId } = await requireStaffUser();
  assertUuid(noticeId, "Aviso inválido.");
  const admin = createAdminClient();
  await withinLimit(admin, RATE_LIMITS.sessionNoticesPerStaff, userId);

  const { error } = await admin.rpc("retry_failed_session_notices", {
    p_notice_id: noticeId,
    p_staff_user_id: userId,
  });
  if (error) throw dbError("retry_failed_session_notices", error.message);
  try {
    return await sendNoticeBatch(admin, noticeId);
  } finally {
    revalidateTeamPanel();
  }
}

// ---------------------------------------------------------------------------
// Cancelar sessão

export async function cancelSession(
  sessionId: string,
  reason: string,
  confirmation: string,
  notify: boolean,
): Promise<ActionResult<CancelSessionResult>> {
  return runAction(
    () => cancelSessionOrThrow(sessionId, reason, confirmation, notify),
    "Não foi possível cancelar a sessão.",
  );
}

async function cancelSessionOrThrow(
  sessionId: unknown,
  reason: unknown,
  confirmation: unknown,
  notify: unknown,
): Promise<CancelSessionResult> {
  const { userId } = await requireStaffUser();
  assertUuid(sessionId, "Sessão inválida.");
  const normalizedReason = normalizeRefundReason(reason);
  if (!normalizedReason) throw new ActionError(sessionOpsErrorMessage("CANCELAR_MOTIVO") ?? "Motivo inválido.");
  if (!isCancelConfirmation(confirmation)) {
    throw new ActionError(sessionOpsErrorMessage("CANCELAR_CONFIRMACAO") ?? "Confirmação inválida.");
  }
  if (typeof notify !== "boolean") throw new ActionError("Escolha se os compradores serão avisados.");

  const admin = createAdminClient();
  await withinLimit(admin, RATE_LIMITS.sessionCancelPerStaff, userId);
  const { data: session } = await admin
    .from("event_sessions")
    .select("event_id, events(slug)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new ActionError("Sessão não encontrada. Atualize a página.");

  const { data, error } = await admin.rpc("cancel_event_session", {
    p_session_id: sessionId,
    p_staff_user_id: userId,
    p_reason: normalizedReason,
    p_confirmation: String(confirmation),
    p_notify: notify,
  });
  if (error) throw dbError("cancel_event_session", error.message);
  const result = asObj(data);
  if (!result) throw new Error("Resposta inválida ao cancelar a sessão.");

  const event = Array.isArray(session.events) ? session.events[0] : session.events;
  revalidatePath(`/equipe/eventos/${session.event_id}`);
  revalidatePath("/");
  if (event?.slug) revalidatePath(`/eventos/${event.slug}`);

  const pending = Array.isArray(result.pending_orders) ? result.pending_orders : [];
  const chargesUnresolved = await closePendingCharges(admin, pending);

  let notice: NoticeSendResult | null = null;
  const noticeId = typeof result.notice_id === "string" ? result.notice_id : null;
  if (noticeId) {
    try {
      notice = await sendNoticeBatch(admin, noticeId);
    } catch (sendError) {
      // A sessão já está cancelada: o envio continua pelo agendador ou pelo botão.
      console.error("[sessao] Sessão cancelada, mas o primeiro lote de avisos não saiu.", sendError);
      notice = await noticeProgress(admin, noticeId).catch(() => null);
    }
  }

  return {
    already: result.already === true,
    pendingCancelled: pending.length,
    chargesUnresolved,
    notice,
  };
}

/**
 * Encerra no provedor as cobranças dos pedidos pendentes que o cancelamento
 * cancelou (ex.: PIX gerado). Se já foram pagas, a confirmação normal leva o
 * pedido para "decidir". Nunca lança: o cancelamento já está gravado.
 */
async function closePendingCharges(admin: SupabaseAdmin, pending: unknown[]): Promise<number> {
  const provider = getPaymentProvider();
  let unresolved = Math.max(0, pending.length - MAX_CHARGES_TO_CANCEL);
  for (const item of pending.slice(0, MAX_CHARGES_TO_CANCEL)) {
    if (!item || typeof item !== "object") continue;
    const { id, created_at: createdAt } = item as Obj;
    if (typeof id !== "string" || typeof createdAt !== "string") continue;
    try {
      const charges = await provider.cancelPendingCharges({ id, createdAt });
      if (charges.kind === "paid") {
        await confirmOrderPaid(admin, id, provider.name, charges.amountCents, charges);
      } else if (charges.kind !== "cleared") {
        unresolved += 1;
      }
    } catch (error) {
      unresolved += 1;
      console.error("[sessao] Falha ao encerrar a cobrança de um pedido cancelado.", { orderId: id, error });
    }
  }
  return unresolved;
}

// ---------------------------------------------------------------------------
// "Estornar todos"

export async function startRefundBatch(
  sessionId: string,
  reason: string,
  typedTotal: string,
): Promise<ActionResult<StartRefundBatchResult>> {
  return runAction(
    () => startRefundBatchOrThrow(sessionId, reason, typedTotal),
    "Não foi possível iniciar o estorno.",
  );
}

async function startRefundBatchOrThrow(
  sessionId: unknown,
  reason: unknown,
  typedTotal: unknown,
): Promise<StartRefundBatchResult> {
  const { userId } = await requireStaffUser();
  assertUuid(sessionId, "Sessão inválida.");
  const normalizedReason = normalizeRefundReason(reason);
  if (!normalizedReason) throw new ActionError(sessionOpsErrorMessage("LOTE_MOTIVO") ?? "Motivo inválido.");
  const cents = parseMoneyToCents(typedTotal);
  if (cents === null) throw new ActionError("Digite o valor total como aparece na tela (ex.: 1.250,00).");

  const admin = createAdminClient();
  await withinLimit(admin, RATE_LIMITS.sessionCancelPerStaff, userId);
  const { data, error } = await admin.rpc("start_session_refund_batch", {
    p_session_id: sessionId,
    p_staff_user_id: userId,
    p_reason: normalizedReason,
    p_confirm_total_cents: cents,
  });
  if (error) throw dbError("start_session_refund_batch", error.message);
  const result = asObj(data);
  if (!result || typeof result.batch_id !== "string") throw new Error("Resposta inválida ao iniciar o estorno.");
  revalidateTeamPanel();
  return {
    batchId: result.batch_id,
    already: result.already === true,
    expectedCount: Number(result.expected_count) || 0,
    expectedTotalCents: Number(result.expected_total_cents) || 0,
  };
}

const BLOCKED_TO_SKIP: Record<string, string> = {
  ESTORNO_JA_FEITO: "ja_estornado",
  ESTORNO_CHECK_IN: "com_entrada",
  ESTORNO_PRAZO: "prazo_180_dias",
  ESTORNO_STATUS: "status_mudou",
  ESTORNO_PROVEDOR: "status_mudou",
};

/** Estorna o próximo pedido do lote (um por chamada; a tela chama em sequência). */
export async function refundNextInBatch(batchId: string): Promise<ActionResult<RefundStepResult>> {
  return runAction(() => refundNextInBatchOrThrow(batchId), "Não foi possível continuar os estornos.");
}

async function refundNextInBatchOrThrow(batchId: unknown): Promise<RefundStepResult> {
  const { userId } = await requireStaffUser();
  assertUuid(batchId, "Estorno inválido.");
  const admin = createAdminClient();
  if (!(await consumeRateLimit(admin, RATE_LIMITS.refundBatchPerBatch, batchId))) {
    return { state: "wait" };
  }

  const { data, error } = await admin.rpc("claim_session_refund_item", {
    p_batch_id: batchId,
    p_staff_user_id: userId,
  });
  if (error) throw dbError("claim_session_refund_item", error.message);
  const claim = asObj(data);
  if (claim?.state === "done") {
    revalidateTeamPanel();
    return { state: "done", status: String(claim.status ?? "") };
  }
  if (claim?.state === "busy") return { state: "busy" };
  if (
    claim?.state !== "item" ||
    typeof claim.item_id !== "string" ||
    typeof claim.order_id !== "string" ||
    typeof claim.reason !== "string"
  ) {
    throw new Error("Resposta inválida ao pegar o próximo pedido.");
  }

  let status: RefundBatchItemStatus;
  let code: string | null = null;
  try {
    const outcome = await refundPaidOrder(admin, getPaymentProvider(), {
      orderId: claim.order_id,
      staffUserId: userId,
      reason: claim.reason,
    });
    status = outcome.status === "refunded" ? "estornado" : "em_processamento";
  } catch (refundError) {
    if (refundError instanceof RefundActionError && refundError.kind === "blocked") {
      const skip = BLOCKED_TO_SKIP[refundError.code];
      status = skip ? "pulado" : "falhou";
      code = skip ?? refundError.code.toLowerCase();
    } else if (refundError instanceof RefundActionError) {
      status = "falhou";
      code = refundError.code;
    } else {
      console.error("[estorno-lote] Erro temporário ao estornar um pedido do lote.", {
        orderId: claim.order_id,
        error: refundError,
      });
      status = "pendente";
      code = "erro_temporario";
    }
  }

  const { data: finished, error: finishError } = await admin.rpc("finish_session_refund_item", {
    p_item_id: claim.item_id,
    p_status: status,
    p_code: code,
  });
  if (finishError) throw new Error(`finish_session_refund_item falhou: ${finishError.message}`);
  const finishedObj = asObj(finished);
  const finalStatus = (typeof finishedObj?.status === "string" ? finishedObj.status : status) as RefundBatchItemStatus;
  const consecutiveErrors = Number(finishedObj?.consecutive_errors) || 0;
  revalidateTeamPanel();

  return {
    state: "item",
    orderId: claim.order_id,
    status: finalStatus,
    code,
    pause: consecutiveErrors >= REFUND_BATCH_PAUSE_AFTER_ERRORS,
  };
}

/** "Tentar de novo os que falharam": volta os itens `falhou` do lote para a fila. */
export async function retryRefundBatchFailures(batchId: string): Promise<ActionResult<number>> {
  return runAction(() => retryRefundBatchFailuresOrThrow(batchId), "Não foi possível tentar de novo.");
}

async function retryRefundBatchFailuresOrThrow(batchId: unknown): Promise<number> {
  const { userId } = await requireStaffUser();
  assertUuid(batchId, "Estorno inválido.");
  const admin = createAdminClient();
  await withinLimit(admin, RATE_LIMITS.sessionCancelPerStaff, userId);
  const { data, error } = await admin.rpc("retry_session_refund_failures", {
    p_batch_id: batchId,
    p_staff_user_id: userId,
  });
  if (error) throw dbError("retry_session_refund_failures", error.message);
  revalidateTeamPanel();
  return typeof data === "number" ? data : 0;
}
