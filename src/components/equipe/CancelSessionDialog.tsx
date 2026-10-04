"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";

import { cancelSession } from "@/app/equipe/eventos/session-actions";
import { noticeSendMessage } from "@/components/equipe/session-notice-send";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import {
  CANCEL_CONFIRMATION_WORD,
  isCancelConfirmation,
  SESSION_CANCEL_REASON_MAX,
  SESSION_CANCEL_REASON_MIN,
  type SessionOpsSummary,
} from "@/lib/domain/session-ops";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Props = { summary: SessionOpsSummary; sessionLabel: string };

/** Botão vermelho "Cancelar sessão" com a tela de confirmação forte (spec 9.4.2). */
export function CancelSessionButton({ summary, sessionLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:flex">
        <Button onClick={() => setOpen(true)} variant="danger">
          Cancelar sessão
        </Button>
      </div>
      {done ? <Notice tone="success">{done}</Notice> : null}
      {open ? (
        <CancelSessionDialog
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setOpen(false);
            setDone(message);
          }}
          sessionLabel={sessionLabel}
          summary={summary}
        />
      ) : null}
    </div>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function CancelSessionDialog({
  summary,
  sessionLabel,
  onClose,
  onDone,
}: Props & { onClose: () => void; onDone: (message: string) => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const reasonLength = reason.trim().length;
  const reasonValid = reasonLength >= SESSION_CANCEL_REASON_MIN && reasonLength <= SESSION_CANCEL_REASON_MAX;
  const ready = reasonValid && isCancelConfirmation(confirmation);
  const { impact } = summary;
  const titleId = `cancelar-sessao-${summary.sessionId}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || isPending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await cancelSession(summary.sessionId, reason, confirmation, notify);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const { already, pendingCancelled, chargesUnresolved, notice } = result.data;
        const parts = [already ? "Esta sessão já estava cancelada." : "Sessão cancelada. A venda foi fechada."];
        if (pendingCancelled > 0) {
          parts.push(`${plural(pendingCancelled, "compra pendente foi cancelada", "compras pendentes foram canceladas")}.`);
        }
        if (chargesUnresolved > 0) {
          parts.push(
            `${plural(chargesUnresolved, "cobrança não pôde ser encerrada agora", "cobranças não puderam ser encerradas agora")}; se for paga, aparece em “Decisões” para estornar.`,
          );
        }
        if (notice) parts.push(`Aviso aos compradores: ${noticeSendMessage(notice)}`);
        parts.push("Agora estorne os pedidos pagos: um por um ou em “Estornar todos”.");
        onDone(parts.join(" "));
        router.refresh();
      } catch {
        setError("Não foi possível cancelar a sessão.");
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
      <form className="grid gap-4 p-4 sm:p-6" onSubmit={submit}>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-byla-danger">Cancelar sessão</p>
          <h2 className="mt-1 break-words text-2xl font-semibold" id={titleId}>
            {sessionLabel}
          </h2>
          <p className="mt-2 text-base">
            Cancelar a sessão <strong>não devolve o dinheiro automaticamente</strong>. Depois de
            cancelar, você poderá estornar os pedidos um por um ou todos de uma vez.
          </p>
        </div>

        <div className="rounded-xl border border-byla-border p-3">
          <p className="text-base font-medium">O que acontece agora</p>
          <ul className="mt-1 list-disc pl-5 text-base text-byla-muted">
            <li>
              {plural(impact.paidOrders, "pedido pago", "pedidos pagos")} ·{" "}
              {currency.format(impact.paidCents / 100)} recebidos (continuam pagos até o estorno)
            </li>
            {impact.decisionOrders > 0 ? (
              <li>
                {plural(impact.decisionOrders, "pedido aguardando decisão", "pedidos aguardando decisão")} ·{" "}
                {currency.format(impact.decisionCents / 100)}
              </li>
            ) : null}
            <li>{plural(impact.pendingOrders, "compra pendente será cancelada", "compras pendentes serão canceladas")}</li>
            {impact.courtesyOrders > 0 ? <li>{plural(impact.courtesyOrders, "cortesia", "cortesias")}</li> : null}
            {impact.checkedInOrders > 0 ? (
              <li className="text-byla-warning">
                {plural(impact.checkedInOrders, "pedido já tem entrada registrada", "pedidos já têm entrada registrada")}{" "}
                (não poderão ser estornados pelo site)
              </li>
            ) : null}
            <li>A portaria passa a recusar os ingressos desta sessão.</li>
          </ul>
        </div>

        <TextAreaField
          disabled={isPending}
          hint={`De ${SESSION_CANCEL_REASON_MIN} a ${SESSION_CANCEL_REASON_MAX} caracteres. Vai no e-mail aos compradores e fica registrado com seu nome.`}
          label="Motivo (obrigatório)"
          maxLength={SESSION_CANCEL_REASON_MAX}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ex.: chuva forte, espaço alagado"
          required
          value={reason}
        />

        <label className="flex min-h-11 items-start gap-3 text-base">
          <input
            checked={notify}
            className="mt-1 h-5 w-5 shrink-0 accent-byla-action"
            disabled={isPending}
            onChange={(event) => setNotify(event.target.checked)}
            type="checkbox"
          />
          <span>
            Avisar os compradores por e-mail agora
            <span className="block text-sm text-byla-muted">
              Cada pedido pago, aguardando decisão ou cortesia recebe 1 e-mail com o motivo.
            </span>
          </span>
        </label>

        <Field
          autoCapitalize="characters"
          autoComplete="off"
          disabled={isPending}
          hint="Maiúsculas ou minúsculas."
          label={`Digite ${CANCEL_CONFIRMATION_WORD} para confirmar`}
          onChange={(event) => setConfirmation(event.target.value)}
          spellCheck={false}
          value={confirmation}
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button disabled={isPending} onClick={onClose} variant="secondary">
            Voltar
          </Button>
          <Button disabled={!ready} loading={isPending} loadingLabel="Cancelando..." type="submit" variant="danger">
            Cancelar sessão
          </Button>
        </div>
      </form>
    </dialog>
  );
}
