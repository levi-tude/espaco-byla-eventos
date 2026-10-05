"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { markFeePaid } from "@/app/equipe/taxa-servico/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { PendingDiscount } from "@/lib/domain/fee-payout";
import { formatMoney } from "@/lib/domain/service-fee";
import { FEE_NOTE_MAX } from "@/lib/finance/fee-inputs";
import { formatDiscount } from "@/lib/finance/situation";

type Props = {
  eventId: string;
  eventBalanceCents: number;
  /** Valor do PIX: saldo do evento menos descontos pendentes de outros eventos. */
  suggestedPayoutCents: number;
  pendingDiscounts: PendingDiscount[];
  /** "AAAA-MM-DD" em São Paulo. */
  today: string;
  /** Último dia do evento: o PIX não pode ser anterior. */
  minDate: string | null;
};

export function MarkFeePaidButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");

  if (props.suggestedPayoutCents <= 0) {
    return (
      <Notice live={false} tone="info">
        Nada a pagar agora: os descontos pendentes de outros eventos cobrem o valor deste evento.
      </Notice>
    );
  }

  return (
    <div className="grid gap-2">
      <Button onClick={() => setOpen(true)}>Marcar como pago</Button>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <MarkFeePaidDialog
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

function MarkFeePaidDialog({
  eventId,
  eventBalanceCents,
  suggestedPayoutCents,
  pendingDiscounts,
  today,
  minDate,
  onClose,
  onDone,
}: Props & { onClose: () => void; onDone: (message: string) => void }) {
  const router = useRouter();
  const [pixDate, setPixDate] = useState(today);
  const [note, setNote] = useState("");
  // Guarda o valor confirmado: se a tela recarregar com outro valor, precisa confirmar de novo.
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const amount = formatMoney(suggestedPayoutCents);
  const confirmed = confirmedFor === suggestedPayoutCents;
  const ready = confirmed && pixDate !== "" && !/[\r\n]/.test(note);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await markFeePaid({
          eventId,
          expectedAmountCents: suggestedPayoutCents,
          pixDate,
          note,
        });
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        onDone(`Repasse de ${formatMoney(result.data.amountCents)} registrado. A equipe recebe um e-mail de aviso.`);
        router.refresh();
      } catch {
        setError("Não foi possível registrar o repasse.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Taxa de serviço"
      onClose={onClose}
      onSubmit={submit}
      title="Marcar como pago"
      titleId={`marcar-pago-${eventId}`}
    >
      <div className="rounded-xl border border-byla-border p-4">
        <p className="text-sm text-byla-muted">Valor do PIX ao desenvolvedor</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{amount}</p>
        {pendingDiscounts.length ? (
          <ul className="mt-3 grid gap-1 text-base">
            <li className="flex flex-wrap justify-between gap-x-3">
              <span>Este evento</span>
              <span className="tabular-nums">{formatMoney(eventBalanceCents)}</span>
            </li>
            {pendingDiscounts.map((discount) => (
              <li className="flex flex-wrap justify-between gap-x-3 text-byla-muted" key={discount.eventId}>
                <span className="min-w-0 break-words">{discount.eventName} — desconto</span>
                <span className="tabular-nums">{formatDiscount(discount.balanceCents)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="text-base">
        O registro é permanente. Se algo sair errado, a correção é feita com um ajuste com motivo.
      </p>

      <Field
        disabled={isPending}
        label="Data do PIX"
        max={today}
        min={minDate ?? undefined}
        onChange={(event) => setPixDate(event.target.value)}
        required
        type="date"
        value={pixDate}
      />

      <Field
        autoComplete="off"
        disabled={isPending}
        hint={`Opcional, até ${FEE_NOTE_MAX} caracteres. Ex.: código do PIX.`}
        label="Nota"
        maxLength={FEE_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        value={note}
      />

      <Checkbox
        checked={confirmed}
        disabled={isPending}
        onChange={(event) => setConfirmedFor(event.target.checked ? suggestedPayoutCents : null)}
        required
      >
        Confirmo que o PIX de <strong>{amount}</strong> foi feito ao desenvolvedor.
      </Checkbox>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={!ready} loading={isPending} loadingLabel="Registrando..." type="submit">
          Registrar repasse
        </Button>
      </div>
    </FinanceDialog>
  );
}
