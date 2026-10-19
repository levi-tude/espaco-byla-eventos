import "server-only";

import { SERVICE_FEE_OFF, type ServiceFeePolicy } from "@/lib/domain/service-fee";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Política vigente da taxa para EXIBIR preços. Se a consulta falhar, mostra sem
 * taxa; o checkout envia o que mostrou e o banco recusa com TAXA_MUDOU se divergir.
 *
 * Com `per_method_enabled`, o checkout/exibição base usa a taxa do cartão (mais alta);
 * Pix e cartão aparecem lado a lado na escolha do pagamento.
 */
/** PostgREST às vezes devolve a linha única como objeto, às vezes como array de 1. */
function policyRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

export async function loadServiceFeePolicy(
  admin: ReturnType<typeof createAdminClient>,
): Promise<ServiceFeePolicy> {
  const { data, error } = await admin.rpc("service_fee_policy");
  const row = policyRow(data);
  if (error || !row) {
    if (error) console.error("[taxa] Falha ao ler a configuração da taxa.", { error: error.message });
    return SERVICE_FEE_OFF;
  }
  if (!row.enabled) return SERVICE_FEE_OFF;

  const rateBps = Number(row.rate_bps) || 0;
  const minCents = Number(row.min_cents) || 0;
  const perMethod = Boolean(row.per_method_enabled);
  const cardRateBps = Number(row.card_rate_bps);
  const pixRateBps = Number(row.pix_rate_bps);
  // Com duas taxas, o checkout confere o esperado contra a taxa do CARTÃO no banco.
  // Se card_rate_bps vier inválido e caíssemos em rate_bps antigo (ex.: 700), o insert
  // falha com TAXA_MUDOU e nenhum pedido é criado.

  if (perMethod) {
    return {
      enabled: true,
      rateBps: Number.isFinite(cardRateBps) ? cardRateBps : rateBps,
      minCents,
      cardRateBps: Number.isFinite(cardRateBps) ? cardRateBps : rateBps,
      pixRateBps: Number.isFinite(pixRateBps) ? pixRateBps : rateBps,
      perMethodEnabled: true,
    };
  }

  // Flag desligada: as duas taxas efetivas = rate_bps (comportamento atual).
  return {
    enabled: true,
    rateBps,
    minCents,
    cardRateBps: rateBps,
    pixRateBps: rateBps,
    perMethodEnabled: false,
  };
}
