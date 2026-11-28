/**
 * Lê o JSON das funções do banco e monta o que a tela mostra.
 * Organizador não recebe tarifa do provedor nem taxa líquida — o tipo nem tem esses campos.
 */

import { formatMoney } from "@/lib/domain/service-fee";
import {
  BUCKET_COLOR,
  BUCKET_LABEL,
  REPORT_BUCKETS,
  averageTicket,
  clockLabel,
  closeFinance,
  freeSeats,
  occupancyPercent,
  reportState,
  reportedFinanceCloses,
  type ReportBucket,
  type ReportStateKind,
} from "@/lib/domain/event-report";

export type MoneyAudience = "full" | "simple" | "none";

export type ReportPayments = { pix: number; card: number; other: number; bonus: number };

export type ReportDailyCount = { day: string; tickets: number };

export type ReportSession = {
  id: string;
  name: string | null;
  startsAt: string;
  endsAt: string | null;
  status: "ativa" | "cancelada";
  capacity: number;
  occupied: number;
  training: number;
  present: number;
  presentTraining: number;
  noShow: number | null;
  noShowTraining: number | null;
  buckets: Record<ReportBucket, number>;
  casadinhaUnits: number;
  familiaUnits: number;
  heldTickets: number;
  pendingActiveOrders: number;
  pendingExpiredOrders: number;
  pendingExpiredTickets: number;
  cancelledTickets: number;
  refundedTickets: number;
  refundsOpen: number;
  refundsDone: number;
  meia: { ok: number; diff: number; refused: number; unmarked: number };
  payments: ReportPayments;
  daily: ReportDailyCount[];
  arrival: { label: string; count: number }[];
};

export type EventReport = {
  generatedAt: string;
  live: boolean;
  sessions: ReportSession[];
};

export type AdminFinance = {
  clientPaidCents: number;
  organizerCents: number;
  grossFeeCents: number;
  providerFeeCents: number;
  netFeeCents: number;
  feesPendingOrders: number;
  organizerSoldCents: number;
  organizerRefundedCents: number;
  refundedOrders: number;
  refundedClientCents: number;
  refundedFeeCents: number;
  providerFeeOnRefundsCents: number;
  refundsChecked: number;
  contestedOrders: number;
  contestedCents: number;
  payingOrders: number;
  payingPeople: number;
  organizerPaidOutCents: number;
  organizerBalanceCents: number;
  feePaidOutCents: number;
  feeBalanceCents: number;
  payoutDueDate: string | null;
  feeDueDate: string | null;
  sessions: { id: string; ticketCents: number; pendingActiveCents: number; pendingExpiredCents: number }[];
  daily: { day: string; ticketCents: number }[];
};

/** Financeiro simples. Sem tarifa do provedor e sem taxa líquida. */
export type OrganizerFinance = {
  ticketsSoldCents: number;
  refundedCents: number;
  refundedOrders: number;
  youReceiveCents: number;
  serviceFeeCents: number;
  clientPaidCents: number;
  paidOutCents: number;
  balanceCents: number;
  payoutDueDate: string | null;
  contestedOrders: number;
  contestedCents: number;
  sessions: { id: string; ticketCents: number }[];
  daily: { day: string; ticketCents: number }[];
};

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function int(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return int(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function bucketsOf(value: unknown): Record<ReportBucket, number> {
  const raw = isRecord(value) ? value : {};
  return {
    inteira: int(raw.inteira),
    casadinha: int(raw.casadinha),
    familia: int(raw.familia),
    meia: int(raw.meia),
    bonus: int(raw.bonus),
    capacitacao: int(raw.capacitacao),
  };
}

function paymentsOf(value: unknown): ReportPayments {
  const raw = isRecord(value) ? value : {};
  return { pix: int(raw.pix), card: int(raw.card), other: int(raw.other), bonus: int(raw.bonus) };
}

function dailyOf(value: unknown): ReportDailyCount[] {
  return list(value)
    .map((row) => ({ day: str(row.day) ?? "", tickets: int(row.tickets) }))
    .filter((row) => row.day);
}

function parseSession(raw: Raw): ReportSession | null {
  const id = str(raw.id);
  const startsAt = str(raw.starts_at);
  if (!id || !startsAt) return null;
  const meia = isRecord(raw.meia_check) ? raw.meia_check : {};
  return {
    id,
    name: str(raw.name),
    startsAt,
    endsAt: str(raw.ends_at),
    status: raw.status === "cancelada" ? "cancelada" : "ativa",
    capacity: int(raw.capacity),
    occupied: int(raw.occupied),
    training: int(raw.training),
    present: int(raw.present),
    presentTraining: int(raw.present_training),
    noShow: intOrNull(raw.no_show),
    noShowTraining: intOrNull(raw.no_show_training),
    buckets: bucketsOf(raw.buckets),
    casadinhaUnits: int(raw.casadinha_units),
    familiaUnits: int(raw.familia_units),
    heldTickets: int(raw.held_tickets),
    pendingActiveOrders: int(raw.pending_active_orders),
    pendingExpiredOrders: int(raw.pending_expired_orders),
    pendingExpiredTickets: int(raw.pending_expired_tickets),
    cancelledTickets: int(raw.cancelled_tickets),
    refundedTickets: int(raw.refunded_tickets),
    refundsOpen: int(raw.refunds_open),
    refundsDone: int(raw.refunds_done),
    meia: {
      ok: int(meia.comprovante_ok),
      diff: int(meia.pagou_diferenca),
      refused: int(meia.recusadas),
      unmarked: int(meia.nao_registradas),
    },
    payments: paymentsOf(raw.payments),
    daily: dailyOf(raw.daily),
    arrival: list(raw.arrival)
      .map((row) => ({ label: str(row.label) ?? "", count: int(row.count) }))
      .filter((row) => row.label && row.count > 0),
  };
}

export function parseEventReport(data: unknown): EventReport | null {
  if (!isRecord(data)) return null;
  const generatedAt = str(data.generated_at);
  if (!generatedAt) return null;
  return {
    generatedAt,
    live: data.live === true,
    sessions: list(data.sessions).flatMap((row) => {
      const session = parseSession(row);
      return session ? [session] : [];
    }),
  };
}

export function parseAdminFinance(data: unknown): AdminFinance | null {
  if (!isRecord(data)) return null;
  return {
    clientPaidCents: int(data.client_paid_cents),
    organizerCents: int(data.organizer_cents),
    grossFeeCents: int(data.gross_fee_cents),
    providerFeeCents: int(data.provider_fee_cents),
    netFeeCents: int(data.net_fee_cents),
    feesPendingOrders: int(data.fees_pending_orders),
    organizerSoldCents: int(data.organizer_sold_cents),
    organizerRefundedCents: int(data.organizer_refunded_cents),
    refundedOrders: int(data.refunded_orders),
    refundedClientCents: int(data.refunded_client_cents),
    refundedFeeCents: int(data.refunded_fee_cents),
    providerFeeOnRefundsCents: int(data.provider_fee_on_refunds_cents),
    refundsChecked: int(data.refunds_checked),
    contestedOrders: int(data.contested_orders),
    contestedCents: int(data.contested_cents),
    payingOrders: int(data.paying_orders),
    payingPeople: int(data.paying_people),
    organizerPaidOutCents: int(data.organizer_paid_out_cents),
    organizerBalanceCents: int(data.organizer_balance_cents),
    feePaidOutCents: int(data.fee_paid_out_cents),
    feeBalanceCents: int(data.fee_balance_cents),
    payoutDueDate: str(data.payout_due_date),
    feeDueDate: str(data.fee_due_date),
    sessions: list(data.sessions).flatMap((row) => {
      const id = str(row.id);
      return id
        ? [{
            id,
            ticketCents: int(row.ticket_cents),
            pendingActiveCents: int(row.pending_active_cents),
            pendingExpiredCents: int(row.pending_expired_cents),
          }]
        : [];
    }),
    daily: list(data.daily).flatMap((row) => {
      const day = str(row.day);
      return day ? [{ day, ticketCents: int(row.ticket_cents) }] : [];
    }),
  };
}

/** Campos que a função do organizador não devolve. O parser também não copia, se aparecerem. */
export const ORGANIZER_FORBIDDEN_KEYS = [
  "provider_fee_cents",
  "provider_fee_on_refunds_cents",
  "net_fee_cents",
  "gross_fee_cents",
  "bank_fee_cents",
  "fee_balance_cents",
  "fee_paid_out_cents",
  "fees_pending_orders",
] as const;

export function parseOrganizerFinance(data: unknown): OrganizerFinance | null {
  if (!isRecord(data)) return null;
  return {
    ticketsSoldCents: int(data.tickets_sold_cents),
    refundedCents: int(data.refunded_cents),
    refundedOrders: int(data.refunded_orders),
    youReceiveCents: int(data.you_receive_cents),
    serviceFeeCents: int(data.service_fee_cents),
    clientPaidCents: int(data.client_paid_cents),
    paidOutCents: int(data.paid_out_cents),
    balanceCents: int(data.balance_cents),
    payoutDueDate: str(data.payout_due_date),
    contestedOrders: int(data.contested_orders),
    contestedCents: int(data.contested_cents),
    sessions: list(data.sessions).flatMap((row) => {
      const id = str(row.id);
      return id ? [{ id, ticketCents: int(row.ticket_cents) }] : [];
    }),
    daily: list(data.daily).flatMap((row) => {
      const day = str(row.day);
      return day ? [{ day, ticketCents: int(row.ticket_cents) }] : [];
    }),
  };
}

export type ReportCard = {
  label: string;
  value: string;
  hint: string | null;
  accent: "none" | "money" | "good";
};

export type SessionBlock = {
  id: string;
  title: string;
  cancelled: boolean;
  occupied: number;
  capacity: number;
  percent: number;
  free: number;
  training: number;
  segments: { key: ReportBucket; label: string; people: number; color: string; percent: number }[];
  moneyLabel: string | null;
  pendingLabel: string | null;
};

export type ReportView = {
  money: MoneyAudience;
  stateKind: ReportStateKind;
  stateLabel: string;
  stateDetail: string;
  cards: ReportCard[];
  sessions: SessionBlock[];
  types: { key: ReportBucket; label: string; people: number; color: string }[];
  typeTotal: number;
  typeNote: string | null;
  payments: { label: string; count: number; color: string }[] | null;
  paymentTotal: number;
  daily: { label: string; value: number }[];
  dailyIsMoney: boolean;
  dailyNote: string;
  arrival: { title: string; buckets: { label: string; count: number }[] }[];
  doorPresent: number;
  doorExpected: number;
  doorPercent: number;
  noShowLabel: string;
  meiaSold: number;
  meiaOk: number;
  meiaDiff: number;
  meiaRefused: number;
  meiaUnmarked: number;
  pendingTotal: number;
  pendingHint: string;
  pendingMoney: string | null;
  showSplit: boolean;
  split: {
    organizer: string;
    net: string;
    provider: string;
    client: string;
    organizerCents: number;
    netCents: number;
    providerCents: number;
    provisional: boolean;
    note: string;
  } | null;
  financeCloses: boolean | null;
  simpleLines: { label: string; value: string; emphasis: boolean }[];
  simpleNote: string | null;
  refundRows: { label: string; value: string }[];
  refundMode: "full" | "simple" | "count";
  scopedNote: string | null;
};

function money(cents: number): string {
  return formatMoney(cents);
}

function sumSessions(sessions: readonly ReportSession[]): ReportSession {
  const first = sessions[0];
  const empty: ReportSession = {
    id: "todas",
    name: null,
    startsAt: first?.startsAt ?? "",
    endsAt: null,
    status: "ativa",
    capacity: 0,
    occupied: 0,
    training: 0,
    present: 0,
    presentTraining: 0,
    noShow: 0,
    noShowTraining: 0,
    buckets: { inteira: 0, casadinha: 0, familia: 0, meia: 0, bonus: 0, capacitacao: 0 },
    casadinhaUnits: 0,
    familiaUnits: 0,
    heldTickets: 0,
    pendingActiveOrders: 0,
    pendingExpiredOrders: 0,
    pendingExpiredTickets: 0,
    cancelledTickets: 0,
    refundedTickets: 0,
    refundsOpen: 0,
    refundsDone: 0,
    meia: { ok: 0, diff: 0, refused: 0, unmarked: 0 },
    payments: { pix: 0, card: 0, other: 0, bonus: 0 },
    daily: [],
    arrival: [],
  };
  let noShowKnown = false;
  const daily = new Map<string, number>();
  for (const session of sessions) {
    empty.capacity += session.capacity;
    empty.occupied += session.occupied;
    empty.training += session.training;
    empty.present += session.present;
    empty.presentTraining += session.presentTraining;
    if (session.noShow !== null) {
      noShowKnown = true;
      empty.noShow = (empty.noShow ?? 0) + session.noShow;
      empty.noShowTraining = (empty.noShowTraining ?? 0) + (session.noShowTraining ?? 0);
    }
    for (const key of REPORT_BUCKETS) empty.buckets[key] += session.buckets[key];
    empty.casadinhaUnits += session.casadinhaUnits;
    empty.familiaUnits += session.familiaUnits;
    empty.heldTickets += session.heldTickets;
    empty.pendingActiveOrders += session.pendingActiveOrders;
    empty.pendingExpiredOrders += session.pendingExpiredOrders;
    empty.pendingExpiredTickets += session.pendingExpiredTickets;
    empty.cancelledTickets += session.cancelledTickets;
    empty.refundedTickets += session.refundedTickets;
    empty.refundsOpen += session.refundsOpen;
    empty.refundsDone += session.refundsDone;
    empty.meia.ok += session.meia.ok;
    empty.meia.diff += session.meia.diff;
    empty.meia.refused += session.meia.refused;
    empty.meia.unmarked += session.meia.unmarked;
    empty.payments.pix += session.payments.pix;
    empty.payments.card += session.payments.card;
    empty.payments.other += session.payments.other;
    empty.payments.bonus += session.payments.bonus;
    for (const row of session.daily) daily.set(row.day, (daily.get(row.day) ?? 0) + row.tickets);
  }
  if (!noShowKnown) {
    empty.noShow = null;
    empty.noShowTraining = null;
  }
  empty.daily = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, tickets]) => ({ day, tickets }));
  return empty;
}

function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}` : day;
}

function sessionTitle(session: ReportSession, fallback: string): string {
  return fallback || session.name?.trim() || "Sessão";
}

export function buildReportView(input: {
  money: MoneyAudience;
  report: EventReport;
  admin: AdminFinance | null;
  organizer: OrganizerFinance | null;
  sessionId: string | null;
  sessionLabels: ReadonlyMap<string, string>;
}): ReportView {
  const selected = input.sessionId
    ? input.report.sessions.filter((session) => session.id === input.sessionId)
    : input.report.sessions;
  const scope = sumSessions(selected.length ? selected : input.report.sessions);
  const scoped = Boolean(input.sessionId && selected.length);
  const valid = scope.occupied + scope.training;
  const percent = occupancyPercent(scope.occupied, scope.capacity);
  const admin = input.money === "full" ? input.admin : null;
  const organizer = input.money === "simple" ? input.organizer : null;
  const closed = admin
    ? closeFinance({
        organizerCents: admin.organizerCents,
        grossFeeCents: admin.grossFeeCents,
        providerFeeCents: admin.providerFeeCents,
      })
    : null;
  const financeCloses = admin ? reportedFinanceCloses(admin) : null;
  const state = reportState({
    live: input.report.live,
    feesPending: admin?.feesPendingOrders ?? 0,
    refundsOpen: scope.refundsOpen,
    showFeePending: input.money === "full",
  });
  const averages = admin ? averageTicket(admin.organizerCents, admin.payingOrders, admin.payingPeople) : null;

  const cards: ReportCard[] = [];
  if (input.money === "simple") {
    const came = valid > 0 ? Math.round((scope.present / valid) * 100) : 0;
    cards.push({
      label: "Compareceram",
      value: `${scope.present} de ${valid}`,
      hint: valid > 0 ? `${came}% dos ingressos válidos` : "ainda sem ingressos válidos",
      accent: "good",
    });
  }
  cards.push({
    label: input.money === "simple" ? "Lotação final" : "Lotação",
    value: `${scope.occupied} / ${scope.capacity}`,
    hint: `${percent}% ocupada · ${freeSeats(scope.occupied, scope.capacity)} livres`,
    accent: "none",
  });
  if (input.money !== "simple") {
    cards.push({
      label: "Ingressos válidos",
      value: String(valid),
      hint:
        scope.training > 0
          ? `${scope.occupied} na lotação + ${scope.training} capacitação`
          : "na lotação, inclui cortesias",
      accent: "none",
    });
  }
  if (admin && closed) {
    cards.push({
      label: "O cliente pagou",
      value: money(closed.clientPaidCents),
      hint: "ingressos + taxa de serviço, já sem estornos",
      accent: "money",
    });
    cards.push({
      label: "Taxa de serviço líquida",
      value: money(closed.netFeeCents),
      hint: admin.feesPendingOrders > 0 ? "provisória · ainda falta tarifa" : "taxa bruta menos a tarifa do provedor",
      accent: "good",
    });
    cards.push({
      label: "Ticket médio",
      value: averages?.perOrderCents !== null && averages ? money(averages.perOrderCents) : "—",
      hint:
        averages?.perPersonCents !== null && averages
          ? `${money(averages.perPersonCents)} por pessoa pagante`
          : "por pedido, sem cortesia",
      accent: "none",
    });
  }
  if (organizer) {
    cards.push({
      label: "O cliente pagou",
      value: money(organizer.clientPaidCents),
      hint: "ingressos + taxa de serviço, já sem estornos",
      accent: "money",
    });
    cards.push({
      label: "Você recebe",
      value: money(organizer.youReceiveCents),
      hint: "valor dos ingressos, sem desconto de taxa",
      accent: "good",
    });
  }
  const pendingTotal = scope.pendingActiveOrders + scope.pendingExpiredOrders;
  cards.push({
    label: "Pendentes",
    value: String(pendingTotal),
    hint:
      scope.pendingActiveOrders > 0
        ? `${scope.pendingActiveOrders} ainda seguram vaga · ${scope.pendingExpiredOrders} expiradas, sem vaga`
        : "reservas expiradas, sem vaga",
    accent: "none",
  });

  const ticketCents = new Map<string, number>();
  const pendingCents = new Map<string, { active: number; expired: number }>();
  if (admin) {
    for (const row of admin.sessions) {
      ticketCents.set(row.id, row.ticketCents);
      pendingCents.set(row.id, { active: row.pendingActiveCents, expired: row.pendingExpiredCents });
    }
  } else if (organizer) {
    for (const row of organizer.sessions) ticketCents.set(row.id, row.ticketCents);
  }

  const blocks = (selected.length ? selected : input.report.sessions).map((session): SessionBlock => {
    const title = sessionTitle(session, input.sessionLabels.get(session.id) ?? "");
    const segments = REPORT_BUCKETS.filter((key) => key !== "capacitacao" && session.buckets[key] > 0).map((key) => ({
      key,
      label: BUCKET_LABEL[key],
      people: session.buckets[key],
      color: BUCKET_COLOR[key],
      percent: session.capacity > 0 ? (session.buckets[key] / session.capacity) * 100 : 0,
    }));
    const cents = ticketCents.get(session.id);
    const pendingOrders = session.pendingActiveOrders + session.pendingExpiredOrders;
    return {
      id: session.id,
      title,
      cancelled: session.status === "cancelada",
      occupied: session.occupied,
      capacity: session.capacity,
      percent: occupancyPercent(session.occupied, session.capacity),
      free: freeSeats(session.occupied, session.capacity),
      training: session.training,
      segments,
      moneyLabel: cents !== undefined && input.money !== "none" ? money(cents) : null,
      pendingLabel: pendingOrders > 0 ? `${pendingOrders} pendente${pendingOrders === 1 ? "" : "s"}` : null,
    };
  });

  const types = REPORT_BUCKETS.filter((key) => scope.buckets[key] > 0).map((key) => ({
    key,
    label: BUCKET_LABEL[key],
    people: scope.buckets[key],
    color: BUCKET_COLOR[key],
  }));
  const unitNotes = [
    scope.casadinhaUnits > 0 ? `Casadinha: ${scope.casadinhaUnits} un. · ${scope.buckets.casadinha} pessoas` : null,
    scope.familiaUnits > 0 ? `Família: ${scope.familiaUnits} un. · ${scope.buckets.familia} pessoas` : null,
  ].filter(Boolean);

  const payments =
    input.money === "simple"
      ? null
      : [
          { label: "Pix", count: scope.payments.pix, color: "#4ADE80" },
          { label: "Cartão", count: scope.payments.card, color: "#4080FC" },
          { label: "Sem método", count: scope.payments.other, color: "#A1A1AA" },
          { label: "Bônus (sem pagamento)", count: scope.payments.bonus, color: "#FFBD38" },
        ].filter((row) => row.count > 0);

  const dailySource =
    input.money === "none"
      ? scope.daily.map((row) => ({ label: dayLabel(row.day), value: row.tickets }))
      : (admin?.daily ?? organizer?.daily ?? []).map((row) => ({ label: dayLabel(row.day), value: row.ticketCents }));

  const arrivalSessions = (scoped ? selected : input.report.sessions).filter((session) => session.arrival.length > 0);

  let noShowLabel = "A falta só conta depois que a sessão termina.";
  if (scope.noShow !== null) {
    const training = scope.noShowTraining ?? 0;
    noShowLabel =
      training > 0
        ? `${scope.noShow} na lotação · ${training} de capacitação`
        : `${scope.noShow} não ${scope.noShow === 1 ? "veio" : "vieram"}`;
  }

  const pendingMoney = admin
    ? money(
        admin.sessions
          .filter((row) => !scoped || row.id === input.sessionId)
          .reduce((total, row) => total + row.pendingExpiredCents, 0),
      )
    : null;

  const split = admin && closed
    ? {
        organizer: money(closed.organizerCents),
        net: money(closed.netFeeCents),
        provider: money(closed.providerFeeCents),
        client: money(closed.clientPaidCents),
        organizerCents: closed.organizerCents,
        netCents: closed.netFeeCents,
        providerCents: closed.providerFeeCents,
        provisional: admin.feesPendingOrders > 0,
        note: admin.feesPendingOrders > 0
          ? "Provisório: ainda há tarifa do provedor sem leitura. Quando entrar, a taxa líquida muda e a parte do organizador não."
          : "A conta fecha: organizador + taxa líquida + tarifa do provedor = o que o cliente pagou.",
      }
    : null;

  const simpleLines = organizer
    ? [
        { label: "Ingressos vendidos", value: money(organizer.ticketsSoldCents), emphasis: false },
        { label: `Estornos (${organizer.refundedOrders} ${organizer.refundedOrders === 1 ? "pedido" : "pedidos"})`, value: `− ${money(organizer.refundedCents)}`, emphasis: false },
        { label: "Você recebe", value: money(organizer.youReceiveCents), emphasis: true },
        { label: "Taxa de serviço (paga pelo cliente)", value: money(organizer.serviceFeeCents), emphasis: false },
        { label: "O cliente pagou", value: money(organizer.clientPaidCents), emphasis: true },
      ]
    : [];

  const refundRows: { label: string; value: string }[] = [];
  if (admin) {
    refundRows.push({
      label: "Estornos concluídos",
      value: `${admin.refundedOrders} ${admin.refundedOrders === 1 ? "pedido" : "pedidos"} · o cliente recebeu ${money(admin.refundedClientCents)}`,
    });
    refundRows.push({
      label: "Parte do organizador que saiu",
      value: money(admin.organizerRefundedCents),
    });
    refundRows.push({
      label: "Taxa de serviço que saiu",
      value: money(admin.refundedFeeCents),
    });
    refundRows.push({
      label: "Tarifa do provedor que ficou",
      value: money(admin.providerFeeOnRefundsCents),
    });
    if (scope.refundsOpen > 0) {
      refundRows.push({ label: "Estornos em andamento", value: String(scope.refundsOpen) });
    }
    if (admin.contestedOrders > 0) {
      refundRows.push({
        label: "Contestações de cartão",
        value: `${admin.contestedOrders} · ${money(admin.contestedCents)} saíram das contas`,
      });
    }
  } else if (organizer) {
    refundRows.push({
      label: "Estornos",
      value: `${organizer.refundedOrders} ${organizer.refundedOrders === 1 ? "pedido" : "pedidos"} · − ${money(organizer.refundedCents)} da sua parte`,
    });
    if (organizer.contestedOrders > 0) {
      refundRows.push({
        label: "Contestações de cartão",
        value: `${organizer.contestedOrders} · ${money(organizer.contestedCents)} saíram da sua parte`,
      });
    }
  } else {
    refundRows.push({ label: "Estornos concluídos", value: `${scope.refundsDone} ${scope.refundsDone === 1 ? "pedido" : "pedidos"}` });
    if (scope.refundsOpen > 0) refundRows.push({ label: "Em andamento", value: String(scope.refundsOpen) });
    refundRows.push({ label: "Ingressos cancelados", value: String(scope.cancelledTickets) });
    refundRows.push({ label: "Ingressos estornados", value: String(scope.refundedTickets) });
  }

  return {
    money: input.money,
    stateKind: state.kind,
    stateLabel: state.label,
    stateDetail: state.detail,
    cards,
    sessions: blocks,
    types,
    typeTotal: valid,
    typeNote: unitNotes.length ? unitNotes.join(" · ") : null,
    payments,
    paymentTotal: payments ? payments.reduce((total, row) => total + row.count, 0) : 0,
    daily: dailySource,
    dailyIsMoney: input.money !== "none",
    dailyNote:
      input.money === "none"
        ? "Ingressos válidos por dia, no horário de Brasília."
        : "Receita dos ingressos por dia. A linha é o acumulado e termina no valor do organizador.",
    arrival: arrivalSessions.map((session) => ({
      title: sessionTitle(session, input.sessionLabels.get(session.id) ?? ""),
      buckets: session.arrival.map((bucket) => ({ label: clockLabel(bucket.label), count: bucket.count })),
    })),
    doorPresent: scope.present,
    doorExpected: valid,
    doorPercent: valid > 0 ? Math.round((scope.present / valid) * 100) : 0,
    noShowLabel,
    meiaSold: scope.buckets.meia,
    meiaOk: scope.meia.ok,
    meiaDiff: scope.meia.diff,
    meiaRefused: scope.meia.refused,
    meiaUnmarked: scope.meia.unmarked,
    pendingTotal,
    pendingHint:
      scope.heldTickets > 0
        ? `${scope.heldTickets} ${scope.heldTickets === 1 ? "ingresso ainda segura" : "ingressos ainda seguram"} vaga por 15 min`
        : "Reservas expiradas não seguram vaga.",
    pendingMoney,
    showSplit: Boolean(split),
    split,
    financeCloses,
    simpleLines,
    simpleNote: organizer
      ? "A taxa de serviço não sai da sua parte. O repasse é por PIX em até 5 dias úteis depois do evento."
      : null,
    refundRows,
    refundMode: admin ? "full" : organizer ? "simple" : "count",
    scopedNote: scoped
      ? "Lotação, portaria e pendentes são desta sessão. O dinheiro do evento continua o total."
      : null,
  };
}
