"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import {
  clearExpiredResendTicketsFeedback,
  feedbackFromResendResult,
  getResendTicketsFeedbackServerSnapshot,
  getResendTicketsFeedbackSnapshot,
  remainingResendHoldMs,
  resendTicketsButtonDisabled,
  resendTicketsButtonLabel,
  setResendTicketsFeedback,
  subscribeResendTicketsFeedback,
} from "@/lib/email/resend-tickets-feedback";

type ResendResult = { ok: true } | { ok: false; error: string };

type ResendTicketsControlProps = {
  orderId: string;
  send: (orderId: string) => Promise<ResendResult>;
  variant: "link" | "button";
  className?: string;
};

export function useResendTicketsAction(
  orderId: string,
  send: (orderId: string) => Promise<ResendResult>,
) {
  const [pending, startTransition] = useTransition();
  const feedback = useSyncExternalStore(
    subscribeResendTicketsFeedback,
    () => getResendTicketsFeedbackSnapshot(orderId),
    getResendTicketsFeedbackServerSnapshot,
  );

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(
      () => clearExpiredResendTicketsFeedback(),
      remainingResendHoldMs(feedback),
    );
    return () => clearTimeout(timer);
  }, [feedback]);

  function resend() {
    startTransition(async () => {
      try {
        const result = await send(orderId);
        setResendTicketsFeedback(
          orderId,
          feedbackFromResendResult(result.ok, result.ok ? undefined : result.error),
        );
      } catch {
        setResendTicketsFeedback(orderId, feedbackFromResendResult(false, undefined));
      }
    });
  }

  return {
    feedback,
    pending,
    label: resendTicketsButtonLabel({ pending, feedback }),
    disabled: resendTicketsButtonDisabled({ pending, feedback }),
    resend,
  };
}

/** Aviso compacto ao lado do botão, anunciado com aria-live. */
export function ResendTicketsStatus({
  text,
  ok,
}: {
  text: string;
  ok: boolean;
}) {
  return (
    <p
      aria-live="polite"
      className={cx("text-sm font-medium", ok ? "text-byla-success" : "text-byla-danger")}
    >
      {text}
    </p>
  );
}

/** Botão de reenvio com aviso inline (lista da equipe ou card do organizador). */
export function ResendTicketsControl({
  orderId,
  send,
  variant,
  className,
}: ResendTicketsControlProps) {
  const { feedback, pending, label, disabled, resend } = useResendTicketsAction(orderId, send);

  return (
    <div className="grid max-w-full justify-items-start gap-1">
      {variant === "button" ? (
        <Button
          className={cx("sm:w-auto", className)}
          disabled={disabled}
          fullWidth
          loading={pending}
          loadingLabel="Reenviando…"
          onClick={resend}
          variant="secondary"
        >
          {label}
        </Button>
      ) : (
        <button className={className} disabled={disabled} onClick={resend} type="button">
          {label}
        </button>
      )}
      {feedback ? <ResendTicketsStatus ok={feedback.kind === "success"} text={feedback.text} /> : null}
    </div>
  );
}
