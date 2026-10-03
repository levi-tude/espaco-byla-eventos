"use client";

import { ExternalLink, SearchX, Ticket } from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState, useTransition } from "react";

import {
  cancelTicket,
  issueCourtesy,
} from "@/app/equipe/eventos/actions";
import {
  RefundOrderButton,
  type RefundOrderSummary,
} from "@/components/equipe/RefundOrderButton";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import { eventDateFormatter } from "@/lib/datetime";
import {
  COURTESY_PROVIDER,
  refundBlock,
  refundBlockMessage,
} from "@/lib/domain/refund";
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

export function CourtesyForm({
  eventId,
  remaining,
  id,
  className,
}: SectionProps & { eventId: string; remaining: number }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastTicketUrl, setLastTicketUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const soldOut = remaining === 0;

  function submitCourtesy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const result = await issueCourtesy({
          eventId,
          name: String(formData.get("name") ?? ""),
          email: String(formData.get("email") ?? ""),
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
        {remaining} {remaining === 1 ? "vaga disponível" : "vagas disponíveis"}
      </p>
      <form
        className="mt-3 grid gap-4 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-5"
        onSubmit={submitCourtesy}
      >
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
}: SectionProps & { eventId: string; tickets: TicketListItem[] }) {
  const [search, setSearch] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return tickets;

    return tickets.filter((ticket) =>
      ticket.buyerName.toLocaleLowerCase("pt-BR").includes(term),
    );
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

    setListMessage("");
    startTransition(async () => {
      try {
        const result = await cancelTicket(eventId, ticket.id);
        setListMessage(
          result.ok ? "Cortesia cancelada. A vaga foi liberada." : result.error,
        );
      } catch {
        setListMessage("Não foi possível cancelar.");
      }
    });
  }

  function actionsFor(ticket: TicketListItem, inCard = false) {
    return (
      <TicketActions
        hideWhenEmpty={inCard}
        isFirstRowOfOrder={firstRowOfOrder.has(ticket.id)}
        isPending={isPending}
        onCancel={() => requestCancellation(ticket)}
        onRefundDone={setListMessage}
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
            label="Buscar por nome"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome do participante"
            type="search"
            value={search}
            wrapperClassName="w-full sm:w-72"
          />
        ) : null}
      </div>

      {listMessage ? (
        <Notice className="mt-4" tone="info">
          {listMessage}
        </Notice>
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
          description="Confira o nome digitado na busca."
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
                <TicketBadges ticket={ticket} className="mt-2" />
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
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
                      <span className="block">{ticket.typeLabel}</span>
                      <span className="block text-sm text-byla-muted">
                        {currency.format(ticket.priceCents / 100)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <TicketBadges ticket={ticket} />
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

function TicketBadges({ ticket, className }: { ticket: TicketListItem; className?: string }) {
  const badge = statusBadge(ticket);
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
    </span>
  );
}

function CardDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
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
  onCancel,
  onRefundDone,
}: {
  hideWhenEmpty: boolean;
  ticket: TicketListItem;
  order: OrderRefundInfo | undefined;
  isFirstRowOfOrder: boolean;
  isPending: boolean;
  onCancel: () => void;
  onRefundDone: (message: string) => void;
}) {
  const valid = ticket.status === "pago" || ticket.status === "check_in";
  const isCourtesy =
    ticket.kind === "cortesia" || ticket.paymentProvider === COURTESY_PROVIDER;
  const canCancel = isCourtesy && ticket.status === "pago";
  const showRefund =
    !isCourtesy && ticket.orderStatus === "pago" && valid && isFirstRowOfOrder && order;
  const block = order
    ? refundBlock({
        paymentProvider: ticket.paymentProvider,
        paidAt: ticket.paidAt,
        hasCheckIn: order.hasCheckIn,
      })
    : null;

  if (!valid && !showRefund) {
    return hideWhenEmpty ? null : (
      <span className="inline-flex min-h-11 items-center text-byla-muted">—</span>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 md:flex-col md:gap-1">
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
