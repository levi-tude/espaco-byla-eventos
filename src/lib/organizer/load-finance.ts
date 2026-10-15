import "server-only";

import {
  type OrganizerEventFinance,
  parseOrganizerEventFinance,
  parsePayoutsOverview,
  type PayoutKind,
  type PayoutsOverview,
} from "@/lib/organizer/finance";
import type { PayoutCsvRow } from "@/lib/organizer/payout-csv";
import { createAdminClient } from "@/lib/supabase/admin";

const PAYOUT_KINDS: readonly PayoutKind[] = ["repasse", "compensacao", "ajuste", "devolucao"];

/** Página "Repasses" (Admin; o banco confere o papel). `null` em qualquer falha. */
export async function loadPayoutsOverview(
  adminId: string,
  period: { from: string; to: string },
): Promise<PayoutsOverview | null> {
  const { data, error } = await createAdminClient().rpc("organizer_payouts_overview", {
    p_admin: adminId,
    p_from: period.from,
    p_to: period.to,
  });
  if (error) {
    console.error("[repasses] Falha ao ler os repasses.", error.code);
    return null;
  }
  const overview = parsePayoutsOverview(data);
  if (!overview) console.error("[repasses] Repasses em formato inesperado.");
  return overview;
}

/** Linhas da planilha dos repasses. `null` em qualquer falha. */
export async function loadPayoutsCsvRows(
  adminId: string,
  period: { from: string; to: string },
): Promise<PayoutCsvRow[] | null> {
  const { data, error } = await createAdminClient().rpc("organizer_payouts_csv", {
    p_admin: adminId,
    p_from: period.from,
    p_to: period.to,
  });
  if (error) {
    console.error("[repasses] Falha ao gerar a planilha.", error.code);
    return null;
  }
  const rows: PayoutCsvRow[] = [];
  for (const row of data ?? []) {
    const kind = PAYOUT_KINDS.find((k) => k === row.tipo);
    if (!kind) return null;
    rows.push({
      pixDate: row.data_pix,
      createdAt: row.registrado_em,
      kind,
      organizer: row.organizador,
      event: row.evento,
      amountCents: row.valor_cents,
      createdByName: row.registrado_por,
      noteOrReason: row.nota_ou_motivo,
    });
  }
  return rows;
}

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
