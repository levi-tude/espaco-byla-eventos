import "server-only";

import type { SessionNoticeEmailContent } from "@/lib/email/session-notice-template";
import { parseDailyQuota } from "@/lib/notices/rules";

export type SessionNoticeEmailConfig = {
  apiKey: string;
  from: string;
  appUrl: string;
  /** Respostas vão para o contato do Espaço (mesmo da Política de Privacidade). */
  replyTo: string | null;
};

const EMAIL_PATTERN = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;

export function sessionNoticeEmailConfig(): SessionNoticeEmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!apiKey || !from || !appUrl) return null;
  const contact = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  return { apiKey, from, appUrl, replyTo: contact && EMAIL_PATTERN.test(contact) ? contact : null };
}

export type SendSessionNoticeInput = {
  config: SessionNoticeEmailConfig;
  to: string;
  content: SessionNoticeEmailContent;
  /** Mesma entrega, mesma chave: o serviço de e-mail não repete o envio em 24 h. */
  idempotencyKey: string;
};

/**
 * `quotaUsed`: e-mails já enviados hoje segundo o serviço (`null` se não informou).
 * `quota`: limite diário estourado, nada foi enviado.
 */
export type SendSessionNoticeResult =
  | { status: "sent"; quotaUsed: number | null }
  | { status: "quota" }
  | { status: "failed" };

const SEND_TIMEOUT_MS = 8000;

async function isDailyQuotaError(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    return /(daily|monthly)_quota_exceeded/.test((await response.text()).slice(0, 2000));
  } catch {
    return false;
  }
}

export async function sendSessionNoticeEmail({
  config,
  to,
  content,
  idempotencyKey,
}: SendSessionNoticeInput): Promise<SendSessionNoticeResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (await isDailyQuotaError(response)) {
      console.warn("[aviso-sessao] Limite diário de e-mails atingido; o restante sai depois.");
      return { status: "quota" };
    }
    if (!response.ok) {
      console.error(`[aviso-sessao] Serviço de e-mail recusou o aviso (${response.status}).`);
      return { status: "failed" };
    }
    return { status: "sent", quotaUsed: parseDailyQuota(response.headers.get("x-resend-daily-quota")) };
  } catch (error) {
    console.error("[aviso-sessao] Falha ao enviar o aviso.", error);
    return { status: "failed" };
  }
}
