import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RateLimitRule = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  checkoutPerIp: { bucket: "checkout:ip", limit: 10, windowSeconds: 600 },
  checkoutPerEmail: { bucket: "checkout:email", limit: 5, windowSeconds: 3600 },
  paymentPerOrder: { bucket: "payment:order", limit: 6, windowSeconds: 1800 },
  paymentPerIp: { bucket: "payment:ip", limit: 20, windowSeconds: 600 },
  selectionChangePerOrder: { bucket: "selection:order", limit: 5, windowSeconds: 1800 },
  selectionChangePerIp: { bucket: "selection:ip", limit: 20, windowSeconds: 600 },
  reminderOptoutPerIp: { bucket: "reminder-optout:ip", limit: 30, windowSeconds: 600 },
  sessionNoticesPerStaff: { bucket: "session-notices:staff", limit: 60, windowSeconds: 600 },
  sessionCancelPerStaff: { bucket: "session-cancel:staff", limit: 10, windowSeconds: 600 },
  refundBatchPerBatch: { bucket: "refund-batch:batch", limit: 60, windowSeconds: 60 },
  organizerRequestPerIp: { bucket: "org-request:ip", limit: 3, windowSeconds: 3600 },
  inviteCheckPerIp: { bucket: "invite-check:ip", limit: 20, windowSeconds: 3600 },
  inviteCodePerIp: { bucket: "invite-code:ip", limit: 10, windowSeconds: 3600 },
  inviteCompletePerIp: { bucket: "invite-complete:ip", limit: 10, windowSeconds: 3600 },
  passwordResetPerIp: { bucket: "password-reset:ip", limit: 10, windowSeconds: 3600 },
  organizerSavePerUser: { bucket: "org-save:user", limit: 120, windowSeconds: 3600 },
  organizerUploadPerUser: { bucket: "org-upload:user", limit: 60, windowSeconds: 3600 },
  organizerUploadPerUserDay: { bucket: "org-upload:user-day", limit: 20, windowSeconds: 86_400 },
  organizerUploadSiteDay: { bucket: "org-upload:all-day", limit: 150, windowSeconds: 86_400 },
  organizerSubmitPerUser: { bucket: "org-submit:user", limit: 10, windowSeconds: 3600 },
  /** Avisos da área do organizador: teto próprio para sobrar cota para os ingressos. */
  organizerNoticeEmailPerDay: { bucket: "email-org:day", limit: 10, windowSeconds: 86_400 },
  organizerSignupNotice: { bucket: "org-notice:signup", limit: 1, windowSeconds: 21_600 },
  organizerSubmitNotice: { bucket: "org-notice:submit", limit: 1, windowSeconds: 21_600 },
} as const satisfies Record<string, RateLimitRule>;

export const RATE_LIMIT_MESSAGE =
  "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

/** Nunca guardamos IP, e-mail ou id em claro na tabela de limites. */
export function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(`byla-rate-limit:${value}`).digest("hex");
}

const UNKNOWN_IP = "desconhecido";

/**
 * Cabeçalho que a hospedagem preenche com o IP real (o cliente não consegue
 * sobrescrever). Cada hospedagem usa um: ver docs/superpowers/plans/2026-10-07-sair-da-vercel.md.
 */
const TRUSTED_IP_MODES = [
  "x-real-ip",
  "x-nf-client-connection-ip",
  "cf-connecting-ip",
  "x-forwarded-for-first",
  "x-forwarded-for-last",
] as const;
type TrustedIpMode = (typeof TRUSTED_IP_MODES)[number];
const DEFAULT_IP_MODE: TrustedIpMode = "x-real-ip";
let warnedInvalidMode = false;

function parseIpMode(raw: string | undefined): TrustedIpMode {
  const mode = raw?.trim().toLowerCase();
  if (!mode) return DEFAULT_IP_MODE;
  if ((TRUSTED_IP_MODES as readonly string[]).includes(mode)) return mode as TrustedIpMode;
  if (!warnedInvalidMode) {
    warnedInvalidMode = true;
    console.warn(`[seguranca] TRUSTED_IP_HEADER inválido; usando ${DEFAULT_IP_MODE}.`);
  }
  return DEFAULT_IP_MODE;
}

function sanitizeIp(value: string | undefined | null): string {
  const ip = value?.trim() ?? "";
  return ip.length > 0 && ip.length <= 45 && /^[0-9a-f:.]+$/i.test(ip) ? ip : UNKNOWN_IP;
}

/** Lê só o cabeçalho configurado; nunca cai para outro que o cliente possa falsificar. */
export function resolveClientIp(requestHeaders: Headers, rawMode: string | undefined): string {
  const mode = parseIpMode(rawMode);
  if (mode === "x-forwarded-for-first" || mode === "x-forwarded-for-last") {
    const hops = (requestHeaders.get("x-forwarded-for") ?? "").split(",");
    return sanitizeIp(mode === "x-forwarded-for-first" ? hops[0] : hops[hops.length - 1]);
  }
  return sanitizeIp(requestHeaders.get(mode));
}

export async function clientIp(): Promise<string> {
  return resolveClientIp(await headers(), process.env.TRUSTED_IP_HEADER);
}

export type RateLimitOutcome = "allowed" | "limited" | "error";

/** Registra a tentativa e diz se ela está dentro do limite, separando falha do banco. */
export async function tryConsumeRateLimit(
  admin: AdminClient,
  rule: RateLimitRule,
  key: string,
): Promise<RateLimitOutcome> {
  try {
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket: rule.bucket,
      p_key_hash: hashRateLimitKey(key),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error("[seguranca] Falha ao consultar limite de tentativas.", error);
      return "error";
    }
    return data === true ? "allowed" : "limited";
  } catch (error) {
    console.error("[seguranca] Falha ao consultar limite de tentativas.", error);
    return "error";
  }
}

/** Registra a tentativa e diz se ela está dentro do limite. Falha fechada. */
export async function consumeRateLimit(
  admin: AdminClient,
  rule: RateLimitRule,
  key: string,
): Promise<boolean> {
  return (await tryConsumeRateLimit(admin, rule, key)) === "allowed";
}

/** Apaga os registros da chave (ex.: o envio que a tentativa protegia falhou). Nunca lança. */
export async function releaseRateLimit(
  admin: AdminClient,
  rule: RateLimitRule,
  key: string,
): Promise<boolean> {
  try {
    const { error } = await admin
      .from("rate_limit_hits")
      .delete()
      .eq("bucket", rule.bucket)
      .eq("key_hash", hashRateLimitKey(key));
    if (error) {
      console.error("[seguranca] Falha ao liberar limite de tentativas.", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[seguranca] Falha ao liberar limite de tentativas.", error);
    return false;
  }
}
