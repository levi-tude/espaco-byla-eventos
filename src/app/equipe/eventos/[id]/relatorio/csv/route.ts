import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { reportHourLabel, reportSessionId } from "@/lib/reports/chrome";
import { buildEventReportCsv } from "@/lib/reports/csv";
import { loadEventReport, loadEventReportFinance, logEventReportExport } from "@/lib/reports/load";
import { buildReportView } from "@/lib/reports/model";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let staff: { userId: string };
  try {
    staff = await requireStaffUser();
  } catch {
    return new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const supabase = await createServerClient();
  const { data: event } = await supabase.from("events").select("id, name").eq("id", id).maybeSingle();
  if (!event) {
    return new Response("Página não encontrada.", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const loaded = await loadEventReport(supabase, staff.userId, event.id);
  if (!loaded.report) {
    return new Response("Não foi possível gerar a planilha. Tente de novo.", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const finance = await getFinanceAccess();
  const admin = finance ? await loadEventReportFinance(supabase, staff.userId, event.id) : null;
  const sessionId = reportSessionId(loaded.report.sessions, new URL(request.url).searchParams.get("sessao") ?? undefined);
  const labels = new Map(loaded.report.sessions.map((session) => [session.id, reportHourLabel(session.startsAt)]));
  const view = buildReportView({
    money: admin ? "full" : "none",
    report: loaded.report,
    admin,
    organizer: null,
    sessionId,
    sessionLabels: labels,
  });
  await logEventReportExport(supabase, staff.userId, event.id, "csv");

  return new Response(buildEventReportCsv(view, event.name), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="relatorio-do-evento.csv"',
      "Cache-Control": "no-store",
    },
  });
}
