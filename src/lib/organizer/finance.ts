/**
 * Dinheiro do organizador (spec 2026-10-13, seção 10): leitura do JSON do banco,
 * situação do repasse e textos. Funções puras; valores sempre em centavos inteiros.
 */

import { formatMoney } from "@/lib/domain/service-fee";

export type FinanceViewer = "dono" | "admin" | "admin_dev";
export type PayoutKind = "repasse" | "compensacao" | "ajuste" | "devolucao";

export type BalanceFlag = { negativeSince: string; returnDueDate: string | null };

export type FinanceHistoryItem = {
  payoutId: string;
  kind: PayoutKind;
  itemCents: number;
  payoutCents: number;
  pixDate: string | null;
  createdAt: string;
  note: string | null;
  reason: string | null;
  createdByName: string | null;
};

export type LateChange = {
  orderId: string;
  orderNumber: string;
  kind: "estorno" | "contestacao";
  cents: number;
  at: string | null;
};

export type BalanceNumbers = {
  soldCents: number;
  soldOrders: number;
  refundedCents: number;
  refundedOrders: number;
  contestedCents: number;
  contestedOrders: number;
  bankFeeCents: number;
  pendingFeeOrders: number;
  pendingCents: number;
  shareCents: number;
  paidOutCents: number;
  balanceCents: number;
  decisionOrders: number;
  serviceFeeCents: number;
};

export type OrganizerEventFinance = BalanceNumbers & {
  viewer: FinanceViewer;
  eventId: string;
  eventName: string;
  organizerPublicName: string;
  today: string;
  startDate: string | null;
  dueDate: string | null;
  calendarUntil: number | null;
  flag: BalanceFlag | null;
  history: FinanceHistoryItem[];
  lateChanges: LateChange[];
  pix: {
    type: string;
    masked: string;
    holderName: string;
    documentMasked: string;
    changedAt: string | null;
    changePending: boolean;
  };
  team: { organizerId: string; releaseUntil: string | null; pixChangedRecently: boolean } | null;
};

export type OverviewStatus = "atrasado" | "a_pagar" | "em_andamento" | "desconto" | "em_dia";

export type PayoutsOverviewEvent = BalanceNumbers & {
  eventId: string;
  eventName: string;
  organizerId: string;
  organizerPublicName: string;
  organizerStatus: string;
  startDate: string | null;
  dueDate: string | null;
  status: OverviewStatus;
  lastPayoutAt: string | null;
  flag: BalanceFlag | null;
  pixChangePending: boolean;
};

export type PayoutsOverview = {
  today: string;
  calendarUntil: number | null;
  events: PayoutsOverviewEvent[];
  organizersOwing: { organizerId: string; publicName: string; owedCents: number; returnDueDate: string | null }[];
  payouts: {
    payoutId: string;
    kind: PayoutKind;
    amountCents: number;
    pixDate: string | null;
    createdAt: string;
    createdByName: string;
    note: string | null;
    reason: string | null;
    organizerId: string;
    organizerPublicName: string;
    items: { eventId: string; eventName: string; amountCents: number }[];
  }[];
};

export type PayoutSituation =
  | { kind: "andamento"; dueDate: string | null }
  | { kind: "a_pagar"; dueDate: string | null; balanceCents: number; pendingOrders: number }
  | { kind: "conferindo"; pendingOrders: number; dueDate: string | null }
  | { kind: "atrasado"; dueDate: string; balanceCents: number; pendingOrders: number }
  | { kind: "pago"; paidAt: string; paidCents: number }
  | { kind: "sem_valor" }
  | { kind: "desconto"; owedCents: number }
  | { kind: "devolucao"; owedCents: number; returnDueDate: string; overdue: boolean };

// ------------------------------------------------------------------ leitura do JSON

class Invalid extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: readonly PayoutKind[] = ["repasse", "compensacao", "ajuste", "devolucao"];
const VIEWERS: readonly FinanceViewer[] = ["dono", "admin", "admin_dev"];
const STATUSES: readonly OverviewStatus[] = ["atrasado", "a_pagar", "em_andamento", "desconto", "em_dia"];

function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Invalid();
  return value as Record<string, unknown>;
}
function arr(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Invalid();
  return value;
}
function cents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Invalid();
  return value;
}
function str(value: unknown): string {
  if (typeof value !== "string") throw new Invalid();
  return value;
}
function optStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}
function day(value: unknown): string {
  const text = str(value);
  if (!DAY.test(text)) throw new Invalid();
  return text;
}
function optDay(value: unknown): string | null {
  return value === null || value === undefined ? null : day(value);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Invalid();
  return value as T;
}
function optInt(value: unknown): number | null {
  return value === null || value === undefined ? null : cents(value);
}

function numbers(o: Record<string, unknown>): BalanceNumbers {
  return {
    soldCents: cents(o.sold_cents),
    soldOrders: cents(o.sold_orders),
    refundedCents: cents(o.refunded_cents),
    refundedOrders: cents(o.refunded_orders),
    contestedCents: cents(o.contested_cents),
    contestedOrders: cents(o.contested_orders),
    bankFeeCents: cents(o.bank_fee_cents),
    pendingFeeOrders: cents(o.pending_fee_orders),
    pendingCents: cents(o.pending_cents),
    shareCents: cents(o.share_cents),
    paidOutCents: cents(o.paid_out_cents),
    balanceCents: cents(o.balance_cents),
    decisionOrders: cents(o.decision_orders),
    serviceFeeCents: cents(o.service_fee_cents),
  };
}

function flag(value: unknown): BalanceFlag | null {
  if (value === null || value === undefined) return null;
  const o = obj(value);
  return { negativeSince: day(o.negative_since), returnDueDate: optDay(o.return_due_date) };
}

export function parseOrganizerEventFinance(raw: unknown): OrganizerEventFinance | null {
  try {
    const o = obj(raw);
    const pix = obj(o.pix);
    const team = o.team === null || o.team === undefined ? null : obj(o.team);
    return {
      ...numbers(o),
      viewer: oneOf(o.viewer, VIEWERS),
      eventId: str(o.event_id),
      eventName: str(o.event_name),
      organizerPublicName: str(o.organizer_public_name),
      today: day(o.today),
      startDate: optDay(o.start_date),
      dueDate: optDay(o.due_date),
      calendarUntil: optInt(o.calendar_until),
      flag: flag(o.flag),
      history: arr(o.history).map((item) => {
        const h = obj(item);
        return {
          payoutId: str(h.payout_id),
          kind: oneOf(h.kind, KINDS),
          itemCents: cents(h.item_cents),
          payoutCents: cents(h.payout_cents),
          pixDate: optDay(h.pix_date),
          createdAt: str(h.created_at),
          note: optStr(h.note),
          reason: optStr(h.reason),
          createdByName: optStr(h.created_by_name),
        };
      }),
      lateChanges: arr(o.late_changes).map((item) => {
        const c = obj(item);
        return {
          orderId: str(c.order_id),
          orderNumber: str(c.order_number),
          kind: oneOf(c.kind, ["estorno", "contestacao"] as const),
          cents: cents(c.cents),
          at: optStr(c.at),
        };
      }),
      pix: {
        type: str(pix.type),
        masked: str(pix.masked),
        holderName: str(pix.holder_name),
        documentMasked: str(pix.document_masked),
        changedAt: optStr(pix.changed_at),
        changePending: pix.change_pending === true,
      },
      team: team
        ? {
            organizerId: str(team.organizer_id),
            releaseUntil: optDay(team.release_until),
            pixChangedRecently: team.pix_changed_recently === true,
          }
        : null,
    };
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}

export function parsePayoutsOverview(raw: unknown): PayoutsOverview | null {
  try {
    const o = obj(raw);
    return {
      today: day(o.today),
      calendarUntil: optInt(o.calendar_until),
      events: arr(o.events).map((item) => {
        const e = obj(item);
        return {
          ...numbers(e),
          eventId: str(e.event_id),
          eventName: str(e.event_name),
          organizerId: str(e.organizer_id),
          organizerPublicName: str(e.organizer_public_name),
          organizerStatus: str(e.organizer_status),
          startDate: optDay(e.start_date),
          dueDate: optDay(e.due_date),
          status: oneOf(e.status, STATUSES),
          lastPayoutAt: optDay(e.last_payout_at),
          flag: flag(e.flag),
          pixChangePending: e.pix_change_pending === true,
        };
      }),
      organizersOwing: arr(o.organizers_owing).map((item) => {
        const w = obj(item);
        return {
          organizerId: str(w.organizer_id),
          publicName: str(w.public_name),
          owedCents: cents(w.owed_cents),
          returnDueDate: optDay(w.return_due_date),
        };
      }),
      payouts: arr(o.payouts).map((item) => {
        const p = obj(item);
        return {
          payoutId: str(p.payout_id),
          kind: oneOf(p.kind, KINDS),
          amountCents: cents(p.amount_cents),
          pixDate: optDay(p.pix_date),
          createdAt: str(p.created_at),
          createdByName: str(p.created_by_name),
          note: optStr(p.note),
          reason: optStr(p.reason),
          organizerId: str(p.organizer_id),
          organizerPublicName: str(p.organizer_public_name),
          items: arr(p.items).map((it) => {
            const i = obj(it);
            return { eventId: str(i.event_id), eventName: str(i.event_name), amountCents: cents(i.amount_cents) };
          }),
        };
      }),
    };
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}

// ------------------------------------------------------------------ situação

type SituationInput = Pick<
  OrganizerEventFinance,
  "today" | "startDate" | "dueDate" | "balanceCents" | "pendingFeeOrders" | "paidOutCents" | "history" | "flag"
>;

/** Situação do repasse de um evento (spec 10.4). Datas "YYYY-MM-DD" comparadas como texto. */
export function payoutSituation(f: SituationInput): PayoutSituation {
  if (!f.startDate || f.today < f.startDate) return { kind: "andamento", dueDate: f.dueDate };
  if (f.balanceCents > 0) {
    if (f.dueDate && f.today > f.dueDate) {
      return { kind: "atrasado", dueDate: f.dueDate, balanceCents: f.balanceCents, pendingOrders: 0 };
    }
    return { kind: "a_pagar", dueDate: f.dueDate, balanceCents: f.balanceCents, pendingOrders: 0 };
  }
  if (f.balanceCents < 0) {
    const owedCents = -f.balanceCents;
    if (f.flag?.returnDueDate) {
      return { kind: "devolucao", owedCents, returnDueDate: f.flag.returnDueDate, overdue: f.today > f.flag.returnDueDate };
    }
    return { kind: "desconto", owedCents };
  }
  const paid = f.history.filter((h) => (h.kind === "repasse" || h.kind === "compensacao") && h.itemCents > 0);
  if (paid.length > 0 && f.paidOutCents > 0) {
    const last = paid
      .map((h) => h.pixDate ?? h.createdAt.slice(0, 10))
      .sort()
      .at(-1) as string;
    return { kind: "pago", paidAt: last, paidCents: f.paidOutCents };
  }
  return { kind: "sem_valor" };
}

/** Situação de uma linha da página "Repasses" (o resumo traz só a data do último repasse). */
export function overviewSituation(e: PayoutsOverviewEvent, today: string): PayoutSituation {
  const history: FinanceHistoryItem[] = e.lastPayoutAt
    ? [
        {
          payoutId: "",
          kind: "repasse",
          itemCents: e.paidOutCents,
          payoutCents: e.paidOutCents,
          pixDate: e.lastPayoutAt,
          createdAt: e.lastPayoutAt,
          note: null,
          reason: null,
          createdByName: null,
        },
      ]
    : [];
  return payoutSituation({ ...e, today, history });
}

/** "2026-10-30" → "30/10". */
export function shortDay(dayKey: string | null | undefined): string {
  const match = dayKey ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dayKey) : null;
  return match ? `${match[3]}/${match[2]}` : "";
}

function orders(n: number): string {
  return n === 1 ? "1 pedido" : `${n} pedidos`;
}

export function situationLabel(s: PayoutSituation, audience: "organizador" | "equipe"): string {
  const team = audience === "equipe";
  switch (s.kind) {
    case "andamento":
      if (!s.dueDate) return "Prazo a confirmar";
      return team ? `Em andamento · prazo ${shortDay(s.dueDate)}` : `Repasse previsto até ${shortDay(s.dueDate)}`;
    case "a_pagar": {
      const base = !s.dueDate
        ? "Prazo a confirmar"
        : team
          ? `A pagar até ${shortDay(s.dueDate)}`
          : `Em conferência — previsto até ${shortDay(s.dueDate)}`;
      return base;
    }
    case "conferindo":
      return `Conferindo a tarifa do banco de ${orders(s.pendingOrders)}`;
    case "atrasado":
      return team
        ? `Atrasado desde ${shortDay(s.dueDate)}`
        : `Previsto até ${shortDay(s.dueDate)} — o Espaço foi avisado`;
    case "pago":
      return `Pago em ${shortDay(s.paidAt)} · ${formatMoney(s.paidCents)}`;
    case "sem_valor":
      return "Sem valor a repassar";
    case "desconto":
      return team
        ? `Desconto de ${formatMoney(s.owedCents)} no próximo repasse`
        : `−${formatMoney(s.owedCents)} será descontado do próximo repasse`;
    case "devolucao":
      if (team) {
        return s.overdue
          ? `Devolução atrasada · ${formatMoney(s.owedCents)}`
          : `Devolução até ${shortDay(s.returnDueDate)} · ${formatMoney(s.owedCents)}`;
      }
      return s.overdue
        ? `Devolução atrasada: devolva ${formatMoney(s.owedCents)} por PIX à ACDH Eventos`
        : `Devolva ${formatMoney(s.owedCents)} por PIX à ACDH Eventos até ${shortDay(s.returnDueDate)}`;
  }
}

export function situationTone(s: PayoutSituation): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (s.kind) {
    case "atrasado":
      return "danger";
    case "devolucao":
      return s.overdue ? "danger" : "warning";
    case "a_pagar":
    case "conferindo":
    case "desconto":
      return "warning";
    case "pago":
      return "success";
    case "andamento":
      return "info";
    case "sem_valor":
      return "neutral";
  }
}

// ------------------------------------------------------------------ recusas do banco

const GENERIC = "Não foi possível concluir. Tente de novo.";

const FIXED: Record<string, string> = {
  ORG_PIX_PENDENTE: "Existe uma troca de chave PIX aguardando decisão.",
  ORG_PRAZO: "O repasse só pode ser registrado depois da última sessão.",
  ORG_DATA: "Confira a data do PIX: não pode ser no futuro nem antes do fim do evento.",
  ORG_NADA: "Não há valor a repassar neste evento.",
  ORG_NOTA: "Nota inválida (até 140 caracteres, sem quebra de linha).",
  ORG_MOTIVO: "Informe o motivo (de 5 a 500 caracteres).",
  ORG_CODIGO: "Código inválido ou vencido. Peça um novo código.",
  ORG_PIX_IGUAL: "Essa já é a chave PIX cadastrada.",
  ORG_DEVOLUCAO: "Há uma devolução atrasada à ACDH Eventos. Faça a devolução antes de enviar novos eventos.",
  ORG_DADOS: "Confira os dados e tente de novo.",
  ORG_ESTADO: "Isso já foi decidido. Atualize a página.",
  ORG_ACESSO: "Você não tem acesso a esta ação.",
  ORG_PERIODO: "Período inválido.",
  TARIFA_NOTA: "Informe de onde veio o valor (até 140 caracteres).",
  TARIFA_VALOR: "O valor da tarifa não confere. Confira o extrato.",
  TARIFA_PEDIDO: "Este pedido não tem tarifa a lançar.",
  TARIFA_NADA: "Não há pedidos sem tarifa neste evento.",
  TARIFA_MUDOU: "A lista de pedidos sem tarifa mudou. Confira e tente de novo.",
  TAXA_ADMIN: "Só o Admin pode fazer isso.",
  TAXA_DEV: "A conta de desenvolvedor só consulta; quem registra é o Admin do Espaço.",
};

const SAO_PAULO_WHEN = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-16T18:30:00Z" → "16/10 às 15:30" (horário de Brasília). */
export function formatWaitUntil(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(SAO_PAULO_WHEN.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month} às ${parts.hour}:${parts.minute}`;
}

/** Traduz a mensagem de erro do banco (prefixo ORG_/TARIFA_/TAXA_) para o usuário. */
export function financeRefusalMessage(message: string | undefined): string {
  if (!message) return GENERIC;
  const match = /^([A-Z_]+)(?::(\S+))?/.exec(message);
  if (!match) return GENERIC;
  const [, code, arg] = match;
  const amount = arg && /^\d+$/.test(arg) ? Number(arg) : null;
  switch (code) {
    case "ORG_MUDOU":
      return amount === null ? GENERIC : `O valor mudou para ${formatMoney(amount)}. Confira e tente de novo.`;
    case "ORG_TARIFA_PENDENTE":
      return amount === null
        ? GENERIC
        : `Ainda faltam as tarifas de ${orders(amount)}. Lance pelo extrato ou aguarde.`;
    case "ORG_VALOR":
      return amount === null ? "Valor inválido." : `O valor máximo é ${formatMoney(amount)}.`;
    case "ORG_ESPERA": {
      const when = arg ? formatWaitUntil(arg) : null;
      return when ? `A troca só pode ser confirmada a partir de ${when}.` : GENERIC;
    }
    default:
      return FIXED[code] ?? GENERIC;
  }
}
