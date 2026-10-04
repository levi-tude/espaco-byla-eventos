import type { NoticeSendResult } from "@/app/equipe/eventos/session-actions";
import { continueSessionNotices } from "@/app/equipe/eventos/session-actions";
import type { ActionResult } from "@/lib/action-result";
import { formatSessionTime } from "@/lib/datetime";

/** Lotes por clique: com 10 e-mails cada, cobre uma sessão inteira (~100 pedidos). */
const MAX_BATCHES = 12;

/**
 * Envia o primeiro lote e continua enquanto houver pendentes, a fila não estiver
 * pausada pelo limite diário e cada lote fizer progresso.
 */
export async function sendAllNoticeBatches(
  first: () => Promise<ActionResult<NoticeSendResult>>,
  onProgress: (progress: NoticeSendResult) => void,
): Promise<ActionResult<NoticeSendResult>> {
  let result = await first();
  for (let batch = 1; batch < MAX_BATCHES; batch += 1) {
    if (!result.ok) return result;
    onProgress(result.data);
    if (result.data.pending === 0 || result.data.pausedUntil) return result;
    const done = result.data.sent + result.data.failed + result.data.skipped;
    result = await continueSessionNotices(result.data.noticeId);
    if (result.ok && result.data.sent + result.data.failed + result.data.skipped === done) return result;
  }
  return result;
}

/** Resumo para a equipe depois de um envio. */
export function noticeSendMessage(progress: NoticeSendResult): string {
  const parts = [`Enviados ${progress.sent} de ${progress.total}.`];
  if (progress.pending > 0) {
    parts.push(
      progress.pausedUntil
        ? `Os ${progress.pending} restantes serão enviados sozinhos depois das ${formatSessionTime(progress.pausedUntil)}, quando o limite diário de e-mails renova.`
        : `${progress.pending} ainda na fila: clique em Continuar envio.`,
    );
  }
  if (progress.failed > 0) parts.push(`${progress.failed} não saíram: use Tentar de novo.`);
  return parts.join(" ");
}
