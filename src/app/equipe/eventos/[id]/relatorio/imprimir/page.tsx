import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReportDocument } from "@/components/reports/ReportDocument";
import { Notice } from "@/components/ui/Notice";
import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { reportSessionId } from "@/lib/reports/chrome";
import { loadEventReport, loadEventReportFinance, logEventReportExport } from "@/lib/reports/load";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Relatório para impressão",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RelatorioEquipeImprimirPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [staff, finance] = await Promise.all([requireStaffUser(), getFinanceAccess()]);
  const supabase = await createServerClient();
  const { data: event } = await supabase.from("events").select("id, name").eq("id", id).maybeSingle();
  if (!event) notFound();

  const loaded = await loadEventReport(supabase, staff.userId, event.id);
  if (!loaded.available || !loaded.report) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <Notice tone="warning">O relatório ainda não está disponível para impressão.</Notice>
      </main>
    );
  }

  await logEventReportExport(supabase, staff.userId, event.id, "pdf");
  const sessionId = reportSessionId(loaded.report.sessions, typeof query.sessao === "string" ? query.sessao : undefined);
  const admin = finance ? await loadEventReportFinance(supabase, staff.userId, event.id) : null;

  return (
    <ReportDocument
      admin={admin}
      backHref={`/equipe/eventos/${event.id}/relatorio`}
      backLabel="Voltar ao relatório"
      basePath={`/equipe/eventos/${event.id}/relatorio`}
      eventName={event.name}
      money={admin ? "full" : "none"}
      organizer={null}
      printMode
      report={loaded.report}
      sessionId={sessionId}
    />
  );
}
