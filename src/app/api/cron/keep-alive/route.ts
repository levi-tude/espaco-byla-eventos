import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Chamado 1x/dia pelo Vercel Cron. O plano gratuito da Supabase pausa o
 * projeto após ~7 dias com pouca atividade no banco; health checks não contam,
 * então fazemos leituras reais em tabelas.
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
  ]);

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error("[keep-alive] falha ao consultar o banco", failed.error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
