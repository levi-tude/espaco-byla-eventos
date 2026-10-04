import { REFUND_REASON_MAX, REFUND_REASON_MIN } from "@/lib/domain/refund";

/** Palavra digitada para cancelar a sessão (maiúsculas ou minúsculas). O banco confere de novo. */
export const CANCEL_CONFIRMATION_WORD = "CANCELAR";

export const SESSION_CANCEL_REASON_MIN = REFUND_REASON_MIN;
export const SESSION_CANCEL_REASON_MAX = REFUND_REASON_MAX;

/** Três erros temporários seguidos no "Estornar todos": a tela para e pede para continuar depois. */
export const REFUND_BATCH_PAUSE_AFTER_ERRORS = 3;

/** Pausa entre um estorno e outro no "Estornar todos" (no máximo ~1 por segundo). */
export const REFUND_BATCH_INTERVAL_MS = 1000;

export function isCancelConfirmation(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === CANCEL_CONFIRMATION_WORD;
}

const MONEY_PATTERNS = [
  /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/, // 1.250,00 · 1.250
  /^\d+(?:,\d{1,2})?$/, // 1250,00 · 1250
];

/**
 * Valor digitado na confirmação do "Estornar todos" em centavos. Aceita
 * "1.250,00", "1250,00", "1250" e "R$ 1.250,00"; qualquer outra forma é `null`.
 */
export function parseMoneyToCents(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/^\s*R\$\s*/i, "").trim();
  if (text.length === 0 || text.length > 20) return null;
  if (!MONEY_PATTERNS.some((pattern) => pattern.test(text))) return null;
  const [whole, fraction = ""] = text.replaceAll(".", "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export type SessionNoticeKind = "alteracao_horario" | "cancelamento" | "estorno_cancelamento";

export type SessionNoticeSummary = {
  id: string;
  kind: SessionNoticeKind;
  createdAt: string;
  requestedByName: string | null;
  newStartsAt: string | null;
  total: number;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
};

export type RefundBatchItemStatus =
  | "pendente"
  | "processando"
  | "estornado"
  | "em_processamento"
  | "falhou"
  | "pulado";

export type RefundBatchStatus = "em_andamento" | "concluido" | "concluido_com_falhas";

export type RefundBatchSummary = {
  id: string;
  status: RefundBatchStatus;
  reason: string;
  requestedByName: string | null;
  expectedCount: number;
  expectedTotalCents: number;
  consecutiveErrors: number;
  createdAt: string;
  finishedAt: string | null;
  items: {
    orderId: string;
    buyerName: string;
    amountCents: number;
    status: RefundBatchItemStatus;
    code: string | null;
  }[];
};

export type SessionOpsSummary = {
  sessionId: string;
  status: "ativa" | "cancelada";
  startsAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  scheduleChange: {
    changeId: string;
    previousStartsAt: string;
    previousEndsAt: string | null;
    newStartsAt: string;
    newEndsAt: string | null;
    recipients: number;
  } | null;
  notices: SessionNoticeSummary[];
  impact: {
    paidOrders: number;
    paidCents: number;
    decisionOrders: number;
    decisionCents: number;
    pendingOrders: number;
    courtesyOrders: number;
    checkedInOrders: number;
    refundedOrders: number;
    refundedCents: number;
  };
  refund: { orders: number; cents: number; skippedCheckIn: number; skippedDeadline: number };
  batch: RefundBatchSummary | null;
  emailPausedUntil: string | null;
};

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const NOTICE_KINDS: readonly SessionNoticeKind[] = ["alteracao_horario", "cancelamento", "estorno_cancelamento"];
const ITEM_STATUSES: readonly RefundBatchItemStatus[] = [
  "pendente",
  "processando",
  "estornado",
  "em_processamento",
  "falhou",
  "pulado",
];
const BATCH_STATUSES: readonly RefundBatchStatus[] = ["em_andamento", "concluido", "concluido_com_falhas"];

function parseNotice(value: unknown): SessionNoticeSummary[] {
  if (!isObj(value)) return [];
  const id = str(value.id);
  const kind = NOTICE_KINDS.find((k) => k === value.kind);
  const createdAt = str(value.created_at);
  if (!id || !kind || !createdAt) return [];
  return [
    {
      id,
      kind,
      createdAt,
      requestedByName: str(value.requested_by_name),
      newStartsAt: str(value.new_starts_at),
      total: num(value.total),
      sent: num(value.sent),
      pending: num(value.pending),
      failed: num(value.failed),
      skipped: num(value.skipped),
    },
  ];
}

function parseBatch(value: unknown): RefundBatchSummary | null {
  if (!isObj(value)) return null;
  const id = str(value.id);
  const status = BATCH_STATUSES.find((s) => s === value.status);
  const createdAt = str(value.created_at);
  if (!id || !status || !createdAt) return null;
  const items = Array.isArray(value.items) ? value.items : [];
  return {
    id,
    status,
    reason: str(value.reason) ?? "",
    requestedByName: str(value.requested_by_name),
    expectedCount: num(value.expected_count),
    expectedTotalCents: num(value.expected_total_cents),
    consecutiveErrors: num(value.consecutive_errors),
    createdAt,
    finishedAt: str(value.finished_at),
    items: items.flatMap((item) => {
      if (!isObj(item)) return [];
      const orderId = str(item.order_id);
      const itemStatus = ITEM_STATUSES.find((s) => s === item.status);
      if (!orderId || !itemStatus) return [];
      return [
        {
          orderId,
          buyerName: str(item.buyer_name) ?? "",
          amountCents: num(item.amount_cents),
          status: itemStatus,
          code: str(item.code),
        },
      ];
    }),
  };
}

/** Lê o resumo devolvido por `session_ops_summary` (o banco calcula tudo; aqui só valida a forma). */
export function parseSessionOpsSummary(value: unknown): SessionOpsSummary | null {
  if (!isObj(value)) return null;
  const sessionId = str(value.session_id);
  const startsAt = str(value.starts_at);
  const status = value.status === "ativa" || value.status === "cancelada" ? value.status : null;
  if (!sessionId || !startsAt || !status) return null;

  const change = isObj(value.schedule_change) ? value.schedule_change : null;
  const changeId = change ? str(change.change_id) : null;
  const previousStartsAt = change ? str(change.previous_starts_at) : null;
  const newStartsAt = change ? str(change.new_starts_at) : null;
  const impact = isObj(value.impact) ? value.impact : {};
  const refund = isObj(value.refund) ? value.refund : {};

  return {
    sessionId,
    status,
    startsAt,
    cancelledAt: str(value.cancelled_at),
    cancelledByName: str(value.cancelled_by_name),
    cancelReason: str(value.cancel_reason),
    scheduleChange:
      change && changeId && previousStartsAt && newStartsAt
        ? {
            changeId,
            previousStartsAt,
            previousEndsAt: str(change.previous_ends_at),
            newStartsAt,
            newEndsAt: str(change.new_ends_at),
            recipients: num(change.recipients),
          }
        : null,
    notices: Array.isArray(value.notices) ? value.notices.flatMap(parseNotice) : [],
    impact: {
      paidOrders: num(impact.paid_orders),
      paidCents: num(impact.paid_cents),
      decisionOrders: num(impact.decision_orders),
      decisionCents: num(impact.decision_cents),
      pendingOrders: num(impact.pending_orders),
      courtesyOrders: num(impact.courtesy_orders),
      checkedInOrders: num(impact.checked_in_orders),
      refundedOrders: num(impact.refunded_orders),
      refundedCents: num(impact.refunded_cents),
    },
    refund: {
      orders: num(refund.orders),
      cents: num(refund.cents),
      skippedCheckIn: num(refund.skipped_check_in),
      skippedDeadline: num(refund.skipped_deadline),
    },
    batch: parseBatch(value.batch),
    emailPausedUntil: str(value.email_paused_until),
  };
}

const SKIP_LABELS: Record<string, string> = {
  com_entrada: "Pulado — já entrou",
  prazo_180_dias: "Pulado — mais de 180 dias",
  ja_estornado: "Pulado — já estornado",
  status_mudou: "Pulado — o pedido mudou",
  sessao_diferente: "Pulado — outra sessão",
};

const FAILURE_LABELS: Record<string, string> = {
  insufficient_money_for_refund: "saldo insuficiente",
  insufficient_money: "saldo insuficiente",
  insufficient_funds: "saldo insuficiente",
  refund_period_exceeded: "prazo encerrado",
  tentativas_esgotadas: "o banco não respondeu",
  provider_order_not_found: "pagamento não encontrado",
};

/** Situação de cada pedido no relatório do "Estornar todos". */
export function refundBatchItemLabel(status: RefundBatchItemStatus, code: string | null): string {
  switch (status) {
    case "estornado":
      return "Estornado";
    case "em_processamento":
      return "Aguardando confirmação do banco";
    case "processando":
      return "Estornando…";
    case "pendente":
      return code ? "Tentando de novo" : "Na fila";
    case "pulado":
      return (code && SKIP_LABELS[code]) || "Pulado";
    case "falhou":
      return `Falhou — ${(code && FAILURE_LABELS[code]) || "recusado pelo Mercado Pago"}`;
  }
}

const NOTICE_KIND_LABELS: Record<SessionNoticeKind, string> = {
  alteracao_horario: "Aviso de mudança de horário",
  cancelamento: "Aviso de cancelamento",
  estorno_cancelamento: "E-mails de valor devolvido",
};

export function noticeKindLabel(kind: SessionNoticeKind): string {
  return NOTICE_KIND_LABELS[kind];
}

/** Mensagens das funções do banco (prefixo estável antes de ":") para a equipe. */
const DB_ERRORS: Record<string, string> = {
  AVISO_EQUIPE: "Acesso restrito à equipe.",
  AVISO_SESSAO: "Sessão não encontrada. Atualize a página.",
  AVISO_SESSAO_CANCELADA: "Esta sessão foi cancelada. Use o aviso de cancelamento.",
  AVISO_SEM_ALTERACAO: "Nenhuma mudança de horário para avisar. Atualize a página.",
  AVISO_SEM_DESTINATARIOS: "Nenhum comprador precisa ser avisado: o horário voltou ao que eles já conheciam.",
  CANCELAR_EQUIPE: "Acesso restrito à equipe.",
  CANCELAR_MOTIVO: `Escreva o motivo do cancelamento (de ${SESSION_CANCEL_REASON_MIN} a ${SESSION_CANCEL_REASON_MAX} caracteres).`,
  CANCELAR_CONFIRMACAO: `Digite ${CANCEL_CONFIRMATION_WORD} para confirmar.`,
  CANCELAR_DADOS: "Não foi possível cancelar: dados da sessão inconsistentes. Fale com o suporte.",
  CANCELAR_SESSAO: "Sessão não encontrada. Atualize a página.",
  LOTE_EQUIPE: "Acesso restrito à equipe.",
  LOTE_MOTIVO: `Escreva o motivo do estorno (de ${REFUND_REASON_MIN} a ${REFUND_REASON_MAX} caracteres).`,
  LOTE_SESSAO: "Sessão não encontrada. Atualize a página.",
  LOTE_SESSAO_ATIVA: "Só dá para estornar todos depois de cancelar a sessão.",
  LOTE_VAZIO: "Não há pedidos para estornar nesta sessão. Atualize a página.",
  LOTE_TOTAL_MUDOU: "Os números mudaram. Confira de novo antes de confirmar.",
  LOTE_NAO_ENCONTRADO: "Estorno em lote não encontrado. Atualize a página.",
  LOTE_OUTRO_ABERTO: "Já há um estorno em andamento nesta sessão. Continue por ele.",
};

/** Mensagem amigável para um erro conhecido do banco; `null` se o erro for inesperado. */
export function sessionOpsErrorMessage(message: string | null | undefined): string | null {
  const prefix = message?.match(/^([A-Z_]+)(?::|$)/)?.[1];
  return (prefix && DB_ERRORS[prefix]) || null;
}
