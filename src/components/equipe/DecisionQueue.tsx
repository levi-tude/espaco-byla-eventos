"use client";

import { useState, useTransition } from "react";

import { acceptPaidOrder } from "@/app/equipe/eventos/order-actions";
import { RefundOrderButton } from "@/components/equipe/RefundOrderButton";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { eventDateFormatter } from "@/lib/datetime";
import { refundBlock, refundBlockMessage } from "@/lib/domain/refund";
import { canAcceptDecision, decisionLabel } from "@/lib/domain/status";

export type DecisionQueueItem = {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  totalCents: number;
  paidAt: string | null;
  decisionReason: string | null;
  ticketCount: number;
  paymentProvider: string | null;
  hasCheckIn: boolean;
  /** Ingressos que deixam de valer num estorno (ex.: "Inteira — Maria Souza"). */
  ticketLabels: string[];
};

type Props = {
  capacity: number;
  /** Lugares ocupados agora (vendidos + reservas); `null` se não foi possível consultar. */
  occupied: number | null;
  orders: DecisionQueueItem[];
  id?: string;
  className?: string;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = eventDateFormatter({ dateStyle: "short", timeStyle: "short" });

function ticketsText(count: number) {
  return `${count} ${count === 1 ? "ingresso" : "ingressos"}`;
}

function refundBlockedMessage(order: DecisionQueueItem) {
  const block = refundBlock({
    paymentProvider: order.paymentProvider,
    paidAt: order.paidAt,
    hasCheckIn: order.hasCheckIn,
  });
  return block ? refundBlockMessage(block) : null;
}

export function DecisionQueue({ capacity, occupied, orders, id, className }: Props) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  if (orders.length === 0 && !message) return null;

  function accept(order: DecisionQueueItem) {
    const capacityLine =
      occupied === null
        ? "A lotação do evento pode ser ultrapassada."
        : `A lotação passará de ${occupied} para ${occupied + order.ticketCount} (limite do evento: ${capacity}).`;
    if (
      !window.confirm(
        `Aceitar mesmo assim o pedido de ${order.buyerName}?\n\n${ticketsText(order.ticketCount)} passam a valer e o comprador recebe os QR Codes por e-mail.\n${capacityLine}`,
      )
    ) {
      return;
    }

    setMessage("");
    startTransition(async () => {
      try {
        const result = await acceptPaidOrder(order.orderId);
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setMessage(
          result.data.alreadyAccepted
            ? "Este pedido já tinha sido aceito."
            : result.data.emailSent
              ? "Pedido aceito. Os ingressos foram liberados e enviados ao comprador."
              : "Pedido aceito e ingressos liberados, mas o e-mail não saiu. Envie o link do pedido ao comprador.",
        );
      } catch {
        setMessage("Não foi possível aceitar o pedido.");
      }
    });
  }

  return (
    <section
      aria-labelledby="decisao-titulo"
      className={cx(
        "rounded-2xl border border-byla-warning/40 bg-byla-warning-bg p-4 sm:p-5",
        className,
      )}
      id={id}
    >
      <h2 className="text-xl font-semibold text-byla-warning" id="decisao-titulo">
        Precisa de decisão{orders.length > 0 ? ` (${orders.length})` : ""}
      </h2>
      <p className="mt-1 text-base text-foreground">
        Estes pedidos foram pagos, mas os ingressos ainda não valem. Escolha
        “Aceitar mesmo assim” para liberar os ingressos ou “Estornar” para
        devolver 100% do valor.
      </p>

      <ul className="mt-4 grid gap-3 empty:hidden">
        {orders.map((order) => (
          <li
            className="grid gap-3 rounded-xl border border-byla-border bg-byla-surface p-4 text-foreground sm:flex sm:flex-wrap sm:items-start sm:justify-between"
            key={order.orderId}
          >
            <div className="min-w-0">
              <p className="break-words font-semibold">{order.buyerName}</p>
              <p className="break-all text-sm text-byla-muted">{order.buyerEmail}</p>
              <p className="mt-1 text-sm text-byla-muted">
                {order.paidAt ? `Pago em ${dateFormatter.format(new Date(order.paidAt))} · ` : ""}
                {ticketsText(order.ticketCount)} · {currency.format(order.totalCents / 100)}
              </p>
              <StatusBadge className="mt-2" tone="warning">
                {decisionLabel(order.decisionReason)}
              </StatusBadge>
            </div>
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-start">
              {canAcceptDecision(order.decisionReason) ? (
                <Button
                  loading={isPending}
                  loadingLabel="Processando..."
                  onClick={() => accept(order)}
                >
                  Aceitar mesmo assim
                </Button>
              ) : null}
              <RefundOrderButton
                blockedMessage={refundBlockedMessage(order)}
                label="Estornar"
                onDone={setMessage}
                order={{
                  orderId: order.orderId,
                  buyerName: order.buyerName,
                  totalCents: order.totalCents,
                  ticketLabels: order.ticketLabels,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {message ? (
        <Notice className="mt-3" tone="info">
          {message}
        </Notice>
      ) : null}
    </section>
  );
}
