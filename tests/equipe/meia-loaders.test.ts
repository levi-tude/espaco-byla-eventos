import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadMeiaChecks, loadMeiaSummary } from "@/lib/check-in/meia";

function rpcClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(() => ({ maybeSingle: async () => result })) } as never;
}
function tableClient(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { from: vi.fn(() => builder) } as never;
}

describe("conferência de meia nas páginas (deploy antes da migration)", () => {
  it("função inexistente: desligada, sem quebrar", async () => {
    const r = await loadMeiaSummary(rpcClient({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }), "e", "s");
    expect(r).toEqual({ available: false, summary: null });
  });

  it("tabela inexistente: desligada", async () => {
    const r = await loadMeiaChecks(tableClient({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }), "e");
    expect(r.available).toBe(false);
    expect(r.checks.size).toBe(0);
  });

  it("com a migration: resumo e última marcação por ingresso", async () => {
    const s = await loadMeiaSummary(
      rpcClient({ data: { meias_lidas: 2, comprovante_ok: 1, pagou_diferenca: 1, diferenca_total_cents: 2500, recusadas: 0, nao_registradas: 0 }, error: null }),
      "e",
      null,
    );
    expect(s).toMatchObject({ available: true, summary: { lidas: 2, diferencaTotalCents: 2500 } });
    const c = await loadMeiaChecks(
      tableClient({ data: [{ id: "1", ticket_id: "t", result: "comprovante_ok", diff_cents: null, created_at: "2026-11-28T20:00:00Z" }], error: null }),
      "e",
    );
    expect(c.available).toBe(true);
    expect(c.checks.get("t")?.result).toBe("comprovante_ok");
  });

  it("outro erro (ex.: acesso): fica ligada mas sem resumo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadMeiaSummary(rpcClient({ data: null, error: { code: "P0001", message: "MEIA_ACESSO" } }), "e", null);
    expect(r).toEqual({ available: true, summary: null });
  });
});
