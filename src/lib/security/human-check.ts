/** Usado no navegador e no servidor: nada secreto aqui. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/** O token só vale para a ação em que foi gerado. */
export type HumanCheckAction = "checkout" | "payment";

/** Tamanho máximo de token aceito pelo serviço. */
export const HUMAN_TOKEN_MAX_LENGTH = 2048;
