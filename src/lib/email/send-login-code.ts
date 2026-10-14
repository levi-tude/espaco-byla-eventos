import "server-only";

import { buildLoginCodeEmail } from "@/lib/email/login-code-template";
import { parseDailyQuota } from "@/lib/notices/rules";

export type SendLoginCodeResult = "sent" | "quota" | "failed" | "skipped";

const SEND_TIMEOUT_MS = 8000;
/** Acima disso, o log avisa que o limite diário do plano gratuito (100) está perto. */
const QUOTA_WARNING_AT = 90;

async function isDailyQuotaError(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    return /(daily|monthly)_quota_exceeded/.test((await response.text()).slice(0, 2000));
  } catch {
    return false;
  }
}

/**
 * Sem teto próprio: o código é raro (aparelho lembrado na maioria dos acessos) e o
 * banco já limita a 40 por dia no site; sem ele ninguém entra. Logs nunca levam
 * código nem e-mail.
 */
export async function sendLoginCodeEmail({
  to,
  code,
}: {
  to: string;
  code: string;
}): Promise<SendLoginCodeResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[codigo-acesso] E-mail não enviado: configure RESEND_API_KEY e RESEND_FROM_EMAIL.");
    return "skipped";
  }

  try {
    const { subject, html, text } = buildLoginCodeEmail({ code });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (await isDailyQuotaError(response)) {
      console.error("[codigo-acesso] Limite diário de e-mails atingido; código não enviado.");
      return "quota";
    }
    if (!response.ok) {
      console.error(`[codigo-acesso] Serviço de e-mail recusou o código (${response.status}).`);
      return "failed";
    }

    const used = parseDailyQuota(response.headers.get("x-resend-daily-quota"));
    if (used !== null && used >= QUOTA_WARNING_AT) {
      console.warn(`[codigo-acesso] Uso de e-mails hoje: ${used} de 100.`);
    }
    return "sent";
  } catch (error) {
    const kind = error instanceof Error ? error.name : "desconhecido";
    console.error(`[codigo-acesso] Falha ao enviar o código (${kind}).`);
    return "failed";
  }
}
