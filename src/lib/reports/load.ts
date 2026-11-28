import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseAdminFinance,
  parseEventReport,
  parseOrganizerFinance,
  type AdminFinance,
  type EventReport,
  type OrganizerFinance,
} from "@/lib/reports/model";
import type { Database } from "@/types/database";

type UserClient = SupabaseClient<Database>;

function missingRpc(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  const message = error.message ?? "";
  return /event_report|log_event_report_export/.test(message) && /not find|does not exist|schema cache/i.test(message);
}

export async function loadEventReport(
  supabase: UserClient,
  actorId: string,
  eventId: string,
): Promise<{ available: boolean; report: EventReport | null }> {
  const { data, error } = await supabase.rpc("event_report", { p_actor: actorId, p_event_id: eventId });
  if (error) {
    if (missingRpc(error)) return { available: false, report: null };
    console.error("[relatorio] Falha ao ler as quantidades.", error.code);
    return { available: true, report: null };
  }
  return { available: true, report: parseEventReport(data) };
}

export async function loadEventReportFinance(
  supabase: UserClient,
  actorId: string,
  eventId: string,
): Promise<AdminFinance | null> {
  const { data, error } = await supabase.rpc("event_report_finance", { p_actor: actorId, p_event_id: eventId });
  if (error) {
    if (!missingRpc(error)) console.error("[relatorio] Falha ao ler o financeiro.", error.code);
    return null;
  }
  return parseAdminFinance(data);
}

export async function loadEventReportOrganizer(
  supabase: UserClient,
  actorId: string,
  eventId: string,
): Promise<OrganizerFinance | null> {
  const { data, error } = await supabase.rpc("event_report_organizer", { p_actor: actorId, p_event_id: eventId });
  if (error) {
    if (!missingRpc(error)) console.error("[relatorio] Falha ao ler o financeiro do organizador.", error.code);
    return null;
  }
  return parseOrganizerFinance(data);
}

export async function logEventReportExport(
  supabase: UserClient,
  actorId: string,
  eventId: string,
  format: "csv" | "pdf",
): Promise<boolean> {
  const { error } = await supabase.rpc("log_event_report_export", {
    p_actor: actorId,
    p_event_id: eventId,
    p_format: format,
  });
  if (error) {
    console.error("[relatorio] Falha ao registrar a exportação.", error.code);
    return false;
  }
  return true;
}
