// Usado no navegador (página /convite lê o token do #): sem node:crypto aqui.
export const INVITE_PATH = "/convite";
export const PASSWORD_RESET_PATH = "/redefinir-senha";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteTokenFormat(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function inviteTokenFromHash(hash: string): string | null {
  let token = hash.startsWith("#") ? hash.slice(1) : hash;
  // Aceita #token=<valor> (pedido self-service) e #<valor> (link do Admin).
  if (token.startsWith("token=")) token = token.slice("token=".length);
  return isInviteTokenFormat(token) ? token : null;
}
