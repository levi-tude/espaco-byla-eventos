/** Validação do código de ingresso (sem crypto — hash só no servidor). */

export const UNLOCK_CODE_MIN_LENGTH = 6;
export const UNLOCK_CODE_MAX_LENGTH = 64;

export function normalizeUnlockCodePlaintext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (code.length < UNLOCK_CODE_MIN_LENGTH || code.length > UNLOCK_CODE_MAX_LENGTH) {
    return null;
  }
  return code;
}
