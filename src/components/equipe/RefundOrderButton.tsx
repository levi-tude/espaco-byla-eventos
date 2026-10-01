"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";

import { refundOrder } from "@/app/equipe/eventos/order-actions";
import { REFUND_REASON_MAX, REFUND_REASON_MIN } from "@/lib/domain/refund";

export type RefundOrderSummary = {
  orderId: string;
  buyerName: string;
  totalCents: number;
  /** Ingressos que deixam de valer (ex.: "Inteira — Maria Souza"). */
  ticketLabels: string[];
};

type Props = {
  order: RefundOrderSummary;
  /** Texto do bloqueio; com ele o botão fica desativado. */
  blockedMessage?: string | null;
  label?: string;
  onDone?: (message: string) => void;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function RefundOrderButton({
  order,
  blockedMessage,
  label = "Estornar pedido",
  onDone,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <button
        className="min-h-11 rounded-lg border border-red-700/50 px-4 py-2 text-left text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/50 dark:text-red-400"
        disabled={Boolean(blockedMessage)}
        onClick={() => setOpen(true)}
        type="button"
      >
        {label}
      </button>
      {blockedMessage ? (
        <span className="max-w-56 text-xs text-byla-muted">{blockedMessage}</span>
      ) : null}
      {open ? (
        <RefundDialog
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setOpen(false);
            onDone?.(message);
          }}
          order={order}
        />
      ) : null}
    </div>
  );
}

function RefundDialog({
  order,
  onClose,
  onDone,
}: {
  order: RefundOrderSummary;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const trimmedLength = reason.trim().length;
  const reasonValid = trimmedLength >= REFUND_REASON_MIN && trimmedLength <= REFUND_REASON_MAX;
  const titleId = `estorno-titulo-${order.orderId}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonValid || isPending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await refundOrder(order.orderId, reason);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone(
          result.data.status === "processing"
            ? "Estorno em processamento. Confira em alguns minutos."
            : result.data.emailSent
              ? "Pedido estornado. As vagas voltaram para a venda."
              : "Pedido estornado. As vagas voltaram para a venda, mas o e-mail ao comprador não saiu. Avise o comprador.",
        );
      } catch {
        setError("Não foi possível estornar o pedido.");
      }
    });
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-1rem)] max-w-lg rounded-2xl border border-byla-border bg-byla-surface p-0 text-foreground backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onClose();
      }}
      ref={dialogRef}
    >
      <form className="grid gap-4 p-4 sm:p-6" onSubmit={submit}>
        <div>
          <h2 className="text-lg font-semibold" id={titleId}>
            Estornar pedido de {order.buyerName}
          </h2>
          <p className="mt-2 text-sm">
            Será devolvido{" "}
            <strong>{currency.format(order.totalCents / 100)} — 100%</strong> para o
            meio de pagamento usado. O comprador recebe um e-mail.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium">
            {order.ticketLabels.length === 1
              ? "Este ingresso deixa de valer:"
              : `Estes ${order.ticketLabels.length} ingressos deixam de valer:`}
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-byla-muted">
            {order.ticketLabels.map((ticketLabel, index) => (
              <li key={`${ticketLabel}-${index}`}>{ticketLabel}</li>
            ))}
          </ul>
        </div>

        <label className="grid gap-1 text-sm font-medium">
          Motivo (obrigatório)
          <textarea
            className="min-h-24 w-full rounded-lg border border-byla-border bg-transparent px-3 py-2 font-normal"
            disabled={isPending}
            maxLength={REFUND_REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: comprador pediu cancelamento"
            required
            value={reason}
          />
          <span className="text-xs font-normal text-byla-muted">
            De {REFUND_REASON_MIN} a {REFUND_REASON_MAX} caracteres. Fica registrado com seu
            nome e a data.
          </span>
        </label>

        {error ? (
          <p
            className="rounded-lg border border-red-700/40 bg-red-500/10 p-3 text-sm font-medium text-red-800 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-11 rounded-lg border border-byla-border px-4 text-sm font-medium disabled:opacity-50"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            Voltar
          </button>
          <button
            className="min-h-11 rounded-lg bg-red-700 px-5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!reasonValid || isPending}
            type="submit"
          >
            {isPending ? "Estornando..." : "Confirmar estorno"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
