import { NextResponse } from "next/server";

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

  const result = await runAbandonedReminders(createAdminClient());
  if (result.status === "not_configured") {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  if (result.status === "error") {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const { claimed, sent, failed } = result;
  return NextResponse.json({ ok: true, claimed, sent, failed });
}
