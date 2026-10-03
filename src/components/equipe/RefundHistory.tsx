"use client";

import { useState, useTransition } from "react";

import { refundOrder } from "@/app/equipe/eventos/order-actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
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

const statusTones: Record<RefundStatus, Tone> = {
  concluido: "neutral",
  solicitado: "warning",
  falhou: "danger",
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
    <section aria-labelledby="estornos-titulo">
      <h2 className="text-xl font-semibold text-foreground" id="estornos-titulo">
        Estornos
      </h2>
      <ul className="mt-3 grid gap-3">
        {refunds.map((item) => (
          <li
            className="grid gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4"
            key={item.id}
          >
            <div className="min-w-0">
              <p className="break-words font-semibold">
                {item.buyerName} · {currency.format(item.amountCents / 100)}
              </p>
              <p className="mt-1 break-words text-sm text-byla-muted">{historyLine(item)}</p>
              {item.status === "concluido" && item.completedAt ? (
                <p className="mt-1 text-sm text-byla-muted">
                  Devolução confirmada em {dateFormatter.format(new Date(item.completedAt))}.
                </p>
              ) : null}
              {item.status === "falhou" ? (
                <p className="mt-1 text-sm text-byla-danger">
                  {refundRejectionMessage(item.errorCode)}
                </p>
              ) : null}
              <StatusBadge className="mt-2" tone={statusTones[item.status]}>
                {refundStatusLabel(item.status)}
              </StatusBadge>
            </div>
            {item.status === "solicitado" ? (
              <Button
                loading={isPending}
                loadingLabel="Conferindo..."
                onClick={() => recheck(item)}
                variant="secondary"
              >
                Conferir estorno
              </Button>
            ) : null}
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
