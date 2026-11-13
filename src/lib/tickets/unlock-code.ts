import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import {
  normalizeUnlockCodePlaintext,
  UNLOCK_CODE_MAX_LENGTH,
  UNLOCK_CODE_MIN_LENGTH,
} from "@/lib/tickets/unlock-code-hash";

/** Cookie HttpOnly: eventId + hash do código + validade, assinado. */
export const TICKET_UNLOCK_COOKIE = "byla_ticket_unlock";
export const TICKET_UNLOCK_TTL_SECONDS = 2 * 60 * 60;
export { UNLOCK_CODE_MAX_LENGTH, UNLOCK_CODE_MIN_LENGTH };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function normalizeUnlockCode(raw: unknown): string | null {
  return normalizeUnlockCodePlaintext(raw);
}

export function hashUnlockCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function signingSecret(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key && key.length >= 16 ? key : null;
}

function sign(payload: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type UnlockCookiePayload = {
  eventId: string;
  codeHash: string;
  exp: number;
};

/** Monta o valor do cookie (sem gravar). */
export function buildUnlockCookieValue(
  eventId: string,
  codeHash: string,
  now = Date.now(),
): string | null {
  if (!UUID_PATTERN.test(eventId) || !HASH_PATTERN.test(codeHash)) return null;
  const exp = Math.floor(now / 1000) + TICKET_UNLOCK_TTL_SECONDS;
  const payload = `${eventId}.${codeHash}.${exp}`;
  const signature = sign(payload);
  if (!signature) return null;
  return `${payload}.${signature}`;
}

export function parseUnlockCookieValue(
  raw: string | undefined,
  now = Date.now(),
): UnlockCookiePayload | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [eventId, codeHash, expRaw, signature] = parts;
  if (!UUID_PATTERN.test(eventId) || !HASH_PATTERN.test(codeHash)) return null;
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
  const payload = `${eventId}.${codeHash}.${exp}`;
  const expected = sign(payload);
  if (!expected || !safeEqual(signature, expected)) return null;
  return { eventId, codeHash, exp };
}

export async function readUnlockCookie(
  eventId: string,
): Promise<UnlockCookiePayload | null> {
  const jar = await cookies();
  const parsed = parseUnlockCookieValue(jar.get(TICKET_UNLOCK_COOKIE)?.value);
  if (!parsed || parsed.eventId !== eventId) return null;
  return parsed;
}

export async function writeUnlockCookie(eventId: string, codeHash: string): Promise<boolean> {
  const value = buildUnlockCookieValue(eventId, codeHash);
  if (!value) return false;
  const jar = await cookies();
  jar.set(TICKET_UNLOCK_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TICKET_UNLOCK_TTL_SECONDS,
  });
  return true;
}

/** Tipos restritos liberados por este hash (lista de ids). */
export function unlockedTypeIds(
  types: readonly { id: string; unlock_code_hash: string | null }[],
  codeHash: string,
): Set<string> {
  return new Set(
    types.filter((type) => type.unlock_code_hash === codeHash).map((type) => type.id),
  );
}
