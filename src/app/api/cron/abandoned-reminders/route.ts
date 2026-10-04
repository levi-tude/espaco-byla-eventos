import { NextResponse } from "next/server";

import { runSessionNotices } from "@/lib/notices/process";
import { NOTICE_CRON_LIMIT } from "@/lib/notices/rules";
import { runAbandonedReminders } from "@/lib/reminders/process";
import { bearerMatches } from "@/lib/security/bearer";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Chamado a cada 15 min pelo agendador do banco (pg_cron + pg_net), com
 * `Authorization: Bearer <REMINDER_CRON_SECRET>`. Sem a variável, recusa sempre.
 */
export async function POST(request: Request) {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret) {
    console.error("[lembrete] Chamada recusada: REMINDER_CRON_SECRET não configurado.");
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Avisos de sessão (horário, cancelamento, valor devolvido) têm prioridade sobre o lembrete.
  let notices = 0;
  try {
    const run = await runSessionNotices(admin, { limit: NOTICE_CRON_LIMIT });
    if (run.status === "ok") notices = run.sent;
  } catch (error) {
    console.error("[lembrete] Falha ao continuar os avisos de sessão.", error);
  }

  const result = await runAbandonedReminders(admin);
  if (result.status === "not_configured") {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (result.status === "error") {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const { claimed, sent, failed } = result;
  return NextResponse.json({ ok: true, claimed, sent, failed, notices });
}
