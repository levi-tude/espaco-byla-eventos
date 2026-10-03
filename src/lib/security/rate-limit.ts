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
} as const satisfies Record<string, RateLimitRule>;

export const RATE_LIMIT_MESSAGE =
  "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

/** Nunca guardamos IP, e-mail ou id em claro na tabela de limites. */
export function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(`byla-rate-limit:${value}`).digest("hex");
}

/** Na Vercel, x-real-ip / x-forwarded-for são definidos pela plataforma (não pelo cliente). */
export async function clientIp(): Promise<string> {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("x-real-ip") ??
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "desconhecido"
  );
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
