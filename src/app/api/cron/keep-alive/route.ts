import { NextResponse } from "next/server";

import { runSessionNotices } from "@/lib/notices/process";
import { NOTICE_CRON_LIMIT } from "@/lib/notices/rules";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Chamado 1x/dia pelo Vercel Cron, logo depois de o limite diário de e-mails
 * renovar (00h UTC, 21h em Brasília). O plano gratuito da Supabase pausa o
 * projeto após ~7 dias com pouca atividade no banco; health checks não contam,
 * então fazemos leituras reais em tabelas. Também continua os avisos de sessão
 * que pararam no limite do dia anterior.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const results = await Promise.all([
    supabase.from("events").select("id").limit(1),
    supabase.from("ticket_types").select("id").limit(1),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.rpc("purge_rate_limit_hits"),
  ]);

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error("[keep-alive] falha ao consultar o banco", failed.error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let notices = 0;
  try {
    const run = await runSessionNotices(supabase, { limit: NOTICE_CRON_LIMIT });
    if (run.status === "ok") notices = run.sent;
  } catch (error) {
    console.error("[keep-alive] falha ao continuar os avisos de sessão", error);
  }

  return NextResponse.json({ ok: true, notices });
}
