import { createHash, randomBytes } from "node:crypto";
import { INVITE_PATH, PASSWORD_RESET_PATH } from "@/lib/organizer/invite-token-format";

export {
  INVITE_PATH,
  PASSWORD_RESET_PATH,
  inviteTokenFromHash,
  isInviteTokenFormat,
} from "@/lib/organizer/invite-token-format";

/** 32 bytes aleatórios. O banco guarda só o hash; o link aparece uma vez para o Admin. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteLink(appUrl: string, token: string, kind: "convite" | "redefinir_senha"): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}${kind === "convite" ? INVITE_PATH : PASSWORD_RESET_PATH}#${token}`;
}

export function whatsappInviteUrl(link: string): string {
  const text =
    "Olá! Este é o seu convite para criar eventos no site do ACDH Eventos. " +
    `O link vale por 7 dias e só pode ser usado uma vez: ${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
