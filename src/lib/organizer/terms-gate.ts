import "server-only";

import { ActionError } from "@/lib/action-result";
import {
  ORGANIZER_TERMS_REQUIRED_MESSAGE,
  ORGANIZER_TERMS_VERSION,
} from "@/lib/legal/organizer-terms";
import type { createServerClient } from "@/lib/supabase/server";

/**
 * Cliente da SESSÃO do organizador (RLS organizer_profiles_self_read), nunca o
 * service_role: organizer_profiles guarda chave PIX, documento e contato (LGPD) e o
 * service_role não tem acesso direto à tabela.
 */
type SessionClient = Awaited<ReturnType<typeof createServerClient>>;

/** Status só para o aviso do layout (não bloqueia ações). */
export type OrganizerTermsStatus = "aceito" | "pendente" | "desconhecido";

const TERMS_READ_TIMEOUT_MS = 3_000;

/** Confere se o organizador aceitou a versão vigente dos Termos (N16). */
export async function assertOrganizerTermsAccepted(
  session: SessionClient,
  userId: string,
): Promise<void> {
  const { data, error } = await session
    .from("organizer_profiles")
    .select("terms_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[organizador] Falha ao ler aceite dos termos.", { code: error.code });
    throw new ActionError(ORGANIZER_TERMS_REQUIRED_MESSAGE);
  }
  if (!data || data.terms_version !== ORGANIZER_TERMS_VERSION) {
    throw new ActionError(ORGANIZER_TERMS_REQUIRED_MESSAGE);
  }
}

/**
 * Só o banner do layout. Em erro/demora devolve "desconhecido" (não mostra aviso).
 * As ações de escrita usam `assertOrganizerTermsAccepted` (falha fechada).
 */
export async function organizerNeedsTermsAcceptance(
  session: SessionClient,
  userId: string,
): Promise<OrganizerTermsStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TERMS_READ_TIMEOUT_MS);
  try {
    const { data, error } = await session
      .from("organizer_profiles")
      .select("terms_version")
      .eq("user_id", userId)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (error) {
      console.error("[organizador] Falha ao ler aceite dos termos para o aviso.", {
        code: error.code,
      });
      return "desconhecido";
    }
    if (!data) return "pendente";
    return data.terms_version === ORGANIZER_TERMS_VERSION ? "aceito" : "pendente";
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "abort")
        : error instanceof Error
          ? error.name
          : "desconhecido";
    console.error("[organizador] Falha ao ler aceite dos termos para o aviso.", { code });
    return "desconhecido";
  } finally {
    clearTimeout(timer);
  }
}
