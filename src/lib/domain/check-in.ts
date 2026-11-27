import { formatSessionShort, formatSessionTime } from "@/lib/datetime";
import { sessionName, wrongSessionMessage } from "@/lib/domain/sessions";

export type CheckInRejectionReason =
  | "evento_errado"
  | "sessao_errada"
  | "sessao_cancelada"
  | "nao_encontrado"
  | "nao_pago"
  | "cancelado"
  | "estornado"
  | "ja_usado"
  | "invalido";

export type OtherSession = {
  name?: string | null;
  startsAt?: string | null;
};

export function checkInMessage(
  reason: CheckInRejectionReason,
  otherEventName?: string | null,
  otherSession?: OtherSession,
): string {
  if (reason === "evento_errado") {
    const name = otherEventName?.trim();
    return name ? `Ingresso de outro evento: ${name}` : "Ingresso de outro evento";
  }
  if (reason === "sessao_errada") {
    return wrongSessionMessage(otherSession?.name ?? null, otherSession?.startsAt ?? null);
  }

  const messages: Record<
    Exclude<CheckInRejectionReason, "evento_errado" | "sessao_errada">,
    string
  > = {
    sessao_cancelada: "Sessão cancelada — não liberar entrada",
    nao_encontrado: "Ingresso não encontrado",
    nao_pago: "Ingresso não pago",
    cancelado: "Cancelado",
    estornado: "Estornado — não liberar entrada",
    ja_usado: "Já utilizado",
    invalido: "Ingresso inválido — não liberar entrada",
  };

  return messages[reason];
}

/** Linha do "Pode entrar": "Sessão infantil · sáb, 10/10 · 16h00 · Evento" (nome só se existir). */
export function checkInSessionLine(
  name: string | null | undefined,
  startsAt: string | null | undefined,
  eventName: string | null | undefined,
): string {
  return [sessionName(name), formatSessionShort(startsAt), eventName?.trim()]
    .filter(Boolean)
    .join(" · ");
}

const KNOWN_REJECTIONS: Record<string, CheckInRejectionReason> = {
  evento_errado: "evento_errado",
  sessao_errada: "sessao_errada",
  sessao_cancelada: "sessao_cancelada",
  nao_encontrado: "nao_encontrado",
  nao_pago: "nao_pago",
  cancelado: "cancelado",
  estornado: "estornado",
  ja_usado: "ja_usado",
};

/** Resultado de `check_in_ticket`: só "ok" libera; qualquer outro valor é recusado. */
export function parseCheckInOutcome(
  outcome: unknown,
): { ok: true } | { ok: false; reason: CheckInRejectionReason } {
  if (outcome === "ok") return { ok: true };
  return {
    ok: false,
    reason:
      typeof outcome === "string" && Object.hasOwn(KNOWN_REJECTIONS, outcome)
        ? KNOWN_REJECTIONS[outcome]
        : "invalido",
  };
}

// ---------------------------------------------------------------------------------------
// Detalhes da leitura (portaria): pedido do ingresso lido e contador da sessão.
// Tudo aqui é puro (sem banco) e serve tanto à rota quanto às telas.

export type CheckInTicketKind = "inteira" | "meia" | "cortesia";

/** Um ingresso do mesmo pedido, como a portaria vê: tipo e se já entrou (com horário). */
export type CheckInOrderTicket = {
  typeLabel: string;
  kind: CheckInTicketKind;
  entered: boolean;
  /** Horário da entrada no fuso do evento ("17h04"), ou null se ainda não entrou. */
  enteredAt: string | null;
  /** É o ingresso que acabou de ser lido. */
  current: boolean;
};

export type CheckInOrderSummary = {
  total: number;
  entered: number;
  tickets: CheckInOrderTicket[];
};

export type CheckInOrderRow = {
  id: string;
  kind: CheckInTicketKind;
  status: string;
  checkedInAt: string | null;
  typeLabel: string;
};

/** Resume os ingressos válidos (pago ou com entrada) do pedido; os demais ficam de fora. */
export function buildOrderSummary(
  rows: CheckInOrderRow[],
  currentTicketId: string,
): CheckInOrderSummary {
  const tickets = rows
    .filter((row) => row.status === "pago" || row.status === "check_in")
    .map((row) => {
      const entered = row.status === "check_in";
      return {
        typeLabel: row.typeLabel,
        kind: row.kind,
        entered,
        enteredAt: entered ? formatSessionTime(row.checkedInAt) || null : null,
        current: row.id === currentTicketId,
      };
    });
  return {
    total: tickets.length,
    entered: tickets.filter((ticket) => ticket.entered).length,
    tickets,
  };
}

/** "Pedido com 3 ingressos · 1 já entrou". */
export function orderSummaryLine(summary: Pick<CheckInOrderSummary, "total" | "entered">): string {
  const total = `Pedido com ${summary.total} ${summary.total === 1 ? "ingresso" : "ingressos"}`;
  const entered =
    summary.entered === 1 ? "1 já entrou" : `${summary.entered} já entraram`;
  return `${total} · ${entered}`;
}

/** "Entrou às 17h12 · validado por Ana" (partes que faltarem ficam de fora). */
export function usedByLine(
  checkedInAt: string | null | undefined,
  validatedBy: string | null | undefined,
): string {
  const time = formatSessionTime(checkedInAt);
  return [time ? `Entrou às ${time}` : null, validatedBy?.trim() ? `validado por ${validatedBy.trim()}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Cor da tela depois da leitura: meia fica amarela (conferir comprovante antes de liberar). */
export function successTone(kind: CheckInTicketKind | null | undefined): "success" | "meia" {
  return kind === "meia" ? "meia" : "success";
}

export type CheckInCounts = {
  present: number;
  sold: number;
  capacity: number | null;
  meiaPresent: number;
  meiaSold: number;
};

/** Contador da sessão: só ingressos válidos (pago ou com entrada) contam como vendidos. */
export function checkInCounts(
  tickets: { kind: string; status: string }[],
  capacity: number | null | undefined,
): CheckInCounts {
  let present = 0;
  let sold = 0;
  let meiaPresent = 0;
  let meiaSold = 0;
  for (const ticket of tickets) {
    if (ticket.status !== "pago" && ticket.status !== "check_in") continue;
    const entered = ticket.status === "check_in";
    sold += 1;
    if (entered) present += 1;
    if (ticket.kind === "meia") {
      meiaSold += 1;
      if (entered) meiaPresent += 1;
    }
  }
  return {
    present,
    sold,
    capacity: typeof capacity === "number" && capacity > 0 ? capacity : null,
    meiaPresent,
    meiaSold,
  };
}

// ---------------------------------------------------------------------------------------
// Entrada pela lista de participantes (sem QR).

/** Busca da lista: nome ou e-mail, sem diferenciar maiúsculas nem acentos. */
export function ticketMatchesSearch(
  ticket: { buyerName: string; buyerEmail: string },
  term: string,
): boolean {
  const normalize = (text: string) =>
    text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  const clean = normalize(term.trim());
  if (!clean) return true;
  return normalize(ticket.buyerName).includes(clean) || normalize(ticket.buyerEmail).includes(clean);
}

/** Texto da confirmação antes de dar entrada manual. */
export function manualCheckInPrompt(ticket: {
  buyerName: string;
  typeLabel: string;
  kind: CheckInTicketKind;
  sessionLabel?: string | null;
}): string {
  const lines = [
    `Dar entrada para ${ticket.buyerName}?`,
    `Ingresso: ${ticket.typeLabel}`,
    ticket.sessionLabel ? `Sessão: ${ticket.sessionLabel}` : null,
    ticket.kind === "meia"
      ? "MEIA: confira o comprovante e um documento com foto antes de liberar."
      : "Confira um documento com foto antes de liberar.",
    "A entrada fica registrada e não dá para desfazer.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Mensagem depois da entrada manual, a partir da resposta da rota. */
export function manualCheckInResult(
  data:
    | { ok: true; buyerName: string; kind: CheckInTicketKind | null; typeLabel?: string; order?: Pick<CheckInOrderSummary, "total" | "entered"> }
    | { ok: false; message: string; usedLine?: string },
): { ok: boolean; text: string } {
  if (!data.ok) {
    return { ok: false, text: data.usedLine ? `${data.message} · ${data.usedLine}` : data.message };
  }
  const parts = [
    `Entrada registrada: ${data.buyerName}${data.typeLabel ? ` · ${data.typeLabel}` : ""}.`,
    data.kind === "meia" ? "Meia: conferir comprovante." : null,
    data.order && data.order.total > 1 ? `${orderSummaryLine(data.order)}.` : null,
  ];
  return { ok: true, text: parts.filter(Boolean).join(" ") };
}
