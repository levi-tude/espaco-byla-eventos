"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { requireFinanceAdmin } from "@/lib/auth/finance-admin";
import { todayKey } from "@/lib/domain/fee-payout";
import { orderNumber } from "@/lib/domain/sessions";
import {
  FEE_MAX_CENTS,
  isFeeAmount,
  isUuid,
  isValidPixDate,
  normalizeFeeNote,
  normalizeFeeReason,
} from "@/lib/finance/fee-inputs";
import { financeRefusalMessage, type PayoutKind } from "@/lib/organizer/finance";
import { notifyOrganizer, organizerNoticeLink } from "@/lib/organizer/notify";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_PATH = "/equipe/repasses";
const NOTE_MESSAGE = "A nota pode ter até 140 caracteres, sem quebra de linha.";
const REASON_MESSAGE = "Escreva o motivo (de 5 a 500 caracteres).";

type Input = Record<string, unknown>;

function asInput(value: unknown): Input {
  return typeof value === "object" && value !== null ? (value as Input) : {};
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** Centavos de 0 até o teto (0 = compensação sem PIX ou tarifa zero). */
function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= FEE_MAX_CENTS;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Recusa conhecida do banco vira mensagem para a tela; o resto fica genérico (e no log só o código). */
function throwRpcError(rpc: string, error: { message: string; code?: string }): never {
  if (/^(ORG|TARIFA|TAXA)_[A-Z_]+/.test(error.message)) {
    throw new ActionError(financeRefusalMessage(error.message));
  }
  console.error(`[repasses] ${rpc} falhou.`, error.code ?? "sem-codigo");
  throw new Error(`${rpc} falhou`);
}

function revalidateEvent(eventId: string | null) {
  if (eventId) {
    revalidatePath(`/equipe/eventos/${eventId}`);
    revalidatePath(`/organizador/eventos/${eventId}`);
  }
  revalidatePath(PAGE_PATH);
}

// ------------------------------------------------------------------ dados para pagar

export type PayoutDetails = {
  pixKeyType: string | null;
  pixKey: string | null;
  holderName: string | null;
  holderDocument: string | null;
  expectedAmountCents: number;
  kind: Extract<PayoutKind, "repasse" | "compensacao"> | null;
  balanceCents: number;
  pendingFeeOrders: number;
  discounts: { eventId: string; eventName: string; cents: number }[];
  releaseUntil: string | null;
};

function parseDetails(raw: unknown): PayoutDetails | null {
  const d = asInput(raw);
  const expected = int(d.expected_amount_cents);
  const balance = int(d.balance_cents);
  const pending = int(d.pending_fee_orders);
  if (expected === null || balance === null || pending === null) return null;
  const kind = d.kind === "repasse" || d.kind === "compensacao" ? d.kind : null;
  const discounts: PayoutDetails["discounts"] = [];
  for (const item of Array.isArray(d.discounts) ? d.discounts : []) {
    const x = asInput(item);
    const cents = int(x.cents);
    if (!isUuid(x.event_id) || typeof x.event_name !== "string" || cents === null) return null;
    discounts.push({ eventId: x.event_id, eventName: x.event_name, cents });
  }
  return {
    pixKeyType: text(d.pix_key_type),
    pixKey: text(d.pix_key),
    holderName: text(d.pix_holder_name),
    holderDocument: text(d.pix_holder_document),
    expectedAmountCents: expected,
    kind,
    balanceCents: balance,
    pendingFeeOrders: pending,
    discounts,
    releaseUntil: text(d.release_until),
  };
}

/** Abre a caixa "Marcar repasse": chave PIX completa só aqui, na hora de pagar (Admin do Espaço). */
export async function loadPayoutDetails(eventId: string): Promise<ActionResult<PayoutDetails>> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    if (!isUuid(eventId)) throw new ActionError("Evento inválido.");
    const { data, error } = await createAdminClient().rpc("organizer_payout_details", {
      p_admin: userId,
      p_event_id: eventId,
    });
    if (error) throwRpcError("organizer_payout_details", error);
    const details = parseDetails(data);
    if (!details) throw new Error("organizer_payout_details: resposta inválida");
    return details;
  }, "Não foi possível abrir os dados do repasse.");
}

// ------------------------------------------------------------------ repasse

export type MarkOrganizerPaidInput = {
  eventId: string;
  expectedAmountCents: number;
  /** "AAAA-MM-DD"; vazio só na compensação (valor 0, sem PIX). */
  pixDate: string | null;
  note?: string | null;
};

export async function markOrganizerPaid(
  input: MarkOrganizerPaidInput,
): Promise<ActionResult<{ amountCents: number; kind: string }>> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    const raw = asInput(input);
    if (!isUuid(raw.eventId)) throw new ActionError("Evento inválido.");
    if (!isCents(raw.expectedAmountCents)) throw new ActionError("Valor inválido.");
    const expected = raw.expectedAmountCents;
    let pixDate: string | null = null;
    if (expected > 0) {
      if (!isValidPixDate(raw.pixDate, todayKey())) {
        throw new ActionError("Informe a data do PIX (não pode ser futura).");
      }
      pixDate = raw.pixDate;
    }
    const note = normalizeFeeNote(raw.note);
    if (!note.ok) throw new ActionError(NOTE_MESSAGE);
    const eventId = raw.eventId;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_organizer_payout", {
      p_admin: userId,
      p_event_id: eventId,
      p_expected_amount_cents: expected,
      p_pix_date: pixDate,
      p_note: note.note,
    });
    if (error) throwRpcError("record_organizer_payout", error);
    revalidateEvent(eventId);

    const result = asInput(data);
    const amountCents = int(result.amount_cents) ?? expected;
    const kind = text(result.kind) ?? "repasse";
    const organizerId = text(result.organizer_id);
    if (organizerId) {
      const { data: event } = await admin.from("events").select("name").eq("id", eventId).maybeSingle();
      await notifyOrganizer(organizerId, "org_repasse_registrado", {
        eventName: event?.name ?? undefined,
        amountCents,
        day: pixDate ?? undefined,
        link: organizerNoticeLink(`/organizador/eventos/${eventId}?aba=financeiro`),
      });
    }
    return { amountCents, kind };
  }, "Não foi possível registrar o repasse.");
}

// ------------------------------------------------------------------ ajuste

export type OrganizerAdjustmentInput = {
  eventId: string;
  /** "espaco" = o organizador ficou devendo ao Espaço; "organizador" = o Espaço deve ao organizador. */
  direction: "espaco" | "organizador";
  amountCents: number;
  reason: string;
};

export async function addOrganizerAdjustment(input: OrganizerAdjustmentInput): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    const raw = asInput(input);
    if (!isUuid(raw.eventId)) throw new ActionError("Evento inválido.");
    if (raw.direction !== "espaco" && raw.direction !== "organizador") throw new ActionError("Escolha o lado do ajuste.");
    if (!isFeeAmount(raw.amountCents, { allowNegative: false })) {
      throw new ActionError("Informe um valor maior que zero.");
    }
    const reason = normalizeFeeReason(raw.reason);
    if (!reason) throw new ActionError(REASON_MESSAGE);
    const amount = raw.direction === "espaco" ? raw.amountCents : -raw.amountCents;

    const { error } = await createAdminClient().rpc("record_organizer_payout_adjustment", {
      p_admin: userId,
      p_event_id: raw.eventId,
      p_amount_cents: amount,
      p_reason: reason,
    });
    if (error) throwRpcError("record_organizer_payout_adjustment", error);
    revalidateEvent(raw.eventId);
    return undefined;
  }, "Não foi possível lançar o ajuste.");
}

// ------------------------------------------------------------------ devolução recebida

export type RefundReceivedInput = {
  organizerId: string;
  amountCents: number;
  pixDate: string;
  note?: string | null;
};

export async function markRefundReceived(
  input: RefundReceivedInput,
): Promise<ActionResult<{ remainingCents: number | null }>> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    const raw = asInput(input);
    if (!isUuid(raw.organizerId)) throw new ActionError("Organizador inválido.");
    if (!isFeeAmount(raw.amountCents, { allowNegative: false })) {
      throw new ActionError("Informe um valor maior que zero.");
    }
    if (!isValidPixDate(raw.pixDate, todayKey())) throw new ActionError("Informe a data do PIX (não pode ser futura).");
    const note = normalizeFeeNote(raw.note);
    if (!note.ok) throw new ActionError(NOTE_MESSAGE);

    const { data, error } = await createAdminClient().rpc("record_organizer_refund_received", {
      p_admin: userId,
      p_organizer_id: raw.organizerId,
      p_amount_cents: raw.amountCents,
      p_pix_date: raw.pixDate,
      p_note: note.note,
    });
    if (error) throwRpcError("record_organizer_refund_received", error);
    revalidatePath(PAGE_PATH);
    return { remainingCents: int(asInput(data).remaining_cents) };
  }, "Não foi possível registrar a devolução.");
}

// ------------------------------------------------------------------ tarifa do banco

export type PendingFeeOrder = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  totalCents: number;
  status: string;
};

/** Pedidos do evento ainda sem tarifa do banco (leitura; o desenvolvedor também vê). */
export async function loadPendingFees(eventId: string): Promise<ActionResult<PendingFeeOrder[]>> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: false });
    if (!isUuid(eventId)) throw new ActionError("Evento inválido.");
    const { data, error } = await createAdminClient().rpc("event_fee_pending_orders", {
      p_admin: userId,
      p_event_id: eventId,
    });
    if (error) throwRpcError("event_fee_pending_orders", error);
    return (data ?? []).map((row) => ({
      orderId: row.order_id,
      orderNumber: orderNumber(row.order_id),
      createdAt: row.created_at,
      totalCents: row.total_cents,
      status: row.status,
    }));
  }, "Não foi possível carregar os pedidos.");
}

export type ManualFeeInput = { orderId: string; eventId: string; feeCents: number; note: string };

/** Tarifa de um pedido lida no extrato do banco de pagamento. */
export async function setManualFee(input: ManualFeeInput): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    const raw = asInput(input);
    if (!isUuid(raw.orderId) || !isUuid(raw.eventId)) throw new ActionError("Pedido inválido.");
    if (!isCents(raw.feeCents)) throw new ActionError("Valor inválido.");
    const note = normalizeFeeNote(raw.note);
    if (!note.ok || !note.note) throw new ActionError("Informe de onde veio o valor (até 140 caracteres).");

    const { error } = await createAdminClient().rpc("record_payment_fee_manual", {
      p_admin: userId,
      p_order_id: raw.orderId,
      p_fee_cents: raw.feeCents,
      p_note: note.note,
    });
    if (error) throwRpcError("record_payment_fee_manual", error);
    revalidateEvent(raw.eventId);
    return undefined;
  }, "Não foi possível lançar a tarifa.");
}

export type EventFeeTotalInput = {
  eventId: string;
  /** O que a tela mostrava: se a lista mudou, o banco recusa. */
  expectedOrders: number;
  expectedPendingCents: number;
  totalFeeCents: number;
  note: string;
};

/** Total de tarifas do evento lido no extrato (reparte entre os pedidos ainda sem tarifa). */
export async function setEventFeeTotal(input: EventFeeTotalInput): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireFinanceAdmin({ write: true });
    const raw = asInput(input);
    if (!isUuid(raw.eventId)) throw new ActionError("Evento inválido.");
    const orders = int(raw.expectedOrders);
    const pending = int(raw.expectedPendingCents);
    if (orders === null || orders < 1 || pending === null || pending < 0) throw new ActionError("Atualize a página.");
    if (!isCents(raw.totalFeeCents)) throw new ActionError("Valor inválido.");
    const note = normalizeFeeNote(raw.note);
    if (!note.ok || !note.note) throw new ActionError("Informe de onde veio o valor (até 140 caracteres).");

    const { error } = await createAdminClient().rpc("record_event_fee_total", {
      p_admin: userId,
      p_event_id: raw.eventId,
      p_expected_orders: orders,
      p_expected_pending_cents: pending,
      p_total_fee_cents: raw.totalFeeCents,
      p_note: note.note,
    });
    if (error) throwRpcError("record_event_fee_total", error);
    revalidateEvent(raw.eventId);
    return undefined;
  }, "Não foi possível lançar as tarifas.");
}
