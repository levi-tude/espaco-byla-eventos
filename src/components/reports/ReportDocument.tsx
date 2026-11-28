import { EventReportScreen } from "@/components/reports/EventReportScreen";
import { formatSessionTime } from "@/lib/datetime";
import { reportHourLabel, reportWhenLabel } from "@/lib/reports/chrome";
import { buildReportView, type AdminFinance, type EventReport, type MoneyAudience, type OrganizerFinance } from "@/lib/reports/model";

export function ReportDocument({
  eventName,
  report,
  money,
  admin,
  organizer,
  sessionId,
  basePath,
  backHref,
  backLabel,
  printMode = false,
}: {
  eventName: string;
  report: EventReport;
  money: MoneyAudience;
  admin: AdminFinance | null;
  organizer: OrganizerFinance | null;
  sessionId: string | null;
  basePath: string;
  backHref: string;
  backLabel: string;
  printMode?: boolean;
}) {
  const labels = new Map(report.sessions.map((session) => [session.id, reportHourLabel(session.startsAt)]));
  const view = buildReportView({
    money,
    report,
    admin,
    organizer,
    sessionId,
    sessionLabels: labels,
  });
  const query = sessionId ? `?sessao=${encodeURIComponent(sessionId)}` : "";
  const links = [
    { href: basePath, label: "Todas", current: !sessionId },
    ...report.sessions.map((session) => ({
      href: `${basePath}?sessao=${session.id}`,
      label: reportHourLabel(session.startsAt),
      current: session.id === sessionId,
    })),
  ];

  return (
    <EventReportScreen
      backHref={backHref}
      backLabel={backLabel}
      csvHref={`${basePath}/csv${query}`}
      eventName={eventName}
      printHref={`${basePath}/imprimir${query}`}
      printMode={printMode}
      sessionLinks={links}
      updatedLabel={formatSessionTime(report.generatedAt)}
      view={view}
      whenLabel={reportWhenLabel(report.sessions)}
    />
  );
}
