"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  notifyScheduleChange,
  type NoticeSendResult,
  retrySessionNotices,
  continueSessionNotices,
} from "@/app/equipe/eventos/session-actions";
import { CancelSessionButton } from "@/components/equipe/CancelSessionDialog";
import { RefundAllSection } from "@/components/equipe/RefundAllSection";
import { noticeSendMessage, sendAllNoticeBatches } from "@/components/equipe/session-notice-send";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { formatSessionShort, formatSessionTime } from "@/lib/datetime";
import { noticeKindLabel, type SessionNoticeSummary, type SessionOpsSummary } from "@/lib/domain/session-ops";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  summary: SessionOpsSummary;
  sessionLabel: string;
  /** A sessão já começou: aviso de horário não faz mais sentido. */
  started: boolean;
};

/** Aviso de horário, envios por e-mail, cancelamento e "Estornar todos" da sessão escolhida no painel. */
export function SessionOpsPanel({ summary, sessionLabel, started }: Props) {
  const cancelled = summary.status === "cancelada";
  const change = summary.scheduleChange;

  return (
    <div className="mt-3 grid gap-3">
      {cancelled ? <CancelledBanner summary={summary} /> : null}
      {!cancelled && !started && change && change.recipients > 0 ? (
        <ScheduleChangeCard
          change={change}
          key={change.changeId}
          sessionId={summary.sessionId}
        />
      ) : null}
      {summary.notices.length ? (
        <NoticeHistory emailPausedUntil={summary.emailPausedUntil} notices={summary.notices} />
      ) : null}
      {cancelled ? <RefundAllSection sessionLabel={sessionLabel} summary={summary} /> : null}
      {!cancelled ? <CancelSessionButton sessionLabel={sessionLabel} summary={summary} /> : null}
    </div>
  );
}

function CancelledBanner({ summary }: { summary: SessionOpsSummary }) {
  const { impact } = summary;
  return (
    <Notice title="Sessão cancelada" tone="danger">
      {summary.cancelledAt
        ? `Cancelada em ${formatSessionShort(summary.cancelledAt)}${
            summary.cancelledByName ? ` por ${summary.cancelledByName}` : ""
          }. `
        : null}
      {summary.cancelReason ? `Motivo: ${summary.cancelReason}. ` : null}
      Os ingressos desta sessão não valem para entrada. O dinheiro não volta sozinho: estorne um
      por um na lista de participantes ou use “Estornar todos”.
      {impact.refundedOrders > 0
        ? ` Já estornados: ${impact.refundedOrders} ${impact.refundedOrders === 1 ? "pedido" : "pedidos"} · ${currency.format(impact.refundedCents / 100)}.`
        : null}
    </Notice>
  );
}

function ScheduleChangeCard({
  sessionId,
  change,
}: {
  sessionId: string;
  change: NonNullable<SessionOpsSummary["scheduleChange"]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<NoticeSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = change.recipients;

  function send() {
    const confirmed = window.confirm(
      `Enviar o e-mail de mudança de horário para ${count} ${count === 1 ? "comprador" : "compradores"}? Cada pedido pago recebe 1 e-mail com o novo horário.`,
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendAllNoticeBatches(() => notifyScheduleChange(sessionId), setProgress);
        if (!result.ok) setError(result.error);
        router.refresh();
      } catch {
        setError("Não foi possível avisar os compradores.");
      }
    });
  }

  return (
    <Notice title="Horário alterado" tone="warning">
      <p>
        De {formatSessionShort(change.previousStartsAt)} para {formatSessionShort(change.newStartsAt)}.{" "}
        {count === 1
          ? "1 comprador ainda não foi avisado."
          : `${count} compradores ainda não foram avisados.`}
      </p>
      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button
          loading={isPending}
          loadingLabel={progress ? `Enviando… ${progress.sent} de ${progress.total}` : "Enviando…"}
          onClick={send}
        >
          Enviar e-mail de alteração para {count} {count === 1 ? "comprador" : "compradores"}
        </Button>
      </div>
      {progress && !isPending ? <p className="mt-2">{noticeSendMessage(progress)}</p> : null}
      {error ? <p className="mt-2 font-medium text-byla-danger">{error}</p> : null}
    </Notice>
  );
}

function NoticeHistory({
  notices,
  emailPausedUntil,
}: {
  notices: SessionNoticeSummary[];
  emailPausedUntil: string | null;
}) {
  return (
    <section aria-label="E-mails enviados aos compradores" className="rounded-xl border border-byla-border bg-byla-surface p-4">
      <h3 className="text-base font-semibold">E-mails aos compradores</h3>
      <ul className="mt-2 grid gap-3">
        {notices.map((notice) => (
          <NoticeRow emailPausedUntil={emailPausedUntil} key={notice.id} notice={notice} />
        ))}
      </ul>
    </section>
  );
}

function NoticeRow({ notice, emailPausedUntil }: { notice: SessionNoticeSummary; emailPausedUntil: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [live, setLive] = useState<NoticeSendResult | null>(null);
  const counts = live ?? notice;

  function run(action: "continue" | "retry") {
    setMessage(null);
    startTransition(async () => {
      try {
        const first = () =>
          action === "retry" ? retrySessionNotices(notice.id) : continueSessionNotices(notice.id);
        const result = await sendAllNoticeBatches(first, setLive);
        setMessage(result.ok ? { tone: "info", text: noticeSendMessage(result.data) } : { tone: "danger", text: result.error });
        router.refresh();
      } catch {
        setMessage({ tone: "danger", text: "Não foi possível enviar agora. Tente de novo em alguns minutos." });
      }
    });
  }

  return (
    <li className="grid gap-2 border-t border-byla-border pt-3 first:border-t-0 first:pt-0">
      <div>
        <p className="font-medium">
          {noticeKindLabel(notice.kind)}
          {notice.kind === "alteracao_horario" && notice.newStartsAt
            ? ` · novo horário ${formatSessionShort(notice.newStartsAt)}`
            : ""}
        </p>
        <p className="text-sm text-byla-muted">
          {notice.requestedByName ? `Pedido por ${notice.requestedByName} em ` : "Em "}
          {formatSessionShort(notice.createdAt)} · {counts.sent} de {counts.total - counts.skipped} entregues
          {counts.skipped > 0 ? ` · ${counts.skipped} não precisaram (pedido estornado ou alterado)` : ""}
        </p>
        {counts.pending > 0 ? (
          <p className="text-sm text-byla-warning">
            {counts.pending} aguardando envio.
            {emailPausedUntil
              ? ` Limite diário de e-mails atingido: o envio continua sozinho depois das ${formatSessionTime(emailPausedUntil)}.`
              : " Saem sozinhos depois das 21h, ou clique em Continuar envio."}
          </p>
        ) : null}
        {counts.failed > 0 ? (
          <p className="text-sm text-byla-danger">{counts.failed} não saíram depois de 3 tentativas.</p>
        ) : null}
      </div>
      {counts.pending > 0 || counts.failed > 0 ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {counts.pending > 0 ? (
            <Button
              disabled={Boolean(emailPausedUntil)}
              loading={isPending}
              loadingLabel={`Enviando… ${counts.sent} de ${counts.total}`}
              onClick={() => run("continue")}
              variant="secondary"
            >
              Continuar envio
            </Button>
          ) : null}
          {counts.failed > 0 ? (
            <Button disabled={isPending} onClick={() => run("retry")} variant="secondary">
              Tentar de novo
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </li>
  );
}
