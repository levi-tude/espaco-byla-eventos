/**
 * Regras do relatório do evento, iguais às funções do banco (`event_report*`).
 * Aqui só para exibir, filtrar e testar: a fonte dos números é o Postgres.
 *
 * Válido = ingresso `pago` ou `check_in`.
 * Lotação = válidos sem código de desbloqueio (capacitação fica de fora). Bônus conta.
 * Casadinha e família contam pessoas (cada ingresso), não a unidade vendida.
 * Dinheiro: organizador + taxa bruta = o que o cliente pagou;
 * taxa líquida = taxa bruta − tarifa do provedor.
 */

export const REPORT_BUCKETS = [
  "inteira",
  "casadinha",
  "familia",
  "meia",
  "bonus",
  "capacitacao",
] as const;

export type ReportBucket = (typeof REPORT_BUCKETS)[number];

export const BUCKET_LABEL: Record<ReportBucket, string> = {
  inteira: "Inteira",
  casadinha: "Casadinha",
  familia: "Família",
  meia: "Meia-entrada",
  bonus: "Bônus",
  capacitacao: "Capacitação",
};

/** Cores fixas da barra e da rosca (claras o bastante no tema escuro e na impressão). */
export const BUCKET_COLOR: Record<ReportBucket, string> = {
  inteira: "#4080FC",
  casadinha: "#7EB6FF",
  familia: "#2DD4BF",
  meia: "#FFBD38",
  bonus: "#4ADE80",
  capacitacao: "#C084FC",
};

export type ReportTicket = {
  status: string;
  kind: string;
  peoplePerUnit: number;
  preset: string | null;
  hasUnlockCode: boolean;
};

export function isValidTicketStatus(status: string): boolean {
  return status === "pago" || status === "check_in";
}

/** Capacitação (tipo com código) não ocupa lugar. Os outros válidos ocupam, inclusive bônus. */
export function countsTowardCapacity(ticket: ReportTicket): boolean {
  return isValidTicketStatus(ticket.status) && !ticket.hasUnlockCode;
}

export function reportBucket(ticket: ReportTicket): ReportBucket {
  if (ticket.hasUnlockCode) return "capacitacao";
  if (ticket.kind === "cortesia") return "bonus";
  if (ticket.kind === "meia") return "meia";
  if (ticket.preset === "familia" || ticket.peoplePerUnit >= 4) return "familia";
  if (ticket.preset === "casadinha" || ticket.peoplePerUnit > 1) return "casadinha";
  return "inteira";
}

export type PeopleSummary = {
  occupied: number;
  training: number;
  valid: number;
  buckets: Record<ReportBucket, number>;
};

function emptyBuckets(): Record<ReportBucket, number> {
  return { inteira: 0, casadinha: 0, familia: 0, meia: 0, bonus: 0, capacitacao: 0 };
}

/** Conta pessoas (um ingresso = uma pessoa), só entre os válidos. */
export function summarizePeople(tickets: readonly ReportTicket[]): PeopleSummary {
  const buckets = emptyBuckets();
  let occupied = 0;
  let training = 0;
  for (const ticket of tickets) {
    if (!isValidTicketStatus(ticket.status)) continue;
    const bucket = reportBucket(ticket);
    buckets[bucket] += 1;
    if (bucket === "capacitacao") training += 1;
    else occupied += 1;
  }
  return { occupied, training, valid: occupied + training, buckets };
}

/**
 * Unidades vendidas a partir dos itens do pedido (a mesma conta do banco:
 * pessoas do item ÷ pessoas por unidade, arredondando para cima).
 */
export function unitsSold(items: readonly { people: number; peoplePerUnit: number }[]): number {
  return items.reduce((total, item) => {
    const per = Math.max(1, Math.trunc(item.peoplePerUnit) || 1);
    const people = Math.max(0, Math.trunc(item.people) || 0);
    return total + Math.ceil(people / per);
  }, 0);
}

export function occupancyPercent(occupied: number, capacity: number): number {
  if (capacity <= 0 || occupied <= 0) return 0;
  return Math.round((occupied / capacity) * 100);
}

export function freeSeats(occupied: number, capacity: number): number {
  return Math.max(capacity - Math.max(0, occupied), 0);
}

/**
 * Falta só depois do fim da sessão ativa. Antes disso, ou sem horário de fim,
 * ou sessão cancelada: ainda não dá para contar.
 */
export function noShowCount(input: {
  notEntered: number;
  sessionStatus: string;
  endsAt: string | null;
  now: number;
}): number | null {
  if (input.sessionStatus !== "ativa" || !input.endsAt) return null;
  const end = Date.parse(input.endsAt);
  if (!Number.isFinite(end) || end > input.now) return null;
  return Math.max(0, Math.trunc(input.notEntered) || 0);
}

const arrivalClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Faixa de 10 minutos no horário de Brasília ("17:00"). */
export function arrivalBucketLabel(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(arrivalClock.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = parts.hour;
  const minute = Number(parts.minute);
  if (!hour || !Number.isFinite(minute)) return null;
  return `${hour}:${String(Math.floor(minute / 10) * 10).padStart(2, "0")}`;
}

export function arrivalBuckets(checkedInAt: readonly string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const iso of checkedInAt) {
    const label = arrivalBucketLabel(iso);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => ({ label, count }));
}

/** "17:00" → "17h00" para a tela. */
export function clockLabel(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return match ? `${match[1]}h${match[2]}` : hhmm;
}

export type FinanceParts = {
  /** Parte do organizador (ingressos que continuam válidos). */
  organizerCents: number;
  /** Taxa de serviço bruta, paga pelo cliente, dos pedidos que contam. */
  grossFeeCents: number;
  /** Tarifa do provedor, inclusive a que ficou em estorno. */
  providerFeeCents: number;
};

export type ClosedFinance = FinanceParts & {
  clientPaidCents: number;
  netFeeCents: number;
};

/** organizador + taxa bruta = cliente pagou; líquida = bruta − tarifa. */
export function closeFinance(parts: FinanceParts): ClosedFinance {
  const organizerCents = Math.trunc(parts.organizerCents) || 0;
  const grossFeeCents = Math.trunc(parts.grossFeeCents) || 0;
  const providerFeeCents = Math.trunc(parts.providerFeeCents) || 0;
  return {
    organizerCents,
    grossFeeCents,
    providerFeeCents,
    clientPaidCents: organizerCents + grossFeeCents,
    netFeeCents: grossFeeCents - providerFeeCents,
  };
}

/** Confere o que veio do banco com a conta que tem de fechar. */
export function reportedFinanceCloses(input: ClosedFinance): boolean {
  const closed = closeFinance(input);
  return (
    input.clientPaidCents === closed.clientPaidCents &&
    input.netFeeCents === closed.netFeeCents &&
    input.organizerCents + input.netFeeCents + input.providerFeeCents === input.clientPaidCents
  );
}

export function averageTicket(shareCents: number, payingOrders: number, payingPeople: number): {
  perOrderCents: number | null;
  perPersonCents: number | null;
} {
  const share = Math.trunc(shareCents) || 0;
  return {
    perOrderCents: payingOrders > 0 ? Math.round(share / payingOrders) : null,
    perPersonCents: payingPeople > 0 ? Math.round(share / payingPeople) : null,
  };
}

export type ReportStateKind = "ao_vivo" | "provisorio" | "encerrado";

export function reportState(input: {
  live: boolean;
  feesPending: number;
  refundsOpen: number;
  /** Só o admin vê o aviso de tarifa ainda não lida. */
  showFeePending: boolean;
}): { kind: ReportStateKind; label: string; detail: string } {
  if (input.live) {
    return {
      kind: "ao_vivo",
      label: "Ao vivo",
      detail: "Atualiza sozinho enquanto esta aba está aberta.",
    };
  }
  if (input.showFeePending && input.feesPending > 0) {
    return {
      kind: "provisorio",
      label: "Provisório",
      detail:
        input.feesPending === 1
          ? "Ainda falta ler a tarifa de 1 pedido. A taxa líquida pode mudar."
          : `Ainda falta ler a tarifa de ${input.feesPending} pedidos. A taxa líquida pode mudar.`,
    };
  }
  if (input.refundsOpen > 0) {
    return {
      kind: "provisorio",
      label: "Provisório",
      detail: "Há estorno em andamento. Os números podem mudar.",
    };
  }
  return {
    kind: "encerrado",
    label: "Encerrado",
    detail: "Depois do evento os números ainda mudam se entrar um estorno.",
  };
}
