import { randomBytes, randomInt } from "node:crypto";

/** Código vale 10 minutos (conferido no banco); aqui só para os textos. */
export const LOGIN_CODE_TTL_MINUTES = 10;
/** Código do cadastro de organizador (convite) vale 15 minutos, também conferido no banco. */
export const SIGNUP_CODE_TTL_MINUTES = 15;
export const LOGIN_CODE_RESEND_SECONDS = 60;
/** Nome e caminho do cookie do aparelho lembrado ficam em `AREAS` (`@/lib/auth/area`). */
export const DEVICE_REMEMBER_DAYS = 30;

const MAX_INPUT_LENGTH = 40;
const MAX_LABEL_LENGTH = 60;

/** 6 dígitos de gerador criptográfico, com zeros à esquerda. */
export function generateLoginCode(next: () => number = () => randomInt(0, 1_000_000)): string {
  return String(next()).padStart(6, "0");
}

/** Aceita espaços, traços e pontos colados junto; devolve null se não forem 6 números. */
export function normalizeLoginCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_INPUT_LENGTH) return null;
  const digits = value.replace(/[\s.-]/g, "");
  return /^[0-9]{6}$/.test(digits) ? digits : null;
}

function maskPart(part: string): string {
  return `${part.slice(0, part.length > 2 ? 2 : 1)}***`;
}

/** "fu***@ex***.com": suficiente para a pessoa reconhecer o próprio e-mail. */
export function maskEmail(email: string | null | undefined): string {
  const value = email?.trim().toLowerCase() ?? "";
  const at = value.lastIndexOf("@");
  if (at < 1) return "seu e-mail";
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return "seu e-mail";
  return `${maskPart(local)}@${maskPart(labels[0])}.${labels[labels.length - 1]}`;
}

const BROWSERS: [RegExp, string][] = [
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/CrOS/, "Chromebook"],
  [/Linux/, "Linux"],
];

/** Nome curto do aparelho lembrado ("Chrome no Android"); nunca guarda o user-agent inteiro. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  if (!browser && !system) return "Navegador";
  const label = browser && system ? `${browser} no ${system}` : (browser ?? `Navegador no ${system}`);
  return label.slice(0, MAX_LABEL_LENGTH);
}

/** Token do aparelho lembrado: 32 bytes aleatórios. O banco guarda só o hash. */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function secondsUntil(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - now.getTime()) / 1000));
}
