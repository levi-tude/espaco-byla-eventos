/**
 * Repasse da taxa de serviço: leitura dos resumos do banco (`event_finance_summary`,
 * `service_fee_overview`) e situação de cada evento. Valores sempre em centavos.
 */

import { sessionDayKey } from "@/lib/datetime";

export type PayoutRecord = {
  createdAt: string;
  createdByName: string;
  pixDate: string | null;
};

export type FeeSituation =
  | { kind: "aguardando"; dueDate: string | null }
  | { kind: "a_pagar"; balanceCents: number }
  | { kind: "pago"; last: PayoutRecord }
  | { kind: "sem_taxa" }
  | { kind: "desconto"; balanceCents: number };

/** Dia de hoje no fuso do evento ("2026-10-04"). */
export function todayKey(now: Date = new Date()): string {
  return sessionDayKey(now);
}

/**
 * "Aguardando fim do evento" antes da data de pagar; depois, "A pagar" com saldo
 * positivo. Saldo negativo (estorno ou contestação depois do repasse) é desconto
 * pendente em qualquer data.
 */
export function feeSituation(input: {
  dueDate: string | null;
  balanceCents: number;
  lastPayout: PayoutRecord | null;
  today: string;
}): FeeSituation {
  if (input.balanceCents < 0) return { kind: "desconto", balanceCents: input.balanceCents };
  if (input.balanceCents > 0) {
    return input.dueDate !== null && input.today >= input.dueDate
      ? { kind: "a_pagar", balanceCents: input.balanceCents }
      : { kind: "aguardando", dueDate: input.dueDate };
  }
  return input.lastPayout ? { kind: "pago", last: input.lastPayout } : { kind: "sem_taxa" };
}

export type FinanceHistoryEntry = {
  id: string;
  kind: "repasse" | "ajuste";
  /** Parte deste evento no lançamento (negativa = desconto abatido). */
  amountCents: number;
  payoutTotalCents: number;
  pixDate: string | null;
  note: string | null;
  reason: string | null;
  createdByName: string;
  createdAt: string;
};

export type ChargebackEntry = {
  id: string;
  orderId: string;
  kind: "contestacao" | "reversao";
  amountCents: number;
  feeCents: number;
  reason: string;
  source: "manual" | "automatico";
  createdByName: string | null;
  createdAt: string;
};

export type PendingDiscount = { eventId: string; eventName: string; balanceCents: number };

export type EventFinanceSummary = {
  eventId: string;
  dueDate: string | null;
  lastSessionEndsAt: string | null;
  ticketsCents: number;
  feeCents: number;
  paidTotalCents: number;
  refundedCents: number;
  refundedFeeCents: number;
  refundedOrders: number;
  contestedCents: number;
  contestedFeeCents: number;
  contestedOrders: number;
  feeDueCents: number;
  paidOutCents: number;
  balanceCents: number;
  decisionOrders: number;
  decisionCents: number;
  decisionFeeCents: number;
  espacoCents: number;
  rateBps: number;
  history: FinanceHistoryEntry[];
  chargebacks: ChargebackEntry[];
  contestedOrderIds: string[];
  lastPayout: PayoutRecord | null;
  pendingDiscounts: PendingDiscount[];
  suggestedPayoutCents: number;
};

export type OverviewEvent = {
  eventId: string;
  name: string;
  lastSessionAt: string | null;
  dueDate: string | null;
  ticketsCents: number;
  feeCents: number;
  refundedCents: number;
  contestedCents: number;
  feeDueCents: number;
  paidOutCents: number;
  balanceCents: number;
  lastPayout: (PayoutRecord & { note: string | null }) | null;
};

export type ServiceFeeOverview = {
  events: OverviewEvent[];
  toPayCents: number;
  paidInPeriodCents: number;
  pendingDiscountCents: number;
};

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function int(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
function list(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function payout(value: unknown): PayoutRecord | null {
  if (!isRecord(value) || !str(value.created_at)) return null;
  return {
    createdAt: str(value.created_at) ?? "",
    createdByName: str(value.created_by_name) ?? "—",
    pixDate: str(value.pix_date),
  };
}

export function parseEventFinanceSummary(data: unknown): EventFinanceSummary | null {
  if (!isRecord(data) || !str(data.event_id)) return null;
  return {
    eventId: str(data.event_id) ?? "",
    dueDate: str(data.due_date),
    lastSessionEndsAt: str(data.last_session_ends_at),
    ticketsCents: int(data.tickets_cents),
    feeCents: int(data.fee_cents),
    paidTotalCents: int(data.paid_total_cents),
    refundedCents: int(data.refunded_cents),
    refundedFeeCents: int(data.refunded_fee_cents),
    refundedOrders: int(data.refunded_orders),
    contestedCents: int(data.contested_cents),
    contestedFeeCents: int(data.contested_fee_cents),
    contestedOrders: int(data.contested_orders),
    feeDueCents: int(data.fee_due_cents),
    paidOutCents: int(data.paid_out_cents),
    balanceCents: int(data.balance_cents),
    decisionOrders: int(data.decision_orders),
    decisionCents: int(data.decision_cents),
    decisionFeeCents: int(data.decision_fee_cents),
    espacoCents: int(data.espaco_cents),
    rateBps: int(data.rate_bps),
    history: list(data.history).map((row) => ({
      id: str(row.id) ?? "",
      kind: row.kind === "ajuste" ? "ajuste" : "repasse",
      amountCents: int(row.amount_cents),
      payoutTotalCents: int(row.payout_total_cents),
      pixDate: str(row.pix_date),
      note: str(row.note),
      reason: str(row.reason),
      createdByName: str(row.created_by_name) ?? "—",
      createdAt: str(row.created_at) ?? "",
    })),
    chargebacks: list(data.chargebacks).map((row) => ({
      id: str(row.id) ?? "",
      orderId: str(row.order_id) ?? "",
      kind: row.kind === "reversao" ? "reversao" : "contestacao",
      amountCents: int(row.amount_cents),
      feeCents: int(row.fee_cents),
      reason: str(row.reason) ?? "",
      source: row.source === "automatico" ? "automatico" : "manual",
      createdByName: str(row.created_by_name),
      createdAt: str(row.created_at) ?? "",
    })),
    contestedOrderIds: Array.isArray(data.contested_order_ids)
      ? data.contested_order_ids.filter((id): id is string => typeof id === "string")
      : [],
    lastPayout: payout(data.last_payout),
    pendingDiscounts: list(data.pending_discounts).map((row) => ({
      eventId: str(row.event_id) ?? "",
      eventName: str(row.event_name) ?? "—",
      balanceCents: int(row.balance_cents),
    })),
    suggestedPayoutCents: int(data.suggested_payout_cents),
  };
}

export function parseServiceFeeOverview(data: unknown): ServiceFeeOverview | null {
  if (!isRecord(data) || !Array.isArray(data.events)) return null;
  return {
    events: list(data.events).map((row) => {
      const last = payout(row.last_payout);
      return {
        eventId: str(row.event_id) ?? "",
        name: str(row.name) ?? "—",
        lastSessionAt: str(row.last_session_at),
        dueDate: str(row.due_date),
        ticketsCents: int(row.tickets_cents),
        feeCents: int(row.fee_cents),
        refundedCents: int(row.refunded_cents),
        contestedCents: int(row.contested_cents),
        feeDueCents: int(row.fee_due_cents),
        paidOutCents: int(row.paid_out_cents),
        balanceCents: int(row.balance_cents),
        lastPayout: last
          ? { ...last, note: isRecord(row.last_payout) ? str(row.last_payout.note) : null }
          : null,
      };
    }),
    toPayCents: int(data.to_pay_cents),
    paidInPeriodCents: int(data.paid_in_period_cents),
    pendingDiscountCents: int(data.pending_discount_cents),
  };
}

/** Mensagens das recusas do banco (prefixos estáveis) para quem usa a tela. */
export function feeRefusalMessage(message: string): string | null {
  if (message.includes("TAXA_DEV")) return "A conta do desenvolvedor não pode registrar repasses, ajustes ou contestações.";
  if (message.includes("TAXA_ADMIN")) return "Acesso restrito ao Admin do Espaço.";
  if (message.includes("TAXA_PRAZO")) return "Este evento ainda não terminou. O repasse fica liberado no dia seguinte à última sessão.";
  if (message.includes("TAXA_MUDOU")) return "Os valores mudaram desde que a tela foi aberta. Confira e tente de novo.";
  if (message.includes("TAXA_NADA")) return "Nada a pagar agora. Os descontos pendentes continuam para o próximo repasse.";
  if (message.includes("TAXA_DATA")) return "Data do PIX inválida: não pode ser futura nem antes do fim do evento.";
  if (message.includes("TAXA_NOTA")) return "A nota pode ter até 140 caracteres, sem quebra de linha.";
  if (message.includes("TAXA_MOTIVO")) return "Escreva o motivo (de 5 a 500 caracteres).";
  if (message.includes("TAXA_VALOR")) return "Valor inválido.";
  if (message.includes("TAXA_PEDIDO")) return "Pedido não encontrado ou sem pagamento confirmado.";
  if (message.includes("TAXA_CONTESTACAO_JA")) return "Este pedido já está com contestação registrada.";
  if (message.includes("TAXA_CONTESTACAO_SEM")) return "Este pedido não está contestado.";
  if (message.includes("TAXA_EVENTO")) return "Evento não encontrado.";
  return null;
}
