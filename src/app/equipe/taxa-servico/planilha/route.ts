import type { NextRequest } from "next/server";

import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { todayKey } from "@/lib/domain/fee-payout";
import { buildFeeCsv } from "@/lib/finance/fee-csv";
import { loadServiceFeeOverview } from "@/lib/finance/load";
import { feeCsvFileName, parseFeePeriod } from "@/lib/finance/period";

/** Planilha da taxa de serviço (CSV), só para Admin; mesmo período da página. */
export async function GET(request: NextRequest) {
  const access = await getFinanceAccess();
  if (!access) {
    return new Response("Página não encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const today = todayKey();
  const query = request.nextUrl.searchParams;
  const period = parseFeePeriod(query.get("de"), query.get("ate"), today);
  const overview = await loadServiceFeeOverview(access.userId, period);
  if (!overview) {
    return new Response("Não foi possível gerar a planilha. Tente de novo.", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(buildFeeCsv(overview.events, today), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${feeCsvFileName(period)}"`,
      "Cache-Control": "no-store",
    },
  });
}
