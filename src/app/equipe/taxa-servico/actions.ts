"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { alertTeamFeePayout } from "@/lib/alerts/team-alert";
import { requireFinanceAdmin } from "@/lib/auth/finance-admin";
import { feeRefusalMessage, todayKey } from "@/lib/domain/fee-payout";
import {
  isFeeAmount,
  isUuid,
  isValidPixDate,
  normalizeFeeNote,
  normalizeFeeReason,
} from "@/lib/finance/fee-inputs";
import { createAdminClient } from "@/lib/supabase/admin";

const FEE_PAGE_PATH = "/equipe/taxa-servico";
const REASON_MESSAGE = "Escreva o motivo (de 5 a 500 caracteres).";

type Input = Record<string, unknown>;

function asInput(value: unknown): Input {
  return typeof value === "object" && value !== null ? (value as Input) : {};
}

/** Recusa conhecida do banco vira mensagem para a tela; o resto fica genérico. */
function throwRpcError(rpc: string, message: string): never {
  const known = feeRefusalMessage(message);
  if (known) throw new ActionError(known);
  throw new Error(`${rpc} falhou: ${message}`);
}

function revalidateFinance(eventId: string | null) {
  if (eventId) revalidatePath(`/equipe/eventos/${eventId}`);
  revalidatePath(FEE_PAGE_PATH);
}

export type MarkFeePaidInput = {
  eventId: string;
  expectedAmountCents: number;
  /** "AAAA-MM-DD" */
  pixDate: string;
  note?: string | null;
};

/** "Marcar como pago": grava o repasse (imutável) e avisa a equipe por e-mail. */
export async function markFeePaid(
  input: MarkFeePaidInput,
): Promise<ActionResult<{ amountCents: number }>> {
  return runAction(() => markFeePaidOrThrow(input), "Não foi possível registrar o repasse.");
}

async function markFeePaidOrThrow(raw: unknown): Promise<{ amountCents: number }> {
  const { userId } = await requireFinanceAdmin({ write: true });
  const input = asInput(raw);
  if (!isUuid(input.eventId)) throw new ActionError("Evento inválido.");
  if (!isFeeAmount(input.expectedAmountCents, { allowNegative: false })) {
    throw new ActionError("Valor inválido.");
  }
  if (!isValidPixDate(input.pixDate, todayKey())) {
    throw new ActionError("Informe a data do PIX (não pode ser futura).");
  }
  const note = normalizeFeeNote(input.note);
  if (!note.ok) throw new ActionError("A nota pode ter até 140 caracteres, sem quebra de linha.");
  const eventId = input.eventId;
  const pixDate = input.pixDate;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_service_fee_payout", {
    p_event_id: eventId,
    p_staff_user_id: userId,
    p_expected_amount_cents: input.expectedAmountCents,
    p_pix_date: pixDate,
    p_note: note.note,
  });
  if (error) throwRpcError("record_service_fee_payout", error.message);
  revalidateFinance(eventId);

  const result = asInput(data);
  const payoutId = typeof result.payout_id === "string" ? result.payout_id : null;
  const amountCents =
    typeof result.amount_cents === "number" ? result.amount_cents : input.expectedAmountCents;

  try {
    const { data: event } = await admin.from("events").select("name").eq("id", eventId).maybeSingle();
    await alertTeamFeePayout(admin, {
      payoutId: payoutId ?? `${eventId}:${pixDate}`,
      amountCents,
      staffName: typeof result.created_by_name === "string" ? result.created_by_name : "Equipe",
      eventId,
      eventName: event?.name ?? "evento",
      pixDate,
      note: note.note,
    });
  } catch (alertError) {
    console.error("[financeiro] Repasse gravado, mas o alerta falhou.", {
      eventId,
      payoutId,
      error: alertError instanceof Error ? alertError.message : "desconhecido",
    });
  }

  return { amountCents };
}

export type FeeAdjustmentInput = {
  eventId: string;
  /** Positivo = PIX extra feito; negativo = repasse registrado a mais. */
  amountCents: number;
  reason: string;
};

/** "Lançar ajuste": corrige o "já repassado" sem editar nenhum lançamento. */
export async function addFeeAdjustment(input: FeeAdjustmentInput): Promise<ActionResult> {
  return runAction(() => addFeeAdjustmentOrThrow(input), "Não foi possível lançar o ajuste.");
}

async function addFeeAdjustmentOrThrow(raw: unknown): Promise<undefined> {
  const { userId } = await requireFinanceAdmin({ write: true });
  const input = asInput(raw);
  if (!isUuid(input.eventId)) throw new ActionError("Evento inválido.");
  if (!isFeeAmount(input.amountCents, { allowNegative: true })) {
    throw new ActionError("Informe um valor diferente de zero (até R$ 100.000,00).");
  }
  const reason = normalizeFeeReason(input.reason);
  if (!reason) throw new ActionError(REASON_MESSAGE);

  const { error } = await createAdminClient().rpc("record_service_fee_adjustment", {
    p_event_id: input.eventId,
    p_staff_user_id: userId,
    p_amount_cents: input.amountCents,
    p_reason: reason,
  });
  if (error) throwRpcError("record_service_fee_adjustment", error.message);
  revalidateFinance(input.eventId);
  return undefined;
}

export type ChargebackKind = "contestacao" | "reversao";

export type ChargebackInput = {
  orderId: string;
  kind: ChargebackKind;
  reason: string;
};

/** "Registrar contestação" / "Desfazer contestação" de um pedido pago. */
export async function registerChargeback(
  input: ChargebackInput,
): Promise<ActionResult<{ kind: ChargebackKind }>> {
  return runAction(
    () => registerChargebackOrThrow(input),
    "Não foi possível registrar a contestação.",
  );
}

async function registerChargebackOrThrow(raw: unknown): Promise<{ kind: ChargebackKind }> {
  const { userId } = await requireFinanceAdmin({ write: true });
  const input = asInput(raw);
  if (!isUuid(input.orderId)) throw new ActionError("Pedido inválido.");
  if (input.kind !== "contestacao" && input.kind !== "reversao") {
    throw new ActionError("Escolha registrar ou desfazer a contestação.");
  }
  const reason = normalizeFeeReason(input.reason);
  if (!reason) throw new ActionError(REASON_MESSAGE);

  const { data, error } = await createAdminClient().rpc("register_order_chargeback", {
    p_order_id: input.orderId,
    p_staff_user_id: userId,
    p_kind: input.kind,
    p_reason: reason,
  });
  if (error) throwRpcError("register_order_chargeback", error.message);
  const result = asInput(data);
  revalidateFinance(typeof result.event_id === "string" ? result.event_id : null);
  return { kind: input.kind };
}
