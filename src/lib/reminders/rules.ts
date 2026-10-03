/**
 * O plano grátis de e-mail permite 100 envios/dia somando ingressos, lembretes
 * e alertas. Ingressos têm prioridade, então os lembretes ficam bem abaixo disso.
 */
export const REMINDER_BATCH_SIZE = 5;
export const REMINDER_DAILY_CAP = 30;

/** Pausa entre envios para respeitar o limite de requisições por segundo do serviço de e-mail. */
export const REMINDER_SEND_INTERVAL_MS = 600;

/**
 * Primeira versão da Política de Privacidade que avisa sobre o lembrete. Não
 * acompanha versões futuras: quem aceitou esta ou uma mais nova pode receber.
 */
export const REMINDER_MIN_POLICY_VERSION = "2026-10-03";

const OPTOUT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Formato do token do link "Não quero receber lembretes" (gerado no banco). */
export function isReminderOptoutToken(value: unknown): value is string {
  return typeof value === "string" && OPTOUT_TOKEN_PATTERN.test(value);
}
