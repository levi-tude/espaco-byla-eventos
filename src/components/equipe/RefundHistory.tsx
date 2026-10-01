"use client";

import { useState, useTransition } from "react";

import { refundOrder } from "@/app/equipe/eventos/order-actions";
import { eventDateFormatter } from "@/lib/datetime";
import {
  EXTERNAL_REFUND_REASON,
  refundRejectionMessage,
  refundStatusLabel,
  type RefundStatus,
} from "@/lib/domain/refund";

export type RefundHistoryItem = {
  id: string;
  orderId: string;
  buyerName: string;
  amountCents: number;
  status: RefundStatus;
  reason: string;
  requestedByName: string | null;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = eventDateFormatter({ dateStyle: "short", timeStyle: "short" });

const statusClasses: Record<RefundStatus, string> = {
  concluido: "border-byla-border bg-byla-overlay text-byla-muted",
  solicitado:
    "border-amber-600/40 bg-amber-500/15 text-amber-800 dark:border-amber-400/40 dark:text-amber-300",
  falhou:
    "border-red-700/40 bg-red-500/10 text-red-800 dark:border-red-400/40 dark:text-red-300",
};

function historyLine(item: RefundHistoryItem) {
  const when = dateFormatter.format(new Date(item.createdAt));
  if (item.reason === EXTERNAL_REFUND_REASON && !item.requestedByName) {
    return `Estornado fora do site (aviso recebido em ${when}).`;
  }
  const who = item.requestedByName ?? "equipe";
  const verb = item.status === "concluido" ? "Estornado" : "Estorno pedido";
  return `${verb} por ${who} em ${when} — motivo: ${item.reason}`;
}

export function RefundHistory({ refunds }: { refunds: RefundHistoryItem[] }) {
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  if (refunds.length === 0) return null;

  function recheck(item: RefundHistoryItem) {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await refundOrder(item.orderId, item.reason);
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setMessage(
          result.data.status === "processing"
            ? "O estorno ainda está em processamento. Confira de novo em alguns minutos."
            : "Estorno concluído. As vagas voltaram para a venda.",
        );
      } catch {
        setMessage("Não foi possível conferir o estorno.");
      }
    });
  }

  return (
    <section
      aria-labelledby="estornos-titulo"
      className="mt-8 rounded-xl border border-byla-border bg-byla-surface p-6"
    >
      <h2 className="text-lg font-semibold" id="estornos-titulo">
        Estornos
      </h2>
      <ul className="mt-4 grid gap-3">
        {refunds.map((item) => (
          <li
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-byla-border p-4"
            key={item.id}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {item.buyerName} · {currency.format(item.amountCents / 100)}
              </p>
              <p className="mt-1 break-words text-sm text-byla-muted">{historyLine(item)}</p>
              {item.status === "concluido" && item.completedAt ? (
                <p className="mt-1 text-xs text-byla-muted">
                  Devolução confirmada em {dateFormatter.format(new Date(item.completedAt))}.
                </p>
              ) : null}
              {item.status === "falhou" ? (
                <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                  {refundRejectionMessage(item.errorCode)}
                </p>
              ) : null}
              <span
                className={`mt-2 inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClasses[item.status]}`}
              >
                {refundStatusLabel(item.status)}
              </span>
            </div>
            {item.status === "solicitado" ? (
              <button
                className="min-h-11 rounded-lg border border-byla-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={isPending}
                onClick={() => recheck(item)}
                type="button"
              >
                {isPending ? "Conferindo..." : "Conferir estorno"}
              </button>
            ) : null}
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
