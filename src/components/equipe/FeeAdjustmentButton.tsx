"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { addFeeAdjustment } from "@/app/equipe/taxa-servico/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatMoney } from "@/lib/domain/service-fee";
import {
  FEE_MAX_CENTS,
  FEE_REASON_MAX,
  FEE_REASON_MIN,
  parseReaisInput,
} from "@/lib/finance/fee-inputs";

export function FeeAdjustmentButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");

  return (
    <div className="grid gap-2">
      <Button onClick={() => setOpen(true)} variant="secondary">
        Lançar ajuste
      </Button>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <FeeAdjustmentDialog
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

function FeeAdjustmentDialog({
  eventId,
  onClose,
  onDone,
}: {
  eventId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const cents = amountText.trim() ? parseReaisInput(amountText) : null;
  const amountValid = cents !== null && cents !== 0 && Math.abs(cents) <= FEE_MAX_CENTS;
  const reasonLength = reason.trim().length;
  const reasonValid = reasonLength >= FEE_REASON_MIN && reasonLength <= FEE_REASON_MAX;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountValid || !reasonValid || isPending || cents === null) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await addFeeAdjustment({ eventId, amountCents: cents, reason });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone("Ajuste lançado. Ele aparece no histórico com o motivo.");
        router.refresh();
      } catch {
        setError("Não foi possível lançar o ajuste.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Taxa de serviço"
      onClose={onClose}
      onSubmit={submit}
      title="Lançar ajuste"
      titleId={`ajuste-${eventId}`}
    >
      <p className="text-base">
        Corrige o valor já repassado deste evento, sem apagar nenhum registro.
      </p>
      <ul className="list-disc pl-5 text-base text-byla-muted">
        <li>Valor positivo: foi feito um PIX extra ao desenvolvedor.</li>
        <li>Valor negativo (com “-”): um repasse foi registrado a mais.</li>
      </ul>

      <Field
        autoComplete="off"
        disabled={isPending}
        error={amountText.trim() && !amountValid ? "Valor inválido. Ex.: 2,50 ou -2,50" : undefined}
        hint={
          amountValid && cents !== null
            ? cents > 0
              ? `Soma ${formatMoney(cents)} ao já repassado.`
              : `Tira ${formatMoney(-cents)} do já repassado.`
            : "Em reais. Ex.: 2,50 ou -2,50"
        }
        label="Valor (R$)"
        onChange={(event) => setAmountText(event.target.value)}
        required
        value={amountText}
      />

      <TextAreaField
        disabled={isPending}
        hint={`De ${FEE_REASON_MIN} a ${FEE_REASON_MAX} caracteres. Fica registrado com seu nome e a data.`}
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
        <Button
          disabled={!amountValid || !reasonValid}
          loading={isPending}
          loadingLabel="Lançando..."
          type="submit"
        >
          Lançar ajuste
        </Button>
      </div>
    </FinanceDialog>
  );
}
