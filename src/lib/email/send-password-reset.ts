import "server-only";

import { alertTeamSetup } from "@/lib/alerts/team-alert";
import { buildPasswordResetEmail } from "@/lib/email/password-reset-template";
import { parseDailyQuota } from "@/lib/notices/rules";
import { createAdminClient } from "@/lib/supabase/admin";

export type SendPasswordResetResult = "sent" | "quota" | "failed" | "skipped";

const SEND_TIMEOUT_MS = 8000;
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

async function alertPasswordResetDeliveryFailure(
  status: number | "skipped" | "timeout" | "network",
  errorName: string | null,
): Promise<void> {
  try {
    const detail =
      status === "skipped"
        ? "E-mail de nova senha não enviado: falta configurar o serviço de e-mail."
        : status === "timeout"
          ? `O envio do link de nova senha estourou o tempo${errorName ? ` (${errorName})` : ""}.`
          : status === "network"
            ? `O envio do link de nova senha falhou na rede${errorName ? ` (${errorName})` : ""}.`
            : `O envio do link de nova senha falhou (status ${status}${errorName ? `, ${errorName}` : ""}).`;
    await alertTeamSetup(createAdminClient(), "senha_email_falhou", detail);
  } catch (error) {
    const kind = error instanceof Error ? error.name : "desconhecido";
    console.error(`[nova-senha] Falha ao alertar a equipe (${kind}).`);
  }
}

function isTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

/** Envia o link de nova senha. Logs nunca levam e-mail, token ou link. */
export async function sendPasswordResetEmail({
  to,
  link,
}: {
  to: string;
  link: string;
}): Promise<SendPasswordResetResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[nova-senha] E-mail não enviado: configure RESEND_API_KEY e RESEND_FROM_EMAIL.");
    await alertPasswordResetDeliveryFailure("skipped", null);
    return "skipped";
  }

  try {
    const { subject, html, text } = buildPasswordResetEmail({ link });
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
      console.error("[nova-senha] Limite diário de e-mails atingido; link não enviado.", {
        status: response.status,
        name: errorName,
      });
      await alertPasswordResetDeliveryFailure(response.status, errorName);
      return "quota";
    }
    if (!response.ok) {
      console.error("[nova-senha] Serviço de e-mail recusou o link.", {
        status: response.status,
        name: errorName,
      });
      // 4xx de config, 5xx e demais falhas: alerta (dedupe 24 h no alertTeamSetup).
      await alertPasswordResetDeliveryFailure(response.status, errorName);
      return "failed";
    }

    const used = parseDailyQuota(response.headers.get("x-resend-daily-quota"));
    if (used !== null && used >= QUOTA_WARNING_AT) {
      console.warn(`[nova-senha] Uso de e-mails hoje: ${used} de 100.`);
    }
    return "sent";
  } catch (error) {
    const kind = error instanceof Error ? error.name : "desconhecido";
    console.error(`[nova-senha] Falha ao enviar o link (${kind}).`);
    if (isTimeoutError(error)) {
      await alertPasswordResetDeliveryFailure("timeout", kind);
    } else {
      await alertPasswordResetDeliveryFailure("network", kind);
    }
    return "failed";
  }
}
