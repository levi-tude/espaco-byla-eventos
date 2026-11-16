import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResendTicketsStatus } from "@/components/tickets/ResendTicketsControl";

import {
  RESEND_TICKETS_DAILY_LIMITED,
  RESEND_TICKETS_FALLBACK,
  RESEND_TICKETS_RATE_LIMITED,
  RESEND_TICKETS_SENT,
} from "@/lib/email/resend-order-tickets-messages";
import {
  RESEND_ERROR_HOLD_MS,
  RESEND_RATE_LIMIT_HOLD_MS,
  RESEND_SUCCESS_HOLD_MS,
  RESEND_TICKETS_IDLE_LABEL,
  RESEND_TICKETS_PENDING_LABEL,
  RESEND_TICKETS_SUCCESS_LABEL,
  RESEND_TICKETS_WAIT_LABEL,
  clearExpiredResendTicketsFeedback,
  feedbackFromResendResult,
  getResendTicketsFeedbackSnapshot,
  remainingResendHoldMs,
  resendTicketsButtonDisabled,
  resendTicketsButtonLabel,
  resetResendTicketsFeedbackForTests,
  setResendTicketsFeedback,
  subscribeResendTicketsFeedback,
} from "@/lib/email/resend-tickets-feedback";

const ORDER_A = "00000000-0000-4000-8000-000000000010";
const ORDER_B = "00000000-0000-4000-8000-000000000011";

afterEach(() => {
  resetResendTicketsFeedbackForTests();
});

describe("feedbackFromResendResult", () => {
  it("sucesso fica em Reenviado ✓ por alguns segundos", () => {
    const now = 1_000;
    expect(feedbackFromResendResult(true, undefined, now)).toEqual({
      kind: "success",
      text: RESEND_TICKETS_SENT,
      startedAt: now,
      holdMs: RESEND_SUCCESS_HOLD_MS,
    });
    expect(RESEND_SUCCESS_HOLD_MS).toBe(8_000);
  });

  it("limite de 2 minutos troca o botão para Aguarde para reenviar", () => {
    const now = 1_000;
    const feedback = feedbackFromResendResult(false, RESEND_TICKETS_RATE_LIMITED, now);
    expect(feedback).toEqual({
      kind: "rate-limited",
      text: RESEND_TICKETS_RATE_LIMITED,
      startedAt: now,
      holdMs: RESEND_RATE_LIMIT_HOLD_MS,
    });
    expect(resendTicketsButtonLabel({ pending: false, feedback })).toBe(RESEND_TICKETS_WAIT_LABEL);
    expect(resendTicketsButtonDisabled({ pending: false, feedback })).toBe(true);
    expect(RESEND_RATE_LIMIT_HOLD_MS).toBe(120_000);
  });

  it("erro comum e teto diário não bloqueiam o botão como o intervalo de 2 minutos", () => {
    const error = feedbackFromResendResult(false, "Falha de rede.", 1_000);
    expect(error).toMatchObject({ kind: "error", text: "Falha de rede.", holdMs: RESEND_ERROR_HOLD_MS });
    expect(resendTicketsButtonDisabled({ pending: false, feedback: error })).toBe(false);
    expect(resendTicketsButtonLabel({ pending: false, feedback: error })).toBe(RESEND_TICKETS_IDLE_LABEL);

    const daily = feedbackFromResendResult(false, RESEND_TICKETS_DAILY_LIMITED, 1_000);
    expect(daily.kind).toBe("error");
    expect(resendTicketsButtonDisabled({ pending: false, feedback: daily })).toBe(false);
  });

  it("sem mensagem usa o texto genérico", () => {
    expect(feedbackFromResendResult(false, undefined, 1_000).text).toBe(RESEND_TICKETS_FALLBACK);
  });
});

describe("rótulos do botão", () => {
  const success = feedbackFromResendResult(true, undefined, 0);

  it("pendente tem prioridade sobre o estado anterior", () => {
    expect(resendTicketsButtonLabel({ pending: true, feedback: success })).toBe(RESEND_TICKETS_PENDING_LABEL);
    expect(resendTicketsButtonDisabled({ pending: true, feedback: null })).toBe(true);
  });

  it("sucesso mostra Reenviado ✓ e desabilita", () => {
    expect(resendTicketsButtonLabel({ pending: false, feedback: success })).toBe(RESEND_TICKETS_SUCCESS_LABEL);
    expect(resendTicketsButtonDisabled({ pending: false, feedback: success })).toBe(true);
  });

  it("sem estado volta ao rótulo inicial", () => {
    expect(resendTicketsButtonLabel({ pending: false, feedback: null })).toBe(RESEND_TICKETS_IDLE_LABEL);
    expect(resendTicketsButtonDisabled({ pending: false, feedback: null })).toBe(false);
  });
});

describe("mapa de feedback por pedido", () => {
  it("guarda o estado por pedido e sobrevive a um 'remount' (refresh de 30 s)", () => {
    const feedback = feedbackFromResendResult(true, undefined, 5_000);
    setResendTicketsFeedback(ORDER_A, feedback);
    expect(getResendTicketsFeedbackSnapshot(ORDER_A)).toEqual(feedback);
    expect(getResendTicketsFeedbackSnapshot(ORDER_B)).toBeNull();
  });

  it("avisa assinantes e apaga só o que já venceu", () => {
    const listener = vi.fn();
    const stop = subscribeResendTicketsFeedback(listener);
    setResendTicketsFeedback(ORDER_A, feedbackFromResendResult(true, undefined, 0));
    setResendTicketsFeedback(ORDER_B, feedbackFromResendResult(false, RESEND_TICKETS_RATE_LIMITED, 0));
    expect(listener).toHaveBeenCalledTimes(2);

    clearExpiredResendTicketsFeedback(RESEND_SUCCESS_HOLD_MS);
    expect(getResendTicketsFeedbackSnapshot(ORDER_A)).toBeNull();
    expect(getResendTicketsFeedbackSnapshot(ORDER_B)).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    clearExpiredResendTicketsFeedback(RESEND_RATE_LIMIT_HOLD_MS);
    expect(getResendTicketsFeedbackSnapshot(ORDER_B)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("calcula o tempo restante do aviso", () => {
    const feedback = feedbackFromResendResult(true, undefined, 1_000);
    expect(remainingResendHoldMs(feedback, 1_000)).toBe(RESEND_SUCCESS_HOLD_MS);
    expect(remainingResendHoldMs(feedback, 1_000 + RESEND_SUCCESS_HOLD_MS + 10)).toBe(0);
  });
});

describe("ResendTicketsStatus", () => {
  it("mostra o aviso no próprio botão, com aria-live polite", () => {
    const html = renderToStaticMarkup(
      createElement(ResendTicketsStatus, { ok: true, text: RESEND_TICKETS_SENT }),
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(RESEND_TICKETS_SENT);
    expect(html).toContain("text-byla-success");
  });

  it("erro usa o tom de perigo", () => {
    const html = renderToStaticMarkup(
      createElement(ResendTicketsStatus, { ok: false, text: RESEND_TICKETS_RATE_LIMITED }),
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(RESEND_TICKETS_RATE_LIMITED);
    expect(html).toContain("text-byla-danger");
  });
});
