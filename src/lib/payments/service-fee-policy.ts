import "server-only";

import { SERVICE_FEE_OFF, type ServiceFeePolicy } from "@/lib/domain/service-fee";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Política vigente da taxa para EXIBIR preços. Se a consulta falhar, mostra sem
 * taxa; o checkout envia o que mostrou e o banco recusa com TAXA_MUDOU se divergir.
 */
export async function loadServiceFeePolicy(
  admin: ReturnType<typeof createAdminClient>,
): Promise<ServiceFeePolicy> {
  const { data, error } = await admin.rpc("service_fee_policy");
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    if (error) console.error("[taxa] Falha ao ler a configuração da taxa.", { error: error.message });
    return SERVICE_FEE_OFF;
  }
  return row.enabled
    ? { enabled: true, rateBps: row.rate_bps, minCents: row.min_cents }
    : SERVICE_FEE_OFF;
}
