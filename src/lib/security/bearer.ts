import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Confere `Authorization: Bearer <segredo>` em tempo constante (os hashes têm o
 * mesmo tamanho, então o tempo não revela nem o tamanho do segredo). Sem
 * segredo configurado, recusa sempre.
 */
export function bearerMatches(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(authorization.slice("Bearer ".length)), digest(secret));
}
