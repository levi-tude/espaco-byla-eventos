"use client";

import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";

import { requestEventChange } from "@/app/organizador/eventos/actions";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { parseChangeWhat } from "@/lib/organizer/validation";

const MIN_LENGTH = 5;
const MAX_LENGTH = 500;

export const CHANGE_SENT_MESSAGE = "Pedido enviado. A ACDH Eventos vai responder por e-mail.";

function validLength(value: string): boolean {
  const length = value.trim().length;
  return length >= MIN_LENGTH && length <= MAX_LENGTH;
}

/** Pedido de mudança ao Admin (nome, local, horário, preço ou lugares de evento aprovado). */
export function RequestChangeDialog({
  eventId,
  topic,
  onClose,
  onSent,
}: {
  eventId: string;
  /** Campo que motivou o pedido; abre o texto ("Local: "). */
  topic: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [what, setWhat] = useState(`${topic}: `);
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
    const parsedWhat = parseChangeWhat(what, topic);
    if (!parsedWhat.ok) return setError(parsedWhat.error);
    if (!validLength(reason)) return setError("Escreva o motivo (de 5 a 500 caracteres).");

    startTransition(async () => {
      try {
        const result = await requestEventChange(eventId, { topic, what, reason });
        if (!result.ok) return setError(result.error);
        onSent();
      } catch {
        setError("Não foi possível enviar o pedido.");
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
          <p className="text-sm font-medium uppercase tracking-wide text-byla-muted">Pedir mudança</p>
          <h2 className="mt-1 text-xl font-semibold" id={titleId}>
            O que você quer mudar?
          </h2>
          <p className="mt-2 text-base text-byla-muted">
            Depois da aprovação, esta mudança passa pela ACDH Eventos. A resposta chega no seu e-mail.
          </p>
        </div>
        <TextAreaField
          hint="Ex.: Sessão de 19h passa para 20h."
          label="O que mudar"
          maxLength={MAX_LENGTH}
          name="what"
          onChange={(event) => setWhat(event.target.value)}
          required
          value={what}
        />
        <TextAreaField
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
