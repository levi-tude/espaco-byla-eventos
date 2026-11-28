import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { OrganizerNoAccess } from "@/components/organizer/OrganizerNoAccess";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { Notice } from "@/components/ui/Notice";
import { getActor, requireEventAccess } from "@/lib/auth/actor";
import { UUID_PATTERN } from "@/lib/events/event-input";
import { organizerAreaEnabled } from "@/lib/organizer/settings";
import { reportSessionId } from "@/lib/reports/chrome";
import { loadEventReport, loadEventReportOrganizer } from "@/lib/reports/load";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Relatório do evento",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RelatorioOrganizadorPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await getActor();
  if (actor?.kind !== "organizador") {
    return <OrganizerNoAccess areaEnabled={await organizerAreaEnabled()} />;
  }
  if (!UUID_PATTERN.test(id)) notFound();
  const access = await requireEventAccess(id).catch(() => null);
  if (access?.access !== "dono") notFound();

  const supabase = await createServerClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, name, organizer_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!event || event.organizer_id !== actor.userId || event.deleted_at) notFound();

  const loaded = await loadEventReport(supabase, actor.userId, event.id);
  if (!loaded.available) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Notice tone="warning">O relatório ainda não está disponível neste ambiente.</Notice>
      </main>
    );
  }
  if (!loaded.report) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Notice tone="danger">Não foi possível montar o relatório. Atualize a página.</Notice>
      </main>
    );
  }

  const organizer = await loadEventReportOrganizer(supabase, actor.userId, event.id);
  const sessionId = reportSessionId(
    loaded.report.sessions,
    typeof query.sessao === "string" ? query.sessao : undefined,
  );

  return (
    <>
      <AutoRefresh intervalMs={30_000} />
      {!organizer ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <Notice tone="warning">As quantidades estão aqui. O financeiro não carregou — atualize a página.</Notice>
        </div>
      ) : null}
      <ReportDocument
        admin={null}
        backHref={`/organizador/eventos/${event.id}`}
        backLabel="Voltar ao evento"
        basePath={`/organizador/eventos/${event.id}/relatorio`}
        eventName={event.name}
        money={organizer ? "simple" : "none"}
        organizer={organizer}
        report={loaded.report}
        sessionId={sessionId}
      />
    </>
  );
}
