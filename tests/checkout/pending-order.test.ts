import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  isBot: false,
  orders: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: mocks.isBot }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from, rpc: vi.fn() }),
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago" }),
}));

import { findPendingOrder } from "@/app/eventos/[slug]/checkout/actions";

const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-000000000002";
const events = [{ id: EVENT_ID, slug: "show" }];

/** Filtra as linhas pelos `.eq()` da consulta, como o banco faria. */
function table(rows: Record<string, unknown>[]) {
  const filters: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    maybeSingle: async () => ({
      data: rows.find((row) => filters.every(([column, value]) => row[column] === value)) ?? null,
      error: null,
    }),
  };
  return chain;
}

function pendingOrder(overrides: Record<string, unknown> = {}) {
  return {
    public_token: "token-1",
    event_id: EVENT_ID,
    status: "pendente",
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("pedido pendente guardado no carrinho", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isBot = false;
    mocks.from.mockImplementation((name: string) =>
      table(name === "events" ? events : mocks.orders),
    );
  });

  it("ainda dentro da reserva: oferece continuar o pagamento (sem pedido duplicado)", async () => {
    const order = pendingOrder();
    mocks.orders = [order];
    await expect(findPendingOrder("show", "token-1")).resolves.toEqual({
      state: "awaiting_payment",
      expiresAt: order.expires_at,
    });
  });

  it("reserva vencida: segue para checkout novo", async () => {
    mocks.orders = [pendingOrder({ expires_at: new Date(Date.now() - 1000).toISOString() })];
    await expect(findPendingOrder("show", "token-1")).resolves.toEqual({ state: "none" });
  });

  it("pedido já pago é reconhecido", async () => {
    mocks.orders = [pendingOrder({ status: "pago" })];
    await expect(findPendingOrder("show", "token-1")).resolves.toEqual({ state: "paid" });
  });

  it("token de outro evento é ignorado", async () => {
    mocks.orders = [pendingOrder({ event_id: OTHER_EVENT_ID })];
    await expect(findPendingOrder("show", "token-1")).resolves.toEqual({ state: "none" });
  });

  it("token inválido ou robô: nem consulta o banco", async () => {
    await expect(findPendingOrder("show", "../token")).resolves.toEqual({ state: "none" });
    mocks.isBot = true;
    await expect(findPendingOrder("show", "token-1")).resolves.toEqual({ state: "none" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
