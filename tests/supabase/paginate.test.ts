import { describe, expect, it, vi } from "vitest";

import { fetchAllPages, MAX_PAGES } from "@/lib/supabase/paginate";

describe("fetchAllPages", () => {
  it("junta todas as páginas além de 1000 linhas", async () => {
    const total = 2_345;
    const page = vi.fn(async (from: number, to: number) => ({
      data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({
        n: from + i,
      })),
      error: null,
    }));
    const { data, error } = await fetchAllPages(page);
    expect(error).toBeNull();
    expect(data).toHaveLength(total);
    expect(data?.[total - 1]).toEqual({ n: total - 1 });
    expect(page.mock.calls.map(([from, to]) => [from, to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("página cheia exata pede mais uma e para na vazia", async () => {
    const page = vi.fn(async (from: number) => ({
      data: from === 0 ? Array.from({ length: 1000 }, () => ({})) : [],
      error: null,
    }));
    const { data } = await fetchAllPages(page);
    expect(data).toHaveLength(1000);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("erro em qualquer página devolve o erro, sem total parcial", async () => {
    const page = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, () => ({})), error: null }
        : { data: null, error: { code: "57014" } },
    );
    expect(await fetchAllPages(page)).toEqual({ data: null, error: { code: "57014" } });
  });

  it("tem teto de segurança", async () => {
    const page = vi.fn(async () => ({ data: [{}], error: null }));
    const { data, error } = await fetchAllPages(page, 1);
    expect(data).toBeNull();
    expect(error?.code).toBe("PAGINATION_LIMIT");
    expect(page).toHaveBeenCalledTimes(MAX_PAGES);
  });
});
