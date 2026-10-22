import "server-only";

import { ActionError } from "@/lib/action-result";
import {
  ORGANIZER_TERMS_REQUIRED_MESSAGE,
  ORGANIZER_TERMS_VERSION,
} from "@/lib/legal/organizer-terms";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Confere se o organizador aceitou a versão vigente dos Termos (N16). */
export async function assertOrganizerTermsAccepted(
  admin: Admin,
  userId: string,
): Promise<void> {
  const { data, error } = await admin
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
 * Só o banner: true = precisa aceitar. Em falha de leitura, NÃO força o aviso
 * (evita “aceitei e o banner ficou” quando o banco demora/erra depois do aceite).
 * As ações de escrita ainda usam `assertOrganizerTermsAccepted` (falha fechada).
 */
export async function organizerNeedsTermsAcceptance(
  admin: Admin,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("organizer_profiles")
    .select("terms_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[organizador] Falha ao ler aceite dos termos para o aviso.", {
      code: error.code,
    });
    return false;
  }
  if (!data) return true;
  return data.terms_version !== ORGANIZER_TERMS_VERSION;
}
