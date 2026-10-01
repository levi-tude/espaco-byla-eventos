import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  occupied: { data: 0 as number | null, error: null as unknown },
  sold: { count: 0 as number | null, error: null as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago" }),
}));

import { startCheckout } from "@/app/eventos/[slug]/checkout/actions";

const input = {
  slug: "show",
  items: [{ kind: "inteira" as const, qty: 5 }],
  buyer: { name: "Comprador", email: "comprador@example.com" },
  acceptedPrivacy: true,
};

function eventsChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: { id: "00000000-0000-4000-8000-000000000001", capacity: 10 },
      error: null,
    }),
  };
  return chain;
}

function ticketsChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: async () => mocks.sold,
  };
  return chain;
}

describe("checkout recusado por lotação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "consume_rate_limit") return Promise.resolve({ data: true, error: null });
      if (fn === "event_occupied_count") return Promise.resolve(mocks.occupied);
      return {
        single: async () => ({
          data: null,
          error: { message: "Capacidade esgotada para este evento." },
        }),
      };
    });
    mocks.from.mockImplementation((table: string) =>
      table === "tickets" ? ticketsChain() : eventsChain(),
    );
  });

  it("devolve quanto resta para a tela ajustar a seleção", async () => {
    mocks.occupied = { data: 8, error: null };
    mocks.sold = { count: 6, error: null };

    expect(await startCheckout(input)).toEqual({
      error: "Restam apenas 2 lugares. Ajustamos sua seleção.",
      remaining: 2,
    });
  });

  it("sem lugares por reservas em andamento explica que vagas podem reabrir", async () => {
    mocks.occupied = { data: 10, error: null };
    mocks.sold = { count: 7, error: null };

    const result = await startCheckout(input);
    expect(result).toMatchObject({ remaining: 0 });
    expect("error" in result && result.error).toMatch(/reservados no momento/);
  });

  it("falha ao recalcular continua recusando com mensagem genérica", async () => {
    mocks.occupied = { data: null, error: { message: "fora do ar" } };
    mocks.sold = { count: 6, error: null };

    const result = await startCheckout(input);
    expect(result).not.toHaveProperty("remaining");
    expect(result).not.toHaveProperty("publicToken");
    expect("error" in result && result.error).not.toMatch(/fora do ar/);
  });

  it("mais de 10 ingressos é recusado antes de tocar no banco", async () => {
    const result = await startCheckout({
      ...input,
      items: [
        { kind: "inteira", qty: 6 },
        { kind: "meia", qty: 5 },
      ],
    });
    expect(result).toEqual({ error: "Selecione no máximo 10 ingressos por pedido." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
