import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import {
  consumeRateLimit,
  hashRateLimitKey,
  releaseRateLimit,
  tryConsumeRateLimit,
} from "@/lib/security/rate-limit";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const rule = { bucket: "alert:order", limit: 1, windowSeconds: 86_400 };

function rpcAdmin(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as AdminClient;
}

describe("tryConsumeRateLimit", () => {
  it.each([
    [true, "allowed"],
    [false, "limited"],
  ] as const)("banco responde %s → %s", async (data, outcome) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(tryConsumeRateLimit(rpcAdmin(rpc), rule, "k")).resolves.toBe(outcome);
    expect(rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "alert:order",
      p_key_hash: hashRateLimitKey("k"),
      p_limit: 1,
      p_window_seconds: 86_400,
    });
  });

  it.each([
    ["erro do banco", vi.fn().mockResolvedValue({ data: null, error: { message: "fora" } })],
    ["exceção", vi.fn().mockRejectedValue(new Error("rede"))],
  ])("%s vira 'error', separado de limite atingido", async (_caso, rpc) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(tryConsumeRateLimit(rpcAdmin(rpc), rule, "k")).resolves.toBe("error");
  });

  it("consumeRateLimit continua falhando fechado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "fora" } });
    await expect(consumeRateLimit(rpcAdmin(rpc), rule, "k")).resolves.toBe(false);
  });
});

describe("releaseRateLimit", () => {
  function deleteAdmin(result: () => Promise<{ error: unknown }>) {
    const calls: Array<[string, string]> = [];
    const chain = {
      delete: () => chain,
      eq: (column: string, value: string) => {
        calls.push([column, value]);
        return calls.length === 2 ? result() : chain;
      },
    };
    const from = vi.fn(() => chain);
    return { admin: { from } as unknown as AdminClient, from, calls };
  }

  it("apaga os registros da chave pelo hash, nunca em claro", async () => {
    const { admin, from, calls } = deleteAdmin(async () => ({ error: null }));
    await expect(releaseRateLimit(admin, rule, "email_nao_enviado:pedido")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("rate_limit_hits");
    expect(calls).toEqual([
      ["bucket", "alert:order"],
      ["key_hash", hashRateLimitKey("email_nao_enviado:pedido")],
    ]);
  });

  it("falha do banco devolve false sem lançar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = deleteAdmin(() => Promise.reject(new Error("rede")));
    await expect(releaseRateLimit(admin, rule, "k")).resolves.toBe(false);
  });
});
