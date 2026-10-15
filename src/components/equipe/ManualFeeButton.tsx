"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import { loadPendingFees, type PendingFeeOrder, setEventFeeTotal, setManualFee } from "@/app/equipe/repasses/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { controlClasses, Field, labelClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatMoney } from "@/lib/domain/service-fee";
import { FEE_NOTE_MAX, parseReaisInput } from "@/lib/finance/fee-inputs";

type Mode = "total" | "pedido";

/** "Lançar tarifa do extrato": total do evento (padrão) ou de um pedido. */
export function ManualFeeButton({ eventId }: { eventId: string }) {
  const [orders, setOrders] = useState<PendingFeeOrder[] | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [isLoading, startLoading] = useTransition();

  function open() {
    setError("");
    startLoading(async () => {
      try {
        const result = await loadPendingFees(eventId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.data.length === 0) {
          setDone("Todos os pedidos já têm tarifa.");
          return;
        }
        setOrders(result.data);
      } catch {
        setError("Não foi possível carregar os pedidos.");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Button loading={isLoading} loadingLabel="Abrindo..." onClick={open} variant="secondary">
        Lançar tarifa do extrato
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      {orders ? (
        <FeeDialog
          eventId={eventId}
          onClose={() => setOrders(null)}
          onDone={(message) => {
            setOrders(null);
            setDone(message);
          }}
          orders={orders}
        />
      ) : null}
    </div>
  );
}

function FeeDialog({
  eventId,
  orders,
  onClose,
  onDone,
}: {
  eventId: string;
  orders: PendingFeeOrder[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("total");
  const [orderId, setOrderId] = useState(orders[0]?.orderId ?? "");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [zeroConfirmed, setZeroConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const pendingCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
  const selected = orders.find((o) => o.orderId === orderId) ?? null;
  const limit = mode === "total" ? pendingCents : (selected?.totalCents ?? 0);
  const cents = amountText.trim() ? parseReaisInput(amountText) : null;
  const amountValid = cents !== null && cents >= 0 && cents <= limit;
  const noteValid = note.trim().length > 0 && note.trim().length <= FEE_NOTE_MAX && !/[\r\n]/.test(note);
  const needsZeroConfirm = cents === 0;
  const ready = amountValid && noteValid && (!needsZeroConfirm || zeroConfirmed) && (mode === "total" || selected);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending || cents === null) return;
    setError("");
    startTransition(async () => {
      try {
        const result =
          mode === "total"
            ? await setEventFeeTotal({
                eventId,
                expectedOrders: orders.length,
                expectedPendingCents: pendingCents,
                totalFeeCents: cents,
                note,
              })
            : await setManualFee({ eventId, orderId, feeCents: cents, note });
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        onDone(mode === "total" ? "Tarifas lançadas nos pedidos do evento." : "Tarifa do pedido lançada.");
        router.refresh();
      } catch {
        setError("Não foi possível lançar a tarifa.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Tarifa do banco de pagamento"
      onClose={onClose}
      onSubmit={submit}
      title="Lançar tarifa do extrato"
      titleId={`tarifa-${eventId}`}
    >
      <p className="text-base">
        {orders.length === 1 ? "1 pedido" : `${orders.length} pedidos`} sem tarifa, somando{" "}
        <strong className="tabular-nums">{formatMoney(pendingCents)}</strong>.
      </p>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-foreground">O que lançar</legend>
        {(
          [
            { value: "total", label: "Total das tarifas desses pedidos (somado no extrato)" },
            { value: "pedido", label: "Tarifa de um pedido" },
          ] as const
        ).map((option) => (
          <label className="flex min-h-11 items-start gap-3 text-base" key={option.value}>
            <input
              checked={mode === option.value}
              className="mt-1 h-5 w-5 accent-byla-action"
              disabled={isPending}
              name={`modo-tarifa-${eventId}`}
              onChange={() => setMode(option.value)}
              type="radio"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>

      {mode === "pedido" ? (
        <div className="flex flex-col gap-1.5">
          <label className={labelClasses} htmlFor={`pedido-tarifa-${eventId}`}>
            Pedido
          </label>
          <select
            className={controlClasses}
            disabled={isPending}
            id={`pedido-tarifa-${eventId}`}
            onChange={(event) => setOrderId(event.target.value)}
            value={orderId}
          >
            {orders.map((o) => (
              <option key={o.orderId} value={o.orderId}>
                Nº {o.orderNumber} · {formatMoney(o.totalCents)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-byla-muted">
          O total é dividido entre os pedidos na proporção do valor de cada um.
        </p>
      )}

      <Field
        autoComplete="off"
        disabled={isPending}
        error={amountText.trim() && !amountValid ? `Informe um valor até ${formatMoney(limit)}.` : undefined}
        hint="Em reais, como aparece no extrato. Ex.: 12,47"
        label={mode === "total" ? "Total das tarifas (R$)" : "Tarifa do pedido (R$)"}
        onChange={(event) => setAmountText(event.target.value)}
        required
        value={amountText}
      />

      <Field
        autoComplete="off"
        disabled={isPending}
        hint={`Obrigatório, até ${FEE_NOTE_MAX} caracteres. Ex.: extrato de outubro.`}
        label="De onde veio o valor"
        maxLength={FEE_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        required
        value={note}
      />

      {needsZeroConfirm ? (
        <Checkbox
          checked={zeroConfirmed}
          disabled={isPending}
          onChange={(event) => setZeroConfirmed(event.target.checked)}
          required
        >
          Confirmo que o banco não cobrou tarifa {mode === "total" ? "desses pedidos" : "deste pedido"}.
        </Checkbox>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={!ready} loading={isPending} loadingLabel="Lançando..." type="submit">
          Lançar tarifa
        </Button>
      </div>
    </FinanceDialog>
  );
}
