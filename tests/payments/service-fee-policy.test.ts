import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SERVICE_FEE_OFF } from "@/lib/domain/service-fee";
import { loadServiceFeePolicy } from "@/lib/payments/service-fee-policy";
import type { createAdminClient } from "@/lib/supabase/admin";

function fakeAdmin(data: unknown, error: { message: string } | null = null) {
  return {
    rpc: vi.fn(async () => ({ data, error })),
  } as unknown as ReturnType<typeof createAdminClient>;
}

const dualRow = {
  enabled: true,
  rate_bps: 700,
  min_cents: 100,
  card_rate_bps: 1000,
  pix_rate_bps: 556,
  per_method_enabled: true,
};

describe("loadServiceFeePolicy", () => {
  it("aceita a linha única como objeto (PostgREST) e usa a taxa do cartão no checkout", async () => {
    const policy = await loadServiceFeePolicy(fakeAdmin(dualRow));
    expect(policy).toEqual({
      enabled: true,
      rateBps: 1000,
      minCents: 100,
      cardRateBps: 1000,
      pixRateBps: 556,
      perMethodEnabled: true,
    });
  });

  it("aceita a linha única como array de um elemento", async () => {
    const policy = await loadServiceFeePolicy(fakeAdmin([dualRow]));
    expect(policy.rateBps).toBe(1000);
    expect(policy.cardRateBps).toBe(1000);
  });

  it("sem linha válida devolve taxa desligada (evita TAXA_MUDOU com expected 0)", async () => {
    expect(await loadServiceFeePolicy(fakeAdmin(null))).toEqual(SERVICE_FEE_OFF);
    expect(await loadServiceFeePolicy(fakeAdmin([]))).toEqual(SERVICE_FEE_OFF);
  });
});
