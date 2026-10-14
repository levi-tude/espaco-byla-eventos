"use client";

import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";

import { requestOrderRefund } from "@/app/organizador/eventos/order-actions";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

const MIN_LENGTH = 5;
const MAX_LENGTH = 500;

export const REFUND_REQUEST_SENT_MESSAGE =
  "Pedido de estorno enviado. A equipe do Espaço Byla vai responder por e-mail.";

/** Pedido de estorno à equipe: quem devolve o dinheiro ao comprador é o Espaço Byla. */
export function RequestRefundDialog({
  orderId,
  orderNumber,
  buyerName,
  onClose,
  onSent,
}: {
  orderId: string;
  orderNumber: string;
  buyerName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const length = reason.trim().length;
    if (length < MIN_LENGTH || length > MAX_LENGTH) {
      return setError("Escreva o motivo (de 5 a 500 caracteres).");
    }

    startTransition(async () => {
      try {
        const result = await requestOrderRefund(orderId, reason);
        if (!result.ok) return setError(result.error);
        onSent();
      } catch {
        setError("Não foi possível enviar o pedido de estorno.");
      }
    });
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl border border-byla-border bg-byla-surface p-0 text-foreground backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onClose();
      }}
      ref={dialogRef}
    >
      <form className="grid gap-4 p-4 sm:p-6" onSubmit={handleSubmit}>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-byla-muted">Pedir estorno</p>
          <h2 className="mt-1 break-words text-xl font-semibold" id={titleId}>
            Pedido nº {orderNumber} · {buyerName}
          </h2>
          <p className="mt-2 text-base text-byla-muted">
            A equipe do Espaço Byla confere o pedido, devolve 100% ao comprador e avisa você por e-mail.
          </p>
        </div>
        <TextAreaField
          hint="Ex.: O comprador não vai poder ir e pediu o dinheiro de volta."
          label="Motivo"
          maxLength={MAX_LENGTH}
          name="reason"
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button disabled={isPending} onClick={onClose} variant="secondary">
            Cancelar
          </Button>
          <Button loading={isPending} loadingLabel="Enviando..." type="submit">
            Enviar pedido
          </Button>
        </div>
      </form>
    </dialog>
  );
}
