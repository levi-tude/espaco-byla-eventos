import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  financeRole: vi.fn(),
  overview: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.serverRpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

import { GET } from "@/app/equipe/taxa-servico/planilha/route";
import { todayKey } from "@/lib/domain/fee-payout";

const staffUserId = "00000000-0000-4000-8000-0000000000ff";

function get(query = "") {
  return GET(new NextRequest(`http://localhost/equipe/taxa-servico/planilha${query}`));
}

const overviewData = {
  events: [
    {
      event_id: "00000000-0000-4000-8000-000000000001",
      name: "Show X",
      last_session_at: "2026-10-03",
      due_date: "2026-10-04",
      tickets_cents: 37500,
      fee_cents: 1875,
      refunded_cents: 0,
      contested_cents: 0,
      fee_due_cents: 1875,
      paid_out_cents: 0,
      balance_cents: 1875,
      last_payout: null,
    },
  ],
  to_pay_cents: 1875,
  paid_in_period_cents: 0,
  pending_discount_cents: 0,
};

describe("GET /equipe/taxa-servico/planilha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
    mocks.serverRpc.mockResolvedValue({ data: true, error: null });
    mocks.financeRole.mockResolvedValue({ data: "admin", error: null });
    mocks.overview.mockResolvedValue({ data: overviewData, error: null });
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "staff_finance_role" ? mocks.financeRole(args) : mocks.overview(args),
    );
  });

  it.each([
    ["sem login", () => mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })],
    ["fora da equipe", () => mocks.serverRpc.mockResolvedValue({ data: false, error: null })],
    ["secretaria", () => mocks.financeRole.mockResolvedValue({ data: "secretaria", error: null })],
  ])("%s recebe 404 e nenhum dado", async (_caso, arrange) => {
    arrange();
    const response = await get("?de=2026-10&ate=2026-10");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Show X");
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("Admin baixa a planilha com cabeçalhos de download e BOM", async () => {
    const response = await get("?de=2026-09&ate=2026-10");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="taxa-servico-2026-09_2026-10.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Show X;03/10/2026;375,00;18,75");
    expect(mocks.overview).toHaveBeenCalledWith({
      p_staff_user_id: staffUserId,
      p_from: "2026-09-01",
      p_to: "2026-10-31",
    });
  });

  it("conta do desenvolvedor pode baixar (só leitura)", async () => {
    mocks.financeRole.mockResolvedValue({ data: "admin_dev", error: null });
    expect((await get()).status).toBe(200);
  });

  it("período inválido usa o mês atual", async () => {
    const response = await get("?de=2020-01&ate=2026-10");
    const month = todayKey().slice(0, 7);
    expect(response.headers.get("Content-Disposition")).toContain(`taxa-servico-${month}_${month}.csv`);
  });

  it("falha no banco devolve erro genérico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.overview.mockResolvedValue({ data: null, error: { message: "TAXA_ADMIN" } });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("TAXA_ADMIN");
  });
});
