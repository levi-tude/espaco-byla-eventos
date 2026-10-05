import "server-only";

import {
  type EventFinanceSummary,
  parseEventFinanceSummary,
  parseServiceFeeOverview,
  type ServiceFeeOverview,
} from "@/lib/domain/fee-payout";
import type { FeePeriod } from "@/lib/finance/period";
import { createAdminClient } from "@/lib/supabase/admin";

/** Quem chama já conferiu o Admin (`getFinanceAccess`); o banco confere de novo. */
export async function loadEventFinance(
  eventId: string,
  staffUserId: string,
): Promise<EventFinanceSummary | null> {
  const { data, error } = await createAdminClient().rpc("event_finance_summary", {
    p_event_id: eventId,
    p_staff_user_id: staffUserId,
  });
  if (error) {
    console.error("[financeiro] Falha ao carregar o financeiro do evento.", {
      eventId,
      error: error.message,
    });
    return null;
  }
  return parseEventFinanceSummary(data);
}

export async function loadServiceFeeOverview(
  staffUserId: string,
  period: FeePeriod,
): Promise<ServiceFeeOverview | null> {
  const { data, error } = await createAdminClient().rpc("service_fee_overview", {
    p_staff_user_id: staffUserId,
    p_from: period.from,
    p_to: period.to,
  });
  if (error) {
    console.error("[financeiro] Falha ao carregar a taxa de serviço.", { error: error.message });
    return null;
  }
  return parseServiceFeeOverview(data);
}
