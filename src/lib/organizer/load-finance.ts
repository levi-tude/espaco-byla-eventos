import "server-only";

import { type OrganizerEventFinance, parseOrganizerEventFinance } from "@/lib/organizer/finance";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Contas do evento para o dono (ou para a equipe com papel de dinheiro). Quem chama já
 * conferiu a sessão; o banco confere de novo o acesso ao evento. `null` em qualquer falha.
 */
export async function loadOrganizerEventFinance(
  actorId: string,
  eventId: string,
): Promise<OrganizerEventFinance | null> {
  const { data, error } = await createAdminClient().rpc("organizer_event_finance", {
    p_actor: actorId,
    p_event_id: eventId,
  });
  if (error) {
    console.error("[organizador] Falha ao ler o financeiro do evento.", error.code);
    return null;
  }
  const finance = parseOrganizerEventFinance(data);
  if (!finance) console.error("[organizador] Financeiro do evento em formato inesperado.");
  return finance;
}
