"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";

import {
  refundNextInBatch,
  retryRefundBatchFailures,
  startRefundBatch,
} from "@/app/equipe/eventos/session-actions";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatSessionShort } from "@/lib/datetime";
import { REFUND_REASON_MAX, REFUND_REASON_MIN } from "@/lib/domain/refund";
import {
  parseMoneyToCents,
  REFUND_BATCH_INTERVAL_MS,
  refundBatchItemLabel,
  type RefundBatchSummary,
  type SessionOpsSummary,
} from "@/lib/domain/session-ops";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const plainMoney = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Chamadas seguidas sem pedido livre (outra aba estornando) antes de desistir. */
const MAX_BUSY_ROUNDS = 10;
const BUSY_WAIT_MS = 3000;
const RATE_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Props = { summary: SessionOpsSummary; sessionLabel: string };

/** "Estornar todos" da sessão cancelada: confirmação, execução um a um e relatório. */
export function RefundAllSection({ summary, sessionLabel }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [message, setMessage] = useState<{ tone: "danger" | "info" | "success" | "warning"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const stopRef = useRef(false);
  const batch = summary.batch;
  const batchOpen = batch?.status === "em_andamento";
  const canStartNew = summary.refund.orders > 0 && !batchOpen;

  useEffect(() => () => {
    stopRef.current = true;
  }, []);

  async function runBatch(batchId: string, total: number) {
    stopRef.current = false;
    setRunning(true);
    setMessage(null);
    setProcessed(0);
    let busyRounds = 0;
    let count = 0;
    try {
      while (!stopRef.current) {
        const result = await refundNextInBatch(batchId);
        if (!result.ok) {
          setMessage({ tone: "danger", text: `${result.error} Clique em Continuar estornos para seguir.` });
          return;
        }
        const step = result.data;
        if (step.state === "done") {
          setMessage(
            step.status === "concluido_com_falhas"
              ? { tone: "warning", text: "Estornos terminados, mas alguns falharam. Veja a lista abaixo." }
              : { tone: "success", text: "Todos os estornos possíveis foram feitos. Cada comprador recebe um e-mail." },
          );
          return;
        }
        if (step.state === "busy") {
          busyRounds += 1;
          if (busyRounds >= MAX_BUSY_ROUNDS) {
            setMessage({
              tone: "info",
              text: "Outra pessoa da equipe está estornando este lote agora. Atualize a página em alguns minutos.",
            });
            return;
          }
          await sleep(BUSY_WAIT_MS);
          continue;
        }
        if (step.state === "wait") {
          await sleep(RATE_WAIT_MS);
          continue;
        }
        busyRounds = 0;
        count += 1;
        setProcessed(Math.min(count, total));
        if (step.pause) {
          setMessage({
            tone: "warning",
            text: "Pausado: o banco responsável pelo pagamento falhou 3 vezes seguidas. Espere alguns minutos e clique em Continuar estornos.",
          });
          return;
        }
        await sleep(REFUND_BATCH_INTERVAL_MS);
      }
    } catch {
      setMessage({ tone: "danger", text: "A conexão caiu. Clique em Continuar estornos para seguir de onde parou." });
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  function retryFailures(batchId: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await retryRefundBatchFailures(batchId);
        if (!result.ok) {
          setMessage({ tone: "danger", text: result.error });
          return;
        }
        if (result.data === 0) {
          setMessage({ tone: "info", text: "Nenhum pedido para tentar de novo." });
          return;
        }
        await runBatch(batchId, result.data);
      } catch {
        setMessage({ tone: "danger", text: "Não foi possível tentar de novo." });
      }
    });
  }

  return (
    <section aria-label="Estornar todos" className="grid gap-3 rounded-xl border border-byla-border bg-byla-surface p-4">
      <div>
        <h3 className="text-base font-semibold">Estornos da sessão cancelada</h3>
        <p className="mt-1 text-base text-byla-muted">
          {summary.refund.orders > 0
            ? `${summary.refund.orders === 1 ? "1 pedido pode" : `${summary.refund.orders} pedidos podem`} ser estornados · ${currency.format(summary.refund.cents / 100)}.`
            : "Nenhum pedido pago para estornar nesta sessão."}
          {summary.refund.skippedCheckIn > 0
            ? ` ${summary.refund.skippedCheckIn} com entrada registrada ${summary.refund.skippedCheckIn === 1 ? "fica" : "ficam"} de fora.`
            : ""}
          {summary.refund.skippedDeadline > 0
            ? ` ${summary.refund.skippedDeadline} com mais de 180 dias ${summary.refund.skippedDeadline === 1 ? "fica" : "ficam"} de fora (estorno pelo painel do banco).`
            : ""}
        </p>
      </div>

      {canStartNew ? (
        <div className="grid gap-2 sm:flex">
          <Button disabled={running || isPending} onClick={() => setDialogOpen(true)} variant="danger">
            Estornar todos ({summary.refund.orders})
          </Button>
        </div>
      ) : null}

      {running ? (
        <Notice live tone="info">
          Estornando {processed} de {batch?.expectedCount ?? summary.refund.orders}… Não feche esta página.
        </Notice>
      ) : null}
      {message ? <Notice live tone={message.tone}>{message.text}</Notice> : null}

      {batch ? (
        <BatchReport
          batch={batch}
          busy={running || isPending}
          onContinue={() => void runBatch(batch.id, batch.expectedCount)}
          onRetry={() => retryFailures(batch.id)}
        />
      ) : null}

      {dialogOpen ? (
        <RefundAllDialog
          onClose={() => setDialogOpen(false)}
          onStarted={(batchId, total) => {
            setDialogOpen(false);
            void runBatch(batchId, total);
          }}
          sessionLabel={sessionLabel}
          summary={summary}
        />
      ) : null}
    </section>
  );
}

function BatchReport({
  batch,
  busy,
  onContinue,
  onRetry,
}: {
  batch: RefundBatchSummary;
  busy: boolean;
  onContinue: () => void;
  onRetry: () => void;
}) {
  const done = batch.items.filter((item) => item.status === "estornado" || item.status === "em_processamento").length;
  const failed = batch.items.filter((item) => item.status === "falhou").length;
  const waiting = batch.items.filter((item) => item.status === "pendente" || item.status === "processando").length;

  return (
    <div className="grid gap-2">
      <p className="text-sm text-byla-muted">
        Pedido por {batch.requestedByName ?? "equipe"} em {formatSessionShort(batch.createdAt)} · {done} de{" "}
        {batch.items.length} estornados
        {failed > 0 ? ` · ${failed} ${failed === 1 ? "falhou" : "falharam"}` : ""}
        {waiting > 0 ? ` · ${waiting} na fila` : ""}
      </p>
      {waiting > 0 || failed > 0 ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {waiting > 0 ? (
            <Button disabled={busy} onClick={onContinue} variant="secondary">
              Continuar estornos
            </Button>
          ) : null}
          {failed > 0 && waiting === 0 ? (
            <Button disabled={busy} onClick={onRetry} variant="secondary">
              Tentar de novo os que falharam
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className="divide-y divide-byla-border rounded-lg border border-byla-border">
        {batch.items.map((item) => (
          <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2" key={item.orderId}>
            <span className="min-w-0 break-words font-medium">
              {item.buyerName} · {currency.format(item.amountCents / 100)}
            </span>
            <span
              className={
                item.status === "falhou"
                  ? "text-sm text-byla-danger"
                  : item.status === "estornado"
                    ? "text-sm text-byla-success"
                    : "text-sm text-byla-muted"
              }
            >
              {refundBatchItemLabel(item.status, item.code)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefundAllDialog({
  summary,
  sessionLabel,
  onClose,
  onStarted,
}: Props & { onClose: () => void; onStarted: (batchId: string, total: number) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(
    summary.cancelReason ? `Sessão cancelada: ${summary.cancelReason}`.slice(0, REFUND_REASON_MAX) : "Sessão cancelada",
  );
  const [typedTotal, setTypedTotal] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const totalLabel = plainMoney.format(summary.refund.cents / 100);
  const reasonLength = reason.trim().length;
  const ready =
    reasonLength >= REFUND_REASON_MIN &&
    reasonLength <= REFUND_REASON_MAX &&
    parseMoneyToCents(typedTotal) === summary.refund.cents;
  const titleId = `estornar-todos-${summary.sessionId}`;

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
        const result = await startRefundBatch(summary.sessionId, reason, typedTotal);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onStarted(result.data.batchId, result.data.expectedCount);
      } catch {
        setError("Não foi possível iniciar o estorno.");
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
          <p className="text-sm font-medium uppercase tracking-wide text-byla-danger">Estornar todos</p>
          <h2 className="mt-1 break-words text-2xl font-semibold" id={titleId}>
            {sessionLabel}
          </h2>
          <p className="mt-2 text-base">
            Devolve 100% de{" "}
            <strong>
              {summary.refund.orders === 1 ? "1 pedido" : `${summary.refund.orders} pedidos`} ·{" "}
              {currency.format(summary.refund.cents / 100)}
            </strong>
            , incluindo a taxa de serviço, um de cada vez. Cada comprador recebe um e-mail. Pedidos já estornados ou com entrada
            registrada são pulados.
          </p>
        </div>

        <Notice tone="warning">
          O saldo da conta de recebimentos precisa cobrir o valor total. Se faltar saldo, os pedidos
          que falharem podem ser tentados de novo depois.
        </Notice>

        <TextAreaField
          disabled={isPending}
          hint="Fica registrado em cada pedido com seu nome."
          label="Motivo"
          maxLength={REFUND_REASON_MAX}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />

        <Field
          autoComplete="off"
          disabled={isPending}
          hint={`Digite ${totalLabel}`}
          inputMode="decimal"
          label="Digite o valor total para confirmar"
          onChange={(event) => setTypedTotal(event.target.value)}
          placeholder={totalLabel}
          value={typedTotal}
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button disabled={isPending} onClick={onClose} variant="secondary">
            Voltar
          </Button>
          <Button disabled={!ready} loading={isPending} loadingLabel="Iniciando..." type="submit" variant="danger">
            Estornar {currency.format(summary.refund.cents / 100)}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
