import { NextResponse } from "next/server";

import { runSessionNotices } from "@/lib/notices/process";
import { sweepOrphanCovers } from "@/lib/media/orphans";
import { NOTICE_CRON_LIMIT } from "@/lib/notices/rules";
import { runOrganizerFinanceDaily } from "@/lib/organizer/daily";
import { captureMissingFees } from "@/lib/payments/capture-fee";
import { getPaymentProvider } from "@/lib/payments/provider";
import { bearerMatches } from "@/lib/security/bearer";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** Cabe nos 60 s da rota com folga para as outras etapas. */
const FEE_CAPTURE_BUDGET_MS = 25_000;

/**
 * Chamado 1x/dia (Cloud Scheduler, ou pg_cron no banco via migration
 * keep_alive_schedule), logo depois de o limite diário de e-mails
 * renovar (00h UTC, 21h em Brasília). O plano gratuito da Supabase pausa o
 * projeto após ~7 dias com pouca atividade no banco; health checks não contam,
 * então fazemos leituras reais em tabelas. Também continua os avisos de sessão
 * que pararam no limite do dia anterior e busca as tarifas que faltaram.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
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

  // Limpeza dos códigos de acesso e aparelhos vencidos: falha só vai para o log.
  try {
    const { error } = await supabase.rpc("purge_login_verification");
    if (error) console.error("[keep-alive] falha ao limpar códigos de acesso", error.message);
  } catch (error) {
    console.error("[keep-alive] falha ao limpar códigos de acesso", error);
  }

  // Convites vencidos e pedidos do site já tratados dos organizadores: falha só vai para o log.
  try {
    const { error } = await supabase.rpc("purge_organizer_records");
    if (error) console.error("[keep-alive] falha ao limpar convites e pedidos antigos", error.code);
  } catch {
    console.error("[keep-alive] falha ao limpar convites e pedidos antigos");
  }

  let notices = 0;
  try {
    const run = await runSessionNotices(supabase, { limit: NOTICE_CRON_LIMIT });
    if (run.status === "ok") notices = run.sent;
  } catch (error) {
    console.error("[keep-alive] falha ao continuar os avisos de sessão", error);
  }

  // Tarifas que não vieram na hora do pagamento ou do estorno: falha só vai para o log.
  try {
    const fees = await captureMissingFees(supabase, getPaymentProvider(), {
      budgetMs: FEE_CAPTURE_BUDGET_MS,
    });
    if (fees.falhou > 0 || fees.alertados > 0) {
      console.warn("[keep-alive] tarifas pendentes", fees);
    }
  } catch {
    console.error("[keep-alive] falha ao buscar as tarifas pendentes");
  }

  // Depois das tarifas: devoluções dos organizadores e resumo da equipe (nunca lança).
  const finance = await runOrganizerFinanceDaily(supabase);
  if (finance.devolucoes > 0 || finance.resumo) console.warn("[keep-alive] avisos de repasse", finance);

  // Por último: capas enviadas e nunca usadas (nunca lança; em dúvida, não apaga).
  try {
    const covers = await sweepOrphanCovers(supabase);
    if (covers.deleted > 0) console.warn("[keep-alive] capas sem uso apagadas", covers);
  } catch {
    console.error("[keep-alive] falha na limpeza de capas");
  }

  return NextResponse.json({ ok: true, notices });
}
