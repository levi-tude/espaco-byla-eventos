"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";

import { type ChargebackKind, registerChargeback } from "@/app/equipe/taxa-servico/actions";
import { FinanceDialog } from "@/components/equipe/FinanceDialog";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { controlClasses, labelClasses, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { FEE_REASON_MAX, FEE_REASON_MIN } from "@/lib/finance/fee-inputs";

export type ChargebackOrderOption = {
  orderId: string;
  /** "A1B2C3D4 · Maria Souza · R$ 52,50" */
  label: string;
  contested: boolean;
};

const COPY: Record<
  ChargebackKind,
  { button: string; title: string; explanation: string; submit: string; done: string }
> = {
  contestacao: {
    button: "Registrar contestação",
    title: "Registrar contestação",
    explanation:
      "Use quando o banco de pagamento avisar que o comprador contestou a compra no cartão. A taxa deste pedido sai do valor a repassar (se o repasse já foi feito, vira desconto no próximo). Os ingressos não mudam.",
    submit: "Registrar contestação",
    done: "Contestação registrada. A taxa do pedido saiu do valor a repassar.",
  },
  reversao: {
    button: "Desfazer contestação",
    title: "Desfazer contestação",
    explanation:
      "Use quando o Espaço ganhar a disputa no banco de pagamento. A taxa do pedido volta a ser devida ao desenvolvedor.",
    submit: "Desfazer contestação",
    done: "Contestação desfeita. A taxa do pedido voltou para o valor a repassar.",
  },
};

export function ChargebackButtons({ orders }: { orders: ChargebackOrderOption[] }) {
  const [open, setOpen] = useState<ChargebackKind | null>(null);
  const [done, setDone] = useState("");
  const available: Record<ChargebackKind, ChargebackOrderOption[]> = {
    contestacao: orders.filter((order) => !order.contested),
    reversao: orders.filter((order) => order.contested),
  };

  if (orders.length === 0) return null;

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {(["contestacao", "reversao"] as const).map((kind) =>
          available[kind].length ? (
            <Button key={kind} onClick={() => setOpen(kind)} variant="secondary">
              {COPY[kind].button}
            </Button>
          ) : null,
        )}
      </div>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <ChargebackDialog
          kind={open}
          onClose={() => setOpen(null)}
          onDone={(message) => {
            setOpen(null);
            setDone(message);
          }}
          orders={available[open]}
        />
      ) : null}
    </div>
  );
}

function ChargebackDialog({
  kind,
  orders,
  onClose,
  onDone,
}: {
  kind: ChargebackKind;
  orders: ChargebackOrderOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const selectId = useId();
  const [orderId, setOrderId] = useState(orders.length === 1 ? orders[0].orderId : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const copy = COPY[kind];
  const reasonLength = reason.trim().length;
  const ready =
    orderId !== "" && reasonLength >= FEE_REASON_MIN && reasonLength <= FEE_REASON_MAX;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await registerChargeback({ orderId, kind, reason });
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        onDone(copy.done);
        router.refresh();
      } catch {
        setError("Não foi possível registrar a contestação.");
      }
    });
  }

  return (
    <FinanceDialog
      busy={isPending}
      eyebrow="Taxa de serviço"
      onClose={onClose}
      onSubmit={submit}
      title={copy.title}
      titleId={`contestacao-${kind}`}
    >
      <p className="text-base">{copy.explanation}</p>

      <div className="flex flex-col gap-1.5">
        <label className={labelClasses} htmlFor={selectId}>
          Pedido
        </label>
        <select
          className={cx(controlClasses, "min-h-12")}
          disabled={isPending}
          id={selectId}
          onChange={(event) => setOrderId(event.target.value)}
          required
          value={orderId}
        >
          <option value="">Escolha o pedido</option>
          {orders.map((order) => (
            <option key={order.orderId} value={order.orderId}>
              {order.label}
            </option>
          ))}
        </select>
      </div>

      <TextAreaField
        disabled={isPending}
        hint={`De ${FEE_REASON_MIN} a ${FEE_REASON_MAX} caracteres. Fica registrado com seu nome e a data.`}
        label="Motivo (obrigatório)"
        maxLength={FEE_REASON_MAX}
        onChange={(event) => setReason(event.target.value)}
        placeholder={kind === "contestacao" ? "Ex.: aviso de contestação recebido do banco" : "Ex.: disputa ganha pelo Espaço"}
        required
        value={reason}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
        <Button disabled={isPending} onClick={onClose} variant="secondary">
          Voltar
        </Button>
        <Button disabled={!ready} loading={isPending} loadingLabel="Registrando..." type="submit">
          {copy.submit}
        </Button>
      </div>
    </FinanceDialog>
  );
}
