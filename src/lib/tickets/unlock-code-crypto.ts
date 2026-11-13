import { createHash, createHmac } from "node:crypto";

/**
 * Hash do código de acesso e chave do cookie de liberação.
 *
 * O código vira HMAC-SHA256 com um segredo só do servidor (`UNLOCK_CODE_SECRET`):
 * sem o segredo, quem lesse o hash no banco não conseguiria testar códigos em massa
 * (o SHA-256 puro de antes cai rápido por força bruta em códigos curtos).
 * O cookie usa uma chave derivada do mesmo segredo, nunca a chave do service_role.
 */

/** Mínimo de 32 caracteres (ex.: `openssl rand -base64 48`). */
export const UNLOCK_CODE_SECRET_MIN_LENGTH = 32;

const CODE_CONTEXT = "acdh-unlock-code:v1:";
const COOKIE_CONTEXT = "acdh-unlock-cookie:v1";

export function unlockCodeSecret(): string | null {
  const secret = process.env.UNLOCK_CODE_SECRET?.trim();
  return secret && secret.length >= UNLOCK_CODE_SECRET_MIN_LENGTH ? secret : null;
}

/** HMAC-SHA256 (hex) do código normalizado; `null` sem segredo configurado. */
export function hashUnlockCode(code: string): string | null {
  const secret = unlockCodeSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(CODE_CONTEXT + code, "utf8").digest("hex");
}

/**
 * Formato antigo (SHA-256 sem segredo). Só para reconhecer códigos salvos antes do
 * HMAC; o próximo "Novo código" salvo no editor grava no formato novo.
 */
export function legacyUnlockCodeHash(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Hashes aceitos para um código digitado: o novo (se houver segredo) e o antigo. */
export function unlockCodeHashCandidates(code: string): string[] {
  const current = hashUnlockCode(code);
  const legacy = legacyUnlockCodeHash(code);
  return current ? [current, legacy] : [legacy];
}

/** Chave HMAC do cookie, derivada do segredo (separada do hash do código). */
export function unlockCookieKey(): Buffer | null {
  const secret = unlockCodeSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(COOKIE_CONTEXT, "utf8").digest();
}
