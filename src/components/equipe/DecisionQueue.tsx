"use client";

import { useState, useTransition } from "react";

import { acceptPaidOrder } from "@/app/equipe/eventos/order-actions";
import { eventDateFormatter } from "@/lib/datetime";
import { decisionLabel } from "@/lib/domain/status";

export type DecisionQueueItem = {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  totalCents: number;
  paidAt: string | null;
  decisionReason: string | null;
  ticketCount: number;
};

type Props = {
  capacity: number;
  /** Lugares ocupados agora (vendidos + reservas); `null` se não foi possível consultar. */
  occupied: number | null;
  orders: DecisionQueueItem[];
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = eventDateFormatter({ dateStyle: "short", timeStyle: "short" });

function ticketsText(count: number) {
  return `${count} ${count === 1 ? "ingresso" : "ingressos"}`;
}

export function DecisionQueue({ capacity, occupied, orders }: Props) {
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
      className="mt-8 rounded-xl border border-amber-600/50 bg-amber-50 p-6 text-amber-950 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-50"
    >
      <h2 className="text-lg font-semibold" id="decisao-titulo">
        Precisa de decisão{orders.length > 0 ? ` (${orders.length})` : ""}
      </h2>
      <p className="mt-1 text-sm">
        Estes pedidos foram pagos, mas os ingressos ainda não valem. Para
        devolver o dinheiro, aguarde o botão “Estornar”, que chega em breve.
      </p>

      <ul className="mt-4 grid gap-3 empty:hidden">
        {orders.map((order) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-600/30 bg-byla-surface p-4 text-foreground dark:border-amber-400/30"
            key={order.orderId}
          >
            <div>
              <p className="font-medium">{order.buyerName}</p>
              <p className="text-xs text-byla-muted">{order.buyerEmail}</p>
              <p className="mt-1 text-sm text-byla-muted">
                {order.paidAt ? `Pago em ${dateFormatter.format(new Date(order.paidAt))} · ` : ""}
                {ticketsText(order.ticketCount)} · {currency.format(order.totalCents / 100)}
              </p>
              <span className="mt-2 inline-flex rounded-full border border-amber-600/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-400/40 dark:text-amber-300">
                {decisionLabel(order.decisionReason)}
              </span>
            </div>
            <button
              className="min-h-11 rounded-lg bg-byla-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isPending}
              onClick={() => accept(order)}
              type="button"
            >
              {isPending ? "Processando..." : "Aceitar mesmo assim"}
            </button>
          </li>
        ))}
      </ul>

      {message ? (
        <p aria-live="polite" className="mt-3 text-sm font-medium">
          {message}
        </p>
      ) : null}
    </section>
  );
}
