import { formatSessionTime, formatSessionWhen } from "@/lib/datetime";
import type { ReportSession } from "@/lib/reports/model";

/** "17h00" vira "17h" no filtro; outros horários ficam como estão. */
export function reportHourLabel(startsAt: string): string {
  const time = formatSessionTime(startsAt);
  if (time.endsWith("h00")) return time.slice(0, -2);
  return time || "Sessão";
}

export function reportWhenLabel(sessions: readonly ReportSession[]): string {
  const first = sessions[0];
  if (!first) return "";
  if (sessions.length === 1) return formatSessionWhen(first.startsAt, first.endsAt);
  const last = sessions[sessions.length - 1] ?? first;
  return `${sessions.length} sessões · ${reportHourLabel(first.startsAt)} e ${reportHourLabel(last.startsAt)}`;
}

export function reportSessionId(sessions: readonly { id: string }[], raw: string | undefined): string | null {
  if (!raw) return null;
  return sessions.some((session) => session.id === raw) ? raw : null;
}
