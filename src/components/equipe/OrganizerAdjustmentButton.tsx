"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { addOrganizerAdjustment } from "@/app/equipe/repasses/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatMoney } from "@/lib/domain/service-fee";
import { FEE_MAX_CENTS, FEE_REASON_MAX, FEE_REASON_MIN, parseReaisInput } from "@/lib/finance/fee-inputs";

type Direction = "espaco" | "organizador";

export function OrganizerAdjustmentButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");

  return (
    <div className="grid gap-2">
      <Button onClick={() => setOpen(true)} variant="secondary">
        Lançar ajuste
      </Button>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <AdjustmentDialog
          eventId={eventId}
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setOpen(false);
            setDone(message);
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustmentDialog({
  eventId,
  onClose,
  onDone,
}: {
  eventId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction | null>(null);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const cents = amountText.trim() ? parseReaisInput(amountText) : null;
  const amountValid = cents !== null && cents > 0 && cents <= FEE_MAX_CENTS;
  const reasonLength = reason.trim().length;
  const reasonValid = reasonLength >= FEE_REASON_MIN && reasonLength <= FEE_REASON_MAX;
  const ready = direction !== null && amountValid && reasonValid;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending || cents === null || direction === null) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await addOrganizerAdjustment({ eventId, direction, amountCents: cents, reason });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone("Ajuste lançado. Ele aparece no financeiro do evento com o motivo.");
        router.refresh();
      } catch {
        setError("Não foi possível lançar o ajuste.");
      }
    });
  }

  const options: { value: Direction; label: string }[] = [
    { value: "organizador", label: "O Espaço deve ao organizador (aumenta o que ele tem a receber)" },
    { value: "espaco", label: "O organizador deve ao Espaço (diminui o que ele tem a receber)" },
  ];

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Repasse ao organizador"
      onClose={onClose}
      onSubmit={submit}
      title="Lançar ajuste"
      titleId={`ajuste-org-${eventId}`}
    >
      <p className="text-base">Corrige o saldo do evento sem apagar nenhum registro.</p>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-foreground">Quem fica devendo</legend>
        {options.map((option) => (
          <label className="flex min-h-11 items-start gap-3 text-base" key={option.value}>
            <input
              checked={direction === option.value}
              className="mt-1 h-5 w-5 accent-byla-action"
              disabled={isPending}
              name={`direcao-${eventId}`}
              onChange={() => setDirection(option.value)}
              type="radio"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>

      <Field
        autoComplete="off"
        disabled={isPending}
        error={amountText.trim() && !amountValid ? "Valor inválido. Ex.: 25,00" : undefined}
        hint={amountValid && cents !== null ? formatMoney(cents) : "Em reais. Ex.: 25,00"}
        label="Valor (R$)"
        onChange={(event) => setAmountText(event.target.value)}
        required
        value={amountText}
      />

      <TextAreaField
        disabled={isPending}
        hint={`De ${FEE_REASON_MIN} a ${FEE_REASON_MAX} caracteres. O organizador vê este motivo no financeiro do evento.`}
        label="Motivo (obrigatório)"
        maxLength={FEE_REASON_MAX}
        onChange={(event) => setReason(event.target.value)}
        required
        value={reason}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={!ready} loading={isPending} loadingLabel="Lançando..." type="submit">
          Lançar ajuste
        </Button>
      </div>
    </FinanceDialog>
  );
}
