import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/equipe/AutoRefresh";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { Notice } from "@/components/ui/Notice";
import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { reportSessionId } from "@/lib/reports/chrome";
import { loadEventReport, loadEventReportFinance } from "@/lib/reports/load";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Relatório do evento",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RelatorioEquipePage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [staff, finance] = await Promise.all([requireStaffUser(), getFinanceAccess()]);
  const supabase = await createServerClient();
  const { data: event } = await supabase.from("events").select("id, name").eq("id", id).maybeSingle();
  if (!event) notFound();

  const loaded = await loadEventReport(supabase, staff.userId, event.id);
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

  const sessionId = reportSessionId(loaded.report.sessions, typeof query.sessao === "string" ? query.sessao : undefined);
  const admin = finance ? await loadEventReportFinance(supabase, staff.userId, event.id) : null;
  const basePath = `/equipe/eventos/${event.id}/relatorio`;

  return (
    <>
      <AutoRefresh intervalMs={30_000} />
      {finance && !admin ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <Notice tone="warning">As quantidades estão aqui. O financeiro não carregou — atualize a página.</Notice>
        </div>
      ) : null}
      <ReportDocument
        admin={admin}
        backHref={`/equipe/eventos/${event.id}`}
        backLabel="Voltar ao evento"
        basePath={basePath}
        eventName={event.name}
        money={admin ? "full" : "none"}
        organizer={null}
        report={loaded.report}
        sessionId={sessionId}
      />
    </>
  );
}
