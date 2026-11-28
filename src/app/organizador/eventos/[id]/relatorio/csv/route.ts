import { getActor, requireEventAccess } from "@/lib/auth/actor";
import { UUID_PATTERN } from "@/lib/events/event-input";
import { reportHourLabel, reportSessionId } from "@/lib/reports/chrome";
import { buildEventReportCsv } from "@/lib/reports/csv";
import { loadEventReport, loadEventReportOrganizer, logEventReportExport } from "@/lib/reports/load";
import { buildReportView } from "@/lib/reports/model";
import { createServerClient } from "@/lib/supabase/server";

const hidden = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor();
  if (actor?.kind !== "organizador" || !UUID_PATTERN.test(id)) {
    return new Response("Página não encontrada.", { status: 404, headers: hidden });
  }
  const access = await requireEventAccess(id).catch(() => null);
  if (access?.access !== "dono") {
    return new Response("Página não encontrada.", { status: 404, headers: hidden });
  }

  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name, organizer_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!event || event.organizer_id !== actor.userId || event.deleted_at) {
    return new Response("Página não encontrada.", { status: 404, headers: hidden });
  }

  const loaded = await loadEventReport(supabase, actor.userId, event.id);
  if (!loaded.report) {
    return new Response("Não foi possível gerar a planilha. Tente de novo.", { status: 500, headers: hidden });
  }

  const organizer = await loadEventReportOrganizer(supabase, actor.userId, event.id);
  const sessionId = reportSessionId(loaded.report.sessions, new URL(request.url).searchParams.get("sessao") ?? undefined);
  const labels = new Map(loaded.report.sessions.map((session) => [session.id, reportHourLabel(session.startsAt)]));
  const view = buildReportView({
    money: organizer ? "simple" : "none",
    report: loaded.report,
    admin: null,
    organizer,
    sessionId,
    sessionLabels: labels,
  });
  await logEventReportExport(supabase, actor.userId, event.id, "csv");

  return new Response(buildEventReportCsv(view, event.name), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="relatorio-do-evento.csv"',
      ...hidden,
    },
  });
}
