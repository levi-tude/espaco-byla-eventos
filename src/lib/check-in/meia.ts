import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isMeiaFeatureMissing,
  latestMeiaChecks,
  parseMeiaSummary,
  type MeiaCheckState,
  type MeiaSummary,
} from "@/lib/domain/meia-check";
import type { Database } from "@/types/database";

type UserClient = SupabaseClient<Database>;

/**
 * Resumo da conferência de meia com a sessão do próprio usuário (a função confere equipe ou
 * dono e o código do e-mail). `available: false` = banco ainda sem a migration: telas
 * escondem os botões e o check-in segue normal.
 */
export async function loadMeiaSummary(
  supabase: UserClient,
  eventId: string,
  sessionId: string | null,
): Promise<{ available: boolean; summary: MeiaSummary | null }> {
  try {
    const { data, error } = await supabase
      .rpc("meia_check_summary", { p_event_id: eventId, p_session_id: sessionId })
      .maybeSingle();
    if (error) {
      if (isMeiaFeatureMissing(error)) return { available: false, summary: null };
      console.error("[meia] Resumo indisponível.", error.code);
      return { available: true, summary: null };
    }
    return { available: true, summary: parseMeiaSummary(data as Record<string, unknown> | null) };
  } catch {
    return { available: false, summary: null };
  }
}

/** Última conferência por ingresso do evento (equipe verificada lê pela RLS). */
export async function loadMeiaChecks(
  supabase: UserClient,
  eventId: string,
): Promise<{ available: boolean; checks: Map<string, MeiaCheckState> }> {
  try {
    const { data, error } = await supabase
      .from("meia_checks")
      .select("id, ticket_id, result, diff_cents, created_at")
      .eq("event_id", eventId)
      .order("created_at")
      .order("id");
    if (error) {
      if (isMeiaFeatureMissing(error)) return { available: false, checks: new Map() };
      console.error("[meia] Conferências indisponíveis.", error.code);
      return { available: true, checks: new Map() };
    }
    return { available: true, checks: latestMeiaChecks(data ?? []) };
  } catch {
    return { available: false, checks: new Map() };
  }
}
