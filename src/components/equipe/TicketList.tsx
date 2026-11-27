"use client";

import { ExternalLink, LogIn, SearchX, Ticket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useMemo, useState, useTransition } from "react";

import {
  cancelTicket,
  issueCourtesy,
} from "@/app/equipe/eventos/actions";
import { resendOrderTickets } from "@/app/equipe/eventos/order-actions";
import {
  RefundOrderButton,
  type RefundOrderSummary,
} from "@/components/equipe/RefundOrderButton";
import { ResendTicketsControl } from "@/components/tickets/ResendTicketsControl";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { controlClasses, Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import { eventDateFormatter } from "@/lib/datetime";
import {
  COURTESY_PROVIDER,
  refundBlock,
  refundBlockMessage,
} from "@/lib/domain/refund";
import { MeiaCheckButtons, type MeiaPanelState } from "@/components/equipe/MeiaCheckButtons";
import { MeiaCheckSummary } from "@/components/equipe/MeiaCheckSummary";
import { MeiaRefuseDialog } from "@/components/equipe/MeiaRefuseDialog";
import {
  manualCheckInPrompt,
  manualCheckInResult,
  ticketMatchesSearch,
} from "@/lib/domain/check-in";
import {
  MEIA_REFUSE_CONFIRM,
  meiaRefuseSecondConfirm,
  MEIA_RESULT_LABELS,
  MEIA_RESULTS,
  MEIA_SKIP_CONFIRM,
  meiaBadge,
  type MeiaCheckState,
  type MeiaResult,
  type MeiaSummary,
} from "@/lib/domain/meia-check";
import { decisionLabel } from "@/lib/domain/status";
import type { Enums } from "@/types/database";

export type TicketListItem = {
  id: string;
  orderId: string;
  orderTotalCents: number;
  paymentProvider: string | null;
  buyerName: string;
  buyerEmail: string;
  kind: Enums<"ticket_kind">;
  /** Nome do tipo com a categoria, ex.: "Casadinha — Inteira". */
  typeLabel: string;
  status: Enums<"ticket_status">;
  orderStatus: Enums<"order_status">;
  decisionReason: string | null;
  priceCents: number;
  paidAt: string | null;
  /** Pago nas últimas 24 h (calculado no servidor). */
  recentlyPaid: boolean;
  checkedInAt: string | null;
  publicToken: string;
  /** Sessão do ingresso, mostrada na aba "Todas" de evento com várias sessões. */
  sessionLabel?: string | null;
  /** Motivo do pedido de estorno pendente feito pelo organizador do evento. */
  refundRequestReason?: string | null;
  /** Sessão do ingresso: com ela aparece "Dar entrada" (mesma função do leitor de QR). */
  sessionId?: string | null;
  /** Sessão por extenso, mostrada na confirmação de "Dar entrada". */
  entrySessionLabel?: string | null;
  /** Última conferência da meia (comprovante ok / pagou a diferença / recusado). */
  meiaCheck?: MeiaCheckState | null;
};

type SectionProps = {
  id?: string;
  className?: string;
};

const statusLabels: Record<Enums<"ticket_status">, string> = {
  nao_pago: "Não pago",
  pago: "Pago",
  cancelado: "Cancelado",
  check_in: "Check-in",
  estornado: "Estornado",
};

const statusTones: Record<Enums<"ticket_status">, Tone> = {
  pago: "success",
  check_in: "info",
  nao_pago: "neutral",
  cancelado: "neutral",
  estornado: "neutral",
};

/** Pedido aguardando decisão aparece pelo estado do pedido, não do ingresso (ainda não pago). */
function statusBadge(ticket: TicketListItem): { label: string; tone: Tone } {
  if (ticket.orderStatus === "aguardando_decisao") {
    return { label: decisionLabel(ticket.decisionReason), tone: "warning" };
  }
  return { label: statusLabels[ticket.status], tone: statusTones[ticket.status] };
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDate(value: string | null) {
  if (!value) return "—";

  return eventDateFormatter({
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

type OrderRefundInfo = {
  summary: RefundOrderSummary;
  hasCheckIn: boolean;
};

/** Agrupa os ingressos por pedido: o estorno é sempre do pedido inteiro. */
function groupOrders(tickets: TicketListItem[]): Map<string, OrderRefundInfo> {
  const orders = new Map<string, OrderRefundInfo>();
  for (const ticket of tickets) {
    const info = orders.get(ticket.orderId) ?? {
      summary: {
        orderId: ticket.orderId,
        buyerName: ticket.buyerName,
        totalCents: ticket.orderTotalCents,
        ticketLabels: [],
      },
      hasCheckIn: false,
    };
    if (ticket.status === "check_in") info.hasCheckIn = true;
    if (ticket.status === "pago" || ticket.status === "nao_pago" || ticket.status === "cancelado") {
      info.summary.ticketLabels.push(`${ticket.typeLabel} — ${ticket.buyerName}`);
    }
    orders.set(ticket.orderId, info);
  }
  return orders;
}

export type CourtesySession = { id: string; label: string; remaining: number };

export function CourtesyForm({
  eventId,
  remaining,
  sessions = [],
  defaultSessionId,
  id,
  className,
}: SectionProps & {
  eventId: string;
  remaining: number;
  /** Sessões ativas; com mais de uma, a equipe escolhe a sessão da cortesia. */
  sessions?: CourtesySession[];
  defaultSessionId?: string | null;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastTicketUrl, setLastTicketUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const askSession = sessions.length > 1;
  const [chosenSessionId, setChosenSessionId] = useState(defaultSessionId ?? "");
  const chosen = sessions.find((session) => session.id === chosenSessionId) ?? null;
  const sessionId = askSession ? (chosen?.id ?? null) : (sessions[0]?.id ?? null);
  const available = askSession ? (chosen?.remaining ?? null) : remaining;
  const soldOut = available === 0;

  function submitCourtesy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (askSession && !sessionId) {
      setMessage({ ok: false, text: "Escolha a sessão da cortesia." });
      return;
    }

    startTransition(async () => {
      try {
        const result = await issueCourtesy({
          eventId,
          name: String(formData.get("name") ?? ""),
          email: String(formData.get("email") ?? ""),
          ...(sessionId ? { sessionId } : {}),
        });
        if (!result.ok) {
          setLastTicketUrl(null);
          setMessage({ ok: false, text: result.error });
          return;
        }
        form.reset();
        setLastTicketUrl(`/pedidos/${result.data.publicToken}`);
        setMessage({ ok: true, text: "Cortesia emitida com sucesso. Abra o ingresso abaixo." });
      } catch {
        setLastTicketUrl(null);
        setMessage({ ok: false, text: "Não foi possível emitir." });
      }
    });
  }

  return (
    <section aria-labelledby="cortesia-titulo" className={className} id={id}>
      <h2 className="text-xl font-semibold text-foreground" id="cortesia-titulo">
        Emitir cortesia
      </h2>
      <p className="mt-1 text-base text-byla-muted">
        {available === null
          ? "Escolha a sessão para ver as vagas."
          : `${available} ${available === 1 ? "vaga disponível" : "vagas disponíveis"}${askSession ? " nesta sessão" : ""}`}
      </p>
      <form
        className="mt-3 grid gap-4 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-5"
        onSubmit={submitCourtesy}
      >
        {askSession ? (
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Sessão
            <select
              className={cx(controlClasses, "min-h-12")}
              disabled={isPending}
              name="sessionId"
              onChange={(change) => setChosenSessionId(change.target.value)}
              required
              value={chosenSessionId}
            >
              <option value="">Escolha a sessão</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                  {session.remaining === 0 ? " — sem vagas" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Field
          autoComplete="off"
          disabled={isPending || soldOut}
          label="Nome"
          name="name"
          required
        />
        <Field
          autoCapitalize="none"
          autoComplete="off"
          disabled={isPending || soldOut}
          inputMode="email"
          label="E-mail"
          name="email"
          required
          spellCheck={false}
          type="email"
        />
        <Button
          disabled={soldOut}
          fullWidth
          loading={isPending}
          loadingLabel="Emitindo..."
          type="submit"
        >
          Emitir cortesia
        </Button>
        {message ? (
          <Notice tone={message.ok ? "success" : "danger"}>{message.text}</Notice>
        ) : null}
        {lastTicketUrl ? (
          <ButtonLink fullWidth href={lastTicketUrl} target="_blank" variant="secondary">
            Abrir ingresso (QR)
            <ExternalLink aria-hidden className="h-4 w-4" />
          </ButtonLink>
        ) : null}
      </form>
    </section>
  );
}

export function TicketList({
  eventId,
  tickets,
  id,
  className,
  meiaChecksEnabled = false,
  meiaSummary = null,
}: SectionProps & {
  eventId: string;
  tickets: TicketListItem[];
  /** Banco com a conferência de meia: mostra o status e os botões de conferência. */
  meiaChecksEnabled?: boolean;
  meiaSummary?: MeiaSummary | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [listMessage, setListMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [meiaFeature, setMeiaFeature] = useState(meiaChecksEnabled);
  const [markingId, setMarkingId] = useState<string | null>(null);
  /** Meia que acabou de entrar pela lista: conferência em destaque até marcar. */
  const [pendingMeia, setPendingMeia] = useState<{ ticket: TicketListItem; state: MeiaPanelState } | null>(null);
  const [refuseTicket, setRefuseTicket] = useState<TicketListItem | null>(null);
  const closeRefuse = useCallback(() => setRefuseTicket(null), []);

  const filteredTickets = useMemo(() => {
    if (!search.trim()) return tickets;
    return tickets.filter((ticket) => ticketMatchesSearch(ticket, search));
  }, [search, tickets]);

  const orders = useMemo(() => groupOrders(tickets), [tickets]);
  /** O botão de estorno aparece só na primeira linha visível de cada pedido. */
  const firstRowOfOrder = useMemo(() => {
    const seen = new Set<string>();
    const first = new Set<string>();
    for (const ticket of filteredTickets) {
      if (seen.has(ticket.orderId)) continue;
      seen.add(ticket.orderId);
      first.add(ticket.id);
    }
    return first;
  }, [filteredTickets]);

  const recentCount = tickets.filter(({ recentlyPaid }) => recentlyPaid).length;

  function requestCancellation(ticket: TicketListItem) {
    if (
      !window.confirm(
        `Tem certeza que deseja cancelar a cortesia de ${ticket.buyerName}?`,
      )
    ) {
      return;
    }

    setListMessage(null);
    startTransition(async () => {
      try {
        const result = await cancelTicket(eventId, ticket.id);
        setListMessage(
          result.ok
            ? { text: "Cortesia cancelada. A vaga foi liberada.", ok: true }
            : { text: result.error, ok: false },
        );
      } catch {
        setListMessage({ text: "Não foi possível cancelar.", ok: false });
      }
    });
  }

  /** Entrada sem QR: confirma e usa a mesma rota/função do leitor (mesmas regras e trava). */
  async function requestCheckIn(ticket: TicketListItem) {
    if (!ticket.sessionId || checkingInId) return;
    if (
      !window.confirm(
        manualCheckInPrompt({
          buyerName: ticket.buyerName,
          typeLabel: ticket.typeLabel,
          kind: ticket.kind,
          sessionLabel: ticket.entrySessionLabel ?? ticket.sessionLabel,
        }),
      )
    ) {
      return;
    }

    setListMessage(null);
    setCheckingInId(ticket.id);
    try {
      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, sessionId: ticket.sessionId, ticketId: ticket.id }),
      });
      const data = await response.json();
      setListMessage(manualCheckInResult(data));
      if (data?.ok && ticket.kind === "meia" && meiaFeature) {
        setPendingMeia({
          ticket,
          state: {
            enabled: true,
            mark: null,
            busy: false,
            error: null,
            diffCents: typeof data.meiaDiffCents === "number" ? data.meiaDiffCents : null,
          },
        });
      }
      router.refresh();
    } catch {
      setListMessage({ text: "Falha de conexão. Tente novamente.", ok: false });
    } finally {
      setCheckingInId(null);
    }
  }

  /** Conferência da meia (lista ou painel em destaque), pela rota com a sessão do usuário. */
  /** "Recusado" pede duas confirmações: o confirm do navegador e o diálogo explicativo. */
  function markMeia(ticket: TicketListItem, mark: MeiaResult) {
    if (markingId) return;
    if (mark === "recusado") {
      if (!window.confirm(MEIA_REFUSE_CONFIRM)) return;
      setRefuseTicket(ticket);
      return;
    }
    void sendMeiaMark(ticket, mark);
  }

  async function sendMeiaMark(ticket: TicketListItem, mark: MeiaResult) {
    if (markingId) return;
    const fromPanel = pendingMeia?.ticket.id === ticket.id;
    setMarkingId(ticket.id);
    if (fromPanel) setPendingMeia((p) => (p ? { ...p, state: { ...p.state, busy: true, error: null } } : p));
    try {
      const response = await fetch("/api/check-in/meia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, ticketId: ticket.id, result: mark }),
      });
      const data = await response.json();
      if (data?.ok) {
        setListMessage({
          ok: mark !== "recusado",
          text:
            mark === "recusado"
              ? `Meia de ${ticket.buyerName} recusada: a entrada foi desfeita.`
              : `Conferência registrada: ${ticket.buyerName} · ${MEIA_RESULT_LABELS[mark]}.`,
        });
        if (fromPanel) {
          setPendingMeia((p) =>
            p ? { ...p, state: { ...p.state, busy: false, error: null, mark, diffCents: data.diffCents ?? p.state.diffCents } } : p,
          );
        }
        router.refresh();
      } else {
        if (data?.unavailable) {
          setMeiaFeature(false);
          setPendingMeia(null);
        }
        const text = typeof data?.message === "string" ? data.message : "Não foi possível registrar a conferência.";
        setListMessage({ ok: false, text });
        if (fromPanel) setPendingMeia((p) => (p ? { ...p, state: { ...p.state, busy: false, error: text } } : p));
      }
    } catch {
      setListMessage({ ok: false, text: "Falha de conexão. Tente de novo." });
      if (fromPanel) setPendingMeia((p) => (p ? { ...p, state: { ...p.state, busy: false } } : p));
    } finally {
      setMarkingId(null);
    }
  }

  function closePendingMeia() {
    if (pendingMeia && pendingMeia.state.mark === null && !window.confirm(MEIA_SKIP_CONFIRM)) return;
    setPendingMeia(null);
  }

  function actionsFor(ticket: TicketListItem, inCard = false) {
    return (
      <TicketActions
        checkingIn={checkingInId === ticket.id}
        checkInBusy={checkingInId !== null}
        hideWhenEmpty={inCard}
        isFirstRowOfOrder={firstRowOfOrder.has(ticket.id)}
        isPending={isPending}
        onCancel={() => requestCancellation(ticket)}
        meiaEnabled={meiaFeature}
        meiaBusy={markingId !== null}
        onCheckIn={() => void requestCheckIn(ticket)}
        onMeiaMark={(mark) => markMeia(ticket, mark)}
        onRefundDone={(message, ok = true) => setListMessage({ text: message, ok })}
        order={orders.get(ticket.orderId)}
        ticket={ticket}
      />
    );
  }

  return (
    <section aria-labelledby="participantes-titulo" className={className} id={id}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground" id="participantes-titulo">
            Participantes
          </h2>
          <p className="mt-1 text-base text-byla-muted">
            {tickets.length} {tickets.length === 1 ? "ingresso" : "ingressos"}
            {recentCount > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-byla-accent-text">
                  {recentCount} {recentCount === 1 ? "pago" : "pagos"} nas
                  últimas 24 h
                </span>
              </>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm text-byla-muted">
            A lista atualiza sozinha a cada 30 segundos.
          </p>
        </div>
        {tickets.length ? (
          <Field
            label="Buscar por nome ou e-mail"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome ou e-mail"
            type="search"
            value={search}
            wrapperClassName="w-full sm:w-72"
          />
        ) : null}
      </div>

      {meiaFeature && meiaSummary ? <MeiaCheckSummary className="mt-4" summary={meiaSummary} /> : null}

      {listMessage ? (
        <Notice className="mt-4" tone={listMessage.ok ? "success" : "danger"}>
          {listMessage.text}
        </Notice>
      ) : null}

      {refuseTicket ? (
        <MeiaRefuseDialog
          onBack={closeRefuse}
          onConfirm={() => {
            const ticket = refuseTicket;
            setRefuseTicket(null);
            void sendMeiaMark(ticket, "recusado");
          }}
          prompt={meiaRefuseSecondConfirm({
            buyerName: refuseTicket.buyerName,
            sessionLabel: refuseTicket.entrySessionLabel ?? refuseTicket.sessionLabel ?? null,
            diffCents:
              pendingMeia?.ticket.id === refuseTicket.id
                ? pendingMeia.state.diffCents
                : (refuseTicket.meiaCheck?.diffCents ?? null),
          })}
        />
      ) : null}

      {pendingMeia ? (
        <div
          aria-label="Conferência da meia"
          className={cx(
            "mt-4 grid gap-3 rounded-2xl p-4",
            pendingMeia.state.mark === "recusado"
              ? "bg-byla-danger-solid text-white"
              : pendingMeia.state.mark
                ? "bg-byla-success-solid text-white"
                : "bg-[#ffbd38] text-black",
          )}
          role="region"
        >
          <p className="text-lg font-black uppercase">
            {pendingMeia.state.mark === "recusado"
              ? "Meia recusada · entrada desfeita"
              : pendingMeia.state.mark
                ? "Conferência registrada"
                : "Meia – conferir comprovante"}
          </p>
          <p className="text-2xl font-bold">{pendingMeia.ticket.buyerName}</p>
          {pendingMeia.state.mark === "recusado" ? (
            <p className="text-base">Se ela voltar com o comprovante, use “Dar entrada” de novo.</p>
          ) : (
            <MeiaCheckButtons
              onMark={(mark) => markMeia(pendingMeia.ticket, mark)}
              state={pendingMeia.state}
              surface={pendingMeia.state.mark ? "dark" : "light"}
            />
          )}
          <button
            className="min-h-11 justify-self-start rounded-lg px-3 text-base font-semibold underline"
            onClick={closePendingMeia}
            type="button"
          >
            Fechar
          </button>
        </div>
      ) : null}

      {tickets.length === 0 ? (
        <EmptyState
          className="mt-4"
          description="Os ingressos vendidos e as cortesias aparecem aqui."
          icon={Ticket}
          title="Nenhum ingresso ainda."
        />
      ) : filteredTickets.length === 0 ? (
        <EmptyState
          className="mt-4"
          description="Confira o nome ou e-mail digitado na busca."
          icon={SearchX}
          title="Nenhum ingresso encontrado."
        />
      ) : (
        <>
          <ul className="mt-4 grid gap-3 md:hidden">
            {filteredTickets.map((ticket) => (
              <li
                className={cx(
                  "rounded-2xl border bg-byla-surface p-4",
                  ticket.recentlyPaid ? "border-byla-success/50" : "border-byla-border",
                )}
                key={ticket.id}
              >
                <p className="break-words text-base font-semibold text-foreground">
                  {ticket.buyerName}
                </p>
                <p className="break-all text-sm text-byla-muted">{ticket.buyerEmail}</p>
                <TicketBadges
                  className="mt-2"
                  showRefundRequest={firstRowOfOrder.has(ticket.id)}
                  ticket={ticket}
                />
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  {ticket.sessionLabel ? (
                    <CardDetail className="col-span-2" label="Sessão" value={ticket.sessionLabel} />
                  ) : null}
                  <CardDetail label="Tipo" value={ticket.typeLabel} />
                  <CardDetail label="Valor" value={currency.format(ticket.priceCents / 100)} />
                  <CardDetail label="Pagamento" value={formatDate(ticket.paidAt)} />
                  <CardDetail label="Check-in" value={formatDate(ticket.checkedInAt)} />
                </dl>
                <div className="mt-2 border-t border-byla-border pt-2 empty:hidden">
                  {actionsFor(ticket, true)}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-byla-border bg-byla-surface md:block">
            <table className="w-full min-w-[40rem] text-left text-base">
              <thead className="border-b border-byla-border text-sm text-byla-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Participante</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map((ticket) => (
                  <tr
                    className={cx(
                      "border-b border-byla-border align-top last:border-b-0",
                      ticket.recentlyPaid && "bg-byla-success-bg/40",
                    )}
                    key={ticket.id}
                  >
                    <td className="max-w-56 px-4 py-3">
                      <span className="block break-words font-medium">{ticket.buyerName}</span>
                      <span
                        className="block truncate text-sm text-byla-muted"
                        title={ticket.buyerEmail}
                      >
                        {ticket.buyerEmail}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ticket.sessionLabel ? (
                        <span className="block text-sm font-medium">{ticket.sessionLabel}</span>
                      ) : null}
                      <span className="block">{ticket.typeLabel}</span>
                      <span className="block text-sm text-byla-muted">
                        {currency.format(ticket.priceCents / 100)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <TicketBadges showRefundRequest={firstRowOfOrder.has(ticket.id)} ticket={ticket} />
                      <span className="mt-1 block whitespace-nowrap text-sm">
                        Pago: {formatDate(ticket.paidAt)}
                      </span>
                      <span className="block whitespace-nowrap text-sm text-byla-muted">
                        Entrada: {formatDate(ticket.checkedInAt)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{actionsFor(ticket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TicketBadges({
  ticket,
  showRefundRequest,
  className,
}: {
  ticket: TicketListItem;
  /** O pedido de estorno é do pedido inteiro: selo só na primeira linha do pedido. */
  showRefundRequest: boolean;
  className?: string;
}) {
  const badge = statusBadge(ticket);
  const meia = ticket.meiaCheck !== undefined ? meiaBadge(ticket, ticket.meiaCheck) : null;
  return (
    <span className={cx("flex flex-wrap items-center gap-1.5", className)}>
      <StatusBadge
        className={ticket.status === "estornado" ? "line-through" : undefined}
        tone={badge.tone}
      >
        {badge.label}
      </StatusBadge>
      {ticket.recentlyPaid ? (
        <span
          className="inline-flex rounded-full bg-byla-yellow px-2.5 py-0.5 text-sm font-bold text-black"
          title="Pago nas últimas 24 horas"
        >
          Novo
        </span>
      ) : null}
      {meia ? (
        <StatusBadge className="whitespace-normal text-left" tone={meia.tone}>
          {meia.label}
        </StatusBadge>
      ) : null}
      {showRefundRequest && ticket.refundRequestReason ? (
        <StatusBadge className="whitespace-normal break-words text-left" tone="warning">
          Estorno pedido pelo organizador: {ticket.refundRequestReason}
        </StatusBadge>
      ) : null}
    </span>
  );
}

function CardDetail({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <dt className="text-sm text-byla-muted">{label}</dt>
      <dd className="break-words text-base text-foreground">{value}</dd>
    </div>
  );
}

const actionLinkClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg font-medium no-underline transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:cursor-not-allowed disabled:opacity-50";

function TicketActions({
  ticket,
  order,
  isFirstRowOfOrder,
  isPending,
  hideWhenEmpty,
  checkingIn,
  checkInBusy,
  meiaEnabled,
  meiaBusy,
  onCancel,
  onCheckIn,
  onMeiaMark,
  onRefundDone,
}: {
  hideWhenEmpty: boolean;
  checkingIn: boolean;
  checkInBusy: boolean;
  meiaEnabled: boolean;
  meiaBusy: boolean;
  onCheckIn: () => void;
  onMeiaMark: (mark: MeiaResult) => void;
  ticket: TicketListItem;
  order: OrderRefundInfo | undefined;
  isFirstRowOfOrder: boolean;
  isPending: boolean;
  onCancel: () => void;
  onRefundDone: (message: string, ok?: boolean) => void;
}) {
  const valid = ticket.status === "pago" || ticket.status === "check_in";
  const isCourtesy =
    ticket.kind === "cortesia" || ticket.paymentProvider === COURTESY_PROVIDER;
  const canCancel = isCourtesy && ticket.status === "pago";
  const showResend = ticket.orderStatus === "pago" && isFirstRowOfOrder;
  const showRefund =
    !isCourtesy && ticket.orderStatus === "pago" && valid && isFirstRowOfOrder && order;
  const block = order
    ? refundBlock({
        paymentProvider: ticket.paymentProvider,
        paidAt: ticket.paidAt,
        hasCheckIn: order.hasCheckIn,
      })
    : null;

  if (!valid && !showRefund && !showResend) {
    return hideWhenEmpty ? null : (
      <span className="inline-flex min-h-11 items-center text-byla-muted">—</span>
    );
  }

  const canCheckIn =
    ticket.status === "pago" && ticket.orderStatus === "pago" && Boolean(ticket.sessionId);

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 md:flex-col md:gap-1">
      {canCheckIn ? (
        <button
          className={cx(actionLinkClass, "text-left font-semibold text-byla-success")}
          disabled={checkInBusy}
          onClick={onCheckIn}
          type="button"
        >
          <LogIn aria-hidden className="h-4 w-4" />
          {checkingIn ? "Dando entrada..." : "Dar entrada"}
        </button>
      ) : null}
      {meiaEnabled && ticket.kind === "meia" && ticket.status === "check_in" ? (
        <div className="grid gap-0.5" role="group" aria-label={`Conferência da meia de ${ticket.buyerName}`}>
          <span className="text-sm text-byla-muted">Conferência da meia:</span>
          {MEIA_RESULTS.map((result) => {
            const selected = ticket.meiaCheck?.result === result;
            return (
              <button
                aria-pressed={selected}
                className={cx(
                  actionLinkClass,
                  "min-h-9 text-left",
                  result === "recusado" ? "text-byla-danger" : "text-byla-link",
                  selected && "font-bold underline",
                )}
                disabled={meiaBusy || selected}
                key={result}
                onClick={() => onMeiaMark(result)}
                type="button"
              >
                {MEIA_RESULT_LABELS[result]}
                {selected ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      ) : null}
      {valid ? (
        <Link
          className={cx(actionLinkClass, "text-byla-link")}
          href={`/pedidos/${ticket.publicToken}`}
          target="_blank"
        >
          Abrir ingresso
          <ExternalLink aria-hidden className="h-4 w-4" />
        </Link>
      ) : null}
      {showResend ? (
        <ResendTicketsControl
          className={cx(actionLinkClass, "text-left text-byla-link")}
          orderId={ticket.orderId}
          send={resendOrderTickets}
          variant="link"
        />
      ) : null}
      {canCancel ? (
        <button
          className={cx(actionLinkClass, "text-left text-byla-danger")}
          disabled={isPending}
          onClick={onCancel}
          type="button"
        >
          Cancelar cortesia
        </button>
      ) : null}
      {showRefund ? (
        <RefundOrderButton
          blockedMessage={block ? refundBlockMessage(block) : null}
          onDone={onRefundDone}
          order={order.summary}
        />
      ) : null}
    </div>
  );
}
