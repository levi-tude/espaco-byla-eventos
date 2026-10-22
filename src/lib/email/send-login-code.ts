import "server-only";

import { alertTeamSetup } from "@/lib/alerts/team-alert";
import { buildLoginCodeEmail, type LoginCodePurpose } from "@/lib/email/login-code-template";
import { parseDailyQuota } from "@/lib/notices/rules";
import { createAdminClient } from "@/lib/supabase/admin";

export type SendLoginCodeResult = "sent" | "quota" | "failed" | "skipped";

const SEND_TIMEOUT_MS = 8000;
/** Acima disso, o log avisa que o limite diário do plano gratuito (100) está perto. */
const QUOTA_WARNING_AT = 90;

function parseResendErrorName(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { name?: unknown; error?: { name?: unknown } };
    const name = parsed.name ?? parsed.error?.name;
    return typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : null;
  } catch {
    return null;
  }
}

function isDailyQuotaBody(status: number, body: string): boolean {
  return status === 429 && /(daily|monthly)_quota_exceeded/.test(body.slice(0, 2000));
}

async function alertLoginCodeDeliveryFailure(status: number, errorName: string | null): Promise<void> {
  try {
    await alertTeamSetup(
      createAdminClient(),
      "codigo_email_falhou",
      `O envio do código de acesso falhou (status ${status}${errorName ? `, ${errorName}` : ""}). Quem tenta entrar vê o aviso na tela e pode pedir de novo.`,
    );
  } catch (error) {
    const kind = error instanceof Error ? error.name : "desconhecido";
    console.error(`[codigo-acesso] Falha ao alertar a equipe (${kind}).`);
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
  purpose,
}: {
  to: string;
  code: string;
  purpose: LoginCodePurpose;
}): Promise<SendLoginCodeResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[codigo-acesso] E-mail não enviado: configure RESEND_API_KEY e RESEND_FROM_EMAIL.");
    return "skipped";
  }

  try {
    const { subject, html, text } = buildLoginCodeEmail({ code, purpose });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    const body = await response.text().catch(() => "");
    const errorName = parseResendErrorName(body);

    if (isDailyQuotaBody(response.status, body)) {
      console.error("[codigo-acesso] Limite diário de e-mails atingido; código não enviado.", {
        status: response.status,
        name: errorName,
      });
      await alertLoginCodeDeliveryFailure(response.status, errorName);
      return "quota";
    }
    if (!response.ok) {
      console.error("[codigo-acesso] Serviço de e-mail recusou o código.", {
        status: response.status,
        name: errorName,
      });
      if (response.status === 401 || response.status === 403 || response.status === 422) {
        await alertLoginCodeDeliveryFailure(response.status, errorName);
      }
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
