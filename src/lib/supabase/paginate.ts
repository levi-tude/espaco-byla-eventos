/**
 * Lê todas as linhas de uma consulta paginando de 1000 em 1000 (limite padrão do
 * PostgREST/Supabase): sem isso, totais de eventos grandes saem cortados em 1000.
 * A consulta precisa ter ordem estável (ex.: `.order("id")`).
 */
export const PAGE_SIZE = 1000;
/** Teto de segurança: 200 páginas = 200 mil linhas. */
export const MAX_PAGES = 200;

type PageResult<Row> = { data: Row[] | null; error: { code?: string; message?: string } | null };

export async function fetchAllPages<Row>(
  page: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  pageSize = PAGE_SIZE,
): Promise<PageResult<Row>> {
  const rows: Row[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * pageSize;
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
  return { data: null, error: { code: "PAGINATION_LIMIT", message: "Muitas linhas para ler." } };
}
