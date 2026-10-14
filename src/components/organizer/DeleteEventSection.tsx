"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { deleteOwnEvent, requestEventDeletion } from "@/app/organizador/eventos/actions";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

type Props = {
  eventId: string;
  eventName: string;
  /** Pedido pago, estornado, aguardando decisão ou reserva em andamento. */
  hasSales: boolean;
  deletionPending: boolean;
};

function DeleteForm({ eventId, eventName, onCancel }: { eventId: string; eventName: string; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Digite o nome do evento para confirmar.");
    startTransition(async () => {
      try {
        // Deu certo: o servidor leva para "Meus eventos".
        const result = await deleteOwnEvent(eventId, name);
        if (result && !result.ok) setError(result.error);
      } catch {
        setError("Não foi possível excluir o evento.");
      }
    });
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <p className="text-base text-foreground">
        Isso não pode ser desfeito. Para confirmar, digite o nome do evento:{" "}
        <strong className="break-words">{eventName}</strong>
      </p>
      <Field
        autoComplete="off"
        label="Nome do evento"
        name="confirmar-nome"
        onChange={(event) => setName(event.target.value)}
        required
        value={name}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-2 sm:flex">
        <Button disabled={isPending} onClick={onCancel} variant="secondary">
          Cancelar
        </Button>
        <Button loading={isPending} loadingLabel="Excluindo..." type="submit" variant="danger">
          Excluir evento
        </Button>
      </div>
    </form>
  );
}

function RequestDeletionForm({ eventId, onCancel, onSent }: { eventId: string; onCancel: () => void; onSent: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const length = reason.trim().length;
    if (length < 5 || length > 500) return setError("Escreva o motivo (de 5 a 500 caracteres).");
    startTransition(async () => {
      try {
        const result = await requestEventDeletion(eventId, reason);
        if (!result.ok) return setError(result.error);
        onSent();
      } catch {
        setError("Não foi possível enviar o pedido.");
      }
    });
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <TextAreaField
        label="Motivo"
        maxLength={500}
        name="motivo-exclusao"
        onChange={(event) => setReason(event.target.value)}
        required
        value={reason}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-2 sm:flex">
        <Button disabled={isPending} onClick={onCancel} variant="secondary">
          Cancelar
        </Button>
        <Button loading={isPending} loadingLabel="Enviando..." type="submit" variant="danger">
          Enviar pedido
        </Button>
      </div>
    </form>
  );
}

/** Rodapé da página do evento: "Excluir evento" ou, se já houve vendas, "Pedir exclusão". */
export function DeleteEventSection({ eventId, eventName, hasSales, deletionPending }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  let body;
  if (deletionPending || sent) {
    body = (
      <Notice tone="warning">
        Pedido de exclusão em análise. As vendas ficam pausadas até a resposta do Espaço Byla.
      </Notice>
    );
  } else if (hasSales) {
    body = (
      <>
        <p className="text-base text-byla-muted">
          Este evento já teve vendas, então a exclusão passa pelo Espaço Byla. As vendas pausam na hora e o Espaço
          Byla decide.
        </p>
        {open ? (
          <RequestDeletionForm
            eventId={eventId}
            onCancel={() => setOpen(false)}
            onSent={() => {
              setSent(true);
              router.refresh();
            }}
          />
        ) : (
          <Button className="sm:w-auto sm:justify-self-start" fullWidth onClick={() => setOpen(true)} variant="danger">
            Pedir exclusão
          </Button>
        )}
      </>
    );
  } else {
    body = open ? (
      <DeleteForm eventId={eventId} eventName={eventName} onCancel={() => setOpen(false)} />
    ) : (
      <Button className="sm:w-auto sm:justify-self-start" fullWidth onClick={() => setOpen(true)} variant="danger">
        Excluir evento
      </Button>
    );
  }

  return (
    <section
      aria-labelledby="excluir-titulo"
      className="grid gap-3 rounded-xl border border-byla-danger/40 p-4"
    >
      <h2 className="text-lg font-semibold text-foreground" id="excluir-titulo">
        Excluir evento
      </h2>
      {body}
    </section>
  );
}
