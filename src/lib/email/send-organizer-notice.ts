import "server-only";

import type { OrganizerNoticeContent } from "@/lib/email/organizer-notice-template";
import { parseDailyQuota } from "@/lib/notices/rules";
import { RATE_LIMITS, tryConsumeRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * `capped`: teto de 10 avisos por dia atingido, nada foi enviado (o painel mostra tudo).
 * `skipped`: falta configuração ou destinatário.
 */
export type SendOrganizerNoticeResult = "sent" | "capped" | "skipped" | "failed";

const SEND_TIMEOUT_MS = 8000;
/** Acima disso, o log avisa que o limite diário do plano gratuito (100) está perto. */
const QUOTA_WARNING_AT = 90;
const EMAIL_PATTERN = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;

async function isDailyQuotaError(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    return /(daily|monthly)_quota_exceeded/.test((await response.text()).slice(0, 2000));
  } catch {
    return false;
  }
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : "desconhecido";
}

/**
 * Consome o teto próprio (`email-org:day`, 10 por dia no site) antes de enviar; se o
 * banco não responde, não envia, para não gastar a cota dos ingressos. Nunca lança e
 * o log nunca leva o endereço.
 */
export async function sendOrganizerNotice(
  to: string,
  content: OrganizerNoticeContent,
  admin?: AdminClient,
): Promise<SendOrganizerNoticeResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[aviso-organizador] E-mail não enviado: configure RESEND_API_KEY e RESEND_FROM_EMAIL.");
    return "skipped";
  }
  if (!EMAIL_PATTERN.test(to)) {
    console.warn("[aviso-organizador] E-mail não enviado: destinatário inválido.");
    return "skipped";
  }

  try {
    const cap = await tryConsumeRateLimit(admin ?? createAdminClient(), RATE_LIMITS.organizerNoticeEmailPerDay, "site");
    if (cap === "limited") {
      console.warn("[aviso-organizador] Teto de 10 avisos por dia atingido; o aviso fica só no painel.");
      return "capped";
    }
    if (cap === "error") {
      console.error("[aviso-organizador] Não foi possível conferir o teto diário; aviso não enviado.");
      return "failed";
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (await isDailyQuotaError(response)) {
      console.error("[aviso-organizador] Limite diário de e-mails atingido; aviso não enviado.");
      return "failed";
    }
    if (!response.ok) {
      console.error(`[aviso-organizador] Serviço de e-mail recusou o aviso (${response.status}).`);
      return "failed";
    }

    const used = parseDailyQuota(response.headers.get("x-resend-daily-quota"));
    if (used !== null && used >= QUOTA_WARNING_AT) {
      console.warn(`[aviso-organizador] Uso de e-mails hoje: ${used} de 100.`);
    }
    return "sent";
  } catch (error) {
    console.error(`[aviso-organizador] Falha ao enviar o aviso (${errorKind(error)}).`);
    return "failed";
  }
}
