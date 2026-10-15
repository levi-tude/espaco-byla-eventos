import type { NextRequest } from "next/server";

import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { todayKey } from "@/lib/domain/fee-payout";
import { PAYOUT_PERIOD_MAX_MONTHS, parseFeePeriod } from "@/lib/finance/period";
import { loadPayoutsCsvRows } from "@/lib/organizer/load-finance";
import { buildPayoutsCsv } from "@/lib/organizer/payout-csv";

/** Planilha dos repasses aos organizadores (CSV), só para Admin; mesmo período da página. */
export async function GET(request: NextRequest) {
  const access = await getFinanceAccess();
  if (!access) {
    return new Response("Página não encontrada.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const query = request.nextUrl.searchParams;
  const period = parseFeePeriod(query.get("de"), query.get("ate"), todayKey(), PAYOUT_PERIOD_MAX_MONTHS);
  const rows = await loadPayoutsCsvRows(access.userId, period);
  if (!rows) {
    return new Response("Não foi possível gerar a planilha. Tente de novo.", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(buildPayoutsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="repasses-${period.fromMonth}_${period.toMonth}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
