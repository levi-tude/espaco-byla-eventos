import "server-only";

import type { ReminderEmailContent } from "@/lib/email/reminder-template";

export type ReminderEmailConfig = { apiKey: string; from: string; appUrl: string };

export function reminderEmailConfig(): ReminderEmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!apiKey || !from || !appUrl) return null;
  return { apiKey, from, appUrl };
}

export type SendReminderEmailInput = {
  config: ReminderEmailConfig;
  to: string;
  content: ReminderEmailContent;
  /** Endereço do descadastro com um clique (POST feito pelo próprio programa de e-mail). */
  oneClickUnsubscribeUrl: string;
  /** Mesmo pedido, mesma chave: o serviço de e-mail não repete o envio em 24 h. */
  idempotencyKey: string;
};

export type SendReminderEmailResult = "sent" | "failed";

const SEND_TIMEOUT_MS = 8000;

export async function sendReminderEmail({
  config,
  to,
  content,
  oneClickUnsubscribeUrl,
  idempotencyKey,
}: SendReminderEmailInput): Promise<SendReminderEmailResult> {
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
        headers: {
          "List-Unsubscribe": `<${oneClickUnsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[lembrete] Serviço de e-mail recusou o lembrete (${response.status}).`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("[lembrete] Falha ao enviar o lembrete.", error);
    return "failed";
  }
}
