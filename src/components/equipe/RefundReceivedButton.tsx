"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { markRefundReceived } from "@/app/equipe/repasses/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatMoney } from "@/lib/domain/service-fee";
import { FEE_NOTE_MAX, parseReaisInput } from "@/lib/finance/fee-inputs";

type Props = {
  organizerId: string;
  organizerName: string;
  owedCents: number;
  /** "AAAA-MM-DD" em São Paulo. */
  today: string;
};

/** "Recebi a devolução": PIX do organizador ao Espaço (parcial ou total). */
export function RefundReceivedButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");

  return (
    <div className="grid gap-2">
      <Button onClick={() => setOpen(true)} variant="secondary">
        Recebi a devolução
      </Button>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <RefundDialog
          {...props}
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

function RefundDialog({
  organizerId,
  organizerName,
  owedCents,
  today,
  onClose,
  onDone,
}: Props & { onClose: () => void; onDone: (message: string) => void }) {
  const router = useRouter();
  const [amountText, setAmountText] = useState((owedCents / 100).toFixed(2).replace(".", ","));
  const [pixDate, setPixDate] = useState(today);
  const [note, setNote] = useState("");
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const cents = amountText.trim() ? parseReaisInput(amountText) : null;
  const amountValid = cents !== null && cents > 0 && cents <= owedCents;
  const confirmed = amountValid && confirmedFor === cents;
  const ready = confirmed && pixDate !== "" && !/[\r\n]/.test(note);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending || cents === null) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await markRefundReceived({ organizerId, amountCents: cents, pixDate, note });
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        const left = result.data.remainingCents;
        onDone(
          left && left > 0
            ? `Devolução de ${formatMoney(cents)} registrada. Ainda faltam ${formatMoney(left)}.`
            : `Devolução de ${formatMoney(cents)} registrada. Nada mais a devolver.`,
        );
        router.refresh();
      } catch {
        setError("Não foi possível registrar a devolução.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Devolução do organizador"
      onClose={onClose}
      onSubmit={submit}
      title={organizerName}
      titleId={`devolucao-${organizerId}`}
    >
      <p className="text-base">
        Valor a devolver: <strong className="tabular-nums">{formatMoney(owedCents)}</strong>. Confira no extrato do
        Espaço se o PIX chegou antes de registrar.
      </p>

      <Field
        autoComplete="off"
        disabled={isPending}
        error={amountText.trim() && !amountValid ? `Informe um valor até ${formatMoney(owedCents)}.` : undefined}
        hint="Em reais. Pode ser parte do valor."
        label="Valor recebido (R$)"
        onChange={(event) => setAmountText(event.target.value)}
        required
        value={amountText}
      />

      <Field
        disabled={isPending}
        label="Data do PIX"
        max={today}
        onChange={(event) => setPixDate(event.target.value)}
        required
        type="date"
        value={pixDate}
      />

      <Field
        autoComplete="off"
        disabled={isPending}
        hint={`Opcional, até ${FEE_NOTE_MAX} caracteres.`}
        label="Nota"
        maxLength={FEE_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        value={note}
      />

      <Checkbox
        checked={confirmed}
        disabled={isPending || !amountValid}
        onChange={(event) => setConfirmedFor(event.target.checked ? cents : null)}
        required
      >
        Confirmo que o PIX de <strong>{amountValid && cents !== null ? formatMoney(cents) : "—"}</strong> chegou na
        conta do Espaço.
      </Checkbox>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={!ready} loading={isPending} loadingLabel="Registrando..." type="submit">
          Registrar devolução
        </Button>
      </div>
    </FinanceDialog>
  );
}
