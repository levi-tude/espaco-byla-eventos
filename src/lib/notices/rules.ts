/**
 * O plano grátis de e-mail permite 100 envios/dia somando ingressos, lembretes e
 * alertas, e renova à 00h UTC (21h em Brasília). Os avisos de sessão param em 80
 * para sobrar espaço para ingressos e alertas.
 */
export const NOTICE_DAILY_SOFT_CAP = 80;

/** Envios por clique na tela (cabe com folga no tempo de uma ação). */
export const NOTICE_BATCH_SIZE = 10;

/** Envios por execução do agendador (diário ou de 15 em 15 min). */
export const NOTICE_CRON_LIMIT = 40;

/** Pausa entre envios para respeitar o limite de requisições por segundo do serviço de e-mail. */
export const NOTICE_SEND_INTERVAL_MS = 600;

/** Próxima renovação do limite diário de e-mails (00h UTC). */
export function nextQuotaReset(now: number = Date.now()): string {
  const date = new Date(now);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  ).toISOString();
}

/** Uso do dia informado pelo serviço de e-mail (`x-resend-daily-quota`); `null` se ausente ou inválido. */
export function parseDailyQuota(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,6}$/.test(value.trim())) return null;
  return Number(value.trim());
}
