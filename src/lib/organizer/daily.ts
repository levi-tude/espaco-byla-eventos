import "server-only";

import { alertTeamSetup } from "@/lib/alerts/team-alert";
import type { OrganizerNoticeData } from "@/lib/email/organizer-notice-template";
import { notifyOrganizer, notifyTeam, organizerNoticeLink } from "@/lib/organizer/notify";
import { releaseRateLimit, tryConsumeRateLimit } from "@/lib/security/rate-limit";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const SUMMARY_RULE = { bucket: "org-finance-summary:day", limit: 1, windowSeconds: 86_400 };

type Summary = NonNullable<OrganizerNoticeData["summary"]>;

function int(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Só pede atenção quando há algo a fazer; o calendário do ano seguinte é cobrado a partir de 1º/11. */
export function summaryToSend(raw: unknown): Summary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const today = typeof d.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.today) ? d.today : null;
  const calendarUntil = typeof d.calendar_until === "number" ? d.calendar_until : null;
  let calendarMissingYear: number | null = null;
  if (today && Number(today.slice(5, 7)) >= 11) {
    const next = Number(today.slice(0, 4)) + 1;
    if (calendarUntil === null || calendarUntil < next) calendarMissingYear = next;
  }
  const summary: Summary = {
    latePayouts: int(d.late_payouts),
    latePayoutsCents: int(d.late_payouts_cents),
    lateRefunds: int(d.late_refunds),
    feesPending: int(d.fees_pending_2d),
    calendarMissingYear,
  };
  const needed =
    summary.latePayouts > 0 || summary.lateRefunds > 0 || summary.feesPending > 0 || calendarMissingYear !== null;
  return needed ? summary : null;
}

async function sendRefundNotices(admin: AdminClient): Promise<number> {
  const { data, error } = await admin.rpc("refresh_organizer_balance_flags");
  if (error) {
    console.error("[repasses-diario] Falha ao atualizar as devoluções.", error.code);
    return 0;
  }
  const rows = data ?? [];
  if (rows.length === 0) return 0;

  const espacoPixKey = process.env.ORGANIZER_REFUND_PIX_KEY?.trim() || undefined;
  if (!espacoPixKey) {
    await alertTeamSetup(admin, "pix_devolucao_sem_chave", "Configure ORGANIZER_REFUND_PIX_KEY no ambiente do site.");
  }

  let sent = 0;
  for (const row of rows) {
    const result = await notifyOrganizer(row.organizer_id, "org_devolucao_pendente", {
      eventName: row.event_name,
      amountCents: row.owed_cents,
      day: row.return_due_date,
      espacoPixKey,
      link: organizerNoticeLink(`/organizador/eventos/${row.event_id}?aba=financeiro`),
    });
    // Sem envio, não marca: tenta de novo amanhã.
    if (result !== "sent") continue;
    const { error: markError } = await admin.rpc("mark_balance_flag_notified", { p_flag_id: row.flag_id });
    if (markError) console.error("[repasses-diario] Aviso enviado, mas não marcado.", markError.code);
    sent += 1;
  }
  return sent;
}

async function sendTeamSummary(admin: AdminClient): Promise<boolean> {
  const { data, error } = await admin.rpc("organizer_finance_daily_summary");
  if (error) {
    console.error("[repasses-diario] Falha ao ler o resumo.", error.code);
    return false;
  }
  const summary = summaryToSend(data);
  if (!summary) return false;

  const slot = await tryConsumeRateLimit(admin, SUMMARY_RULE, "site");
  if (slot === "limited") return false;
  const result = await notifyTeam("equipe_repasses_resumo", {
    summary,
    link: organizerNoticeLink("/equipe/repasses"),
  });
  if (result === "sent") return true;
  if (slot === "allowed") await releaseRateLimit(admin, SUMMARY_RULE, "site");
  return false;
}

/** Cron diário: avisos de devolução aos organizadores e um resumo à equipe. Nunca lança. */
export async function runOrganizerFinanceDaily(admin: AdminClient): Promise<{ devolucoes: number; resumo: boolean }> {
  let devolucoes = 0;
  let resumo = false;
  try {
    devolucoes = await sendRefundNotices(admin);
  } catch {
    console.error("[repasses-diario] Falha nos avisos de devolução.");
  }
  try {
    resumo = await sendTeamSummary(admin);
  } catch {
    console.error("[repasses-diario] Falha no resumo da equipe.");
  }
  return { devolucoes, resumo };
}
