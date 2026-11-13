import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  writeUnlockCookie: vi.fn(),
  readUnlockCookie: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.50" }),
  cookies: async () => ({ get: () => undefined, set: vi.fn() }),
}));
vi.mock("@/lib/tickets/unlock-code", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tickets/unlock-code")>(
    "@/lib/tickets/unlock-code",
  );
  return {
    ...actual,
    writeUnlockCookie: mocks.writeUnlockCookie,
    readUnlockCookie: mocks.readUnlockCookie,
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/security/bot", () => ({
  isBotRequest: async () => false,
  BOT_BLOCKED_MESSAGE: "bot",
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago" }),
}));

import { startCheckout, unlockTicketTypes } from "@/app/eventos/[slug]/checkout/actions";
import { hashUnlockCode } from "@/lib/tickets/unlock-code";
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const TYPE_ID = "00000000-0000-4000-8000-0000000000t1".replace("t", "a");
const CODE = "bolsista2026";

/** Builder encadeável que resolve com `result` no await final. */
function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const method of ["select", "eq", "in", "not", "neq", "is", "order"]) {
    builder[method] = self;
  }
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-de-teste-bem-longa");
  mocks.writeUnlockCookie.mockResolvedValue(true);
  mocks.readUnlockCookie.mockResolvedValue(null);
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "consume_rate_limit") return { data: true, error: null };
    if (fn === "create_checkout_order") return { data: { id: "order" }, error: null };
    return { data: null, error: { message: "inesperado" } };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("unlockTicketTypes", () => {
  it("código válido grava cookie e devolve quantos tipos liberou", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "events") return query({ data: { id: EVENT_ID }, error: null });
      return query({
        data: [{ id: TYPE_ID, unlock_code_hash: hashUnlockCode(CODE) }],
        error: null,
      });
    });

    expect(await unlockTicketTypes("capsulas", CODE)).toEqual({
      ok: true,
      data: { unlocked: 1 },
    });
    expect(mocks.writeUnlockCookie).toHaveBeenCalledWith(EVENT_ID, hashUnlockCode(CODE));
  });

  it("código errado: mesma mensagem genérica", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "events") return query({ data: { id: EVENT_ID }, error: null });
      return query({ data: [], error: null });
    });
    const result = await unlockTicketTypes("capsulas", "errado123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/código/i);
    expect(mocks.writeUnlockCookie).not.toHaveBeenCalled();
  });

  it("limite de unlock estourado", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await unlockTicketTypes("capsulas", CODE)).toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE,
    });
  });
});

describe("startCheckout com tipo restrito", () => {
  it("sem cookie recusa tipo com unlock_code_hash", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "events") {
        return query({ data: { id: EVENT_ID, capacity: 100 }, error: null });
      }
      if (table === "ticket_types") {
        return query({
          data: [{ id: TYPE_ID, unlock_code_hash: hashUnlockCode(CODE) }],
          error: null,
        });
      }
      return query({ data: null, error: null });
    });

    const result = await startCheckout({
      slug: "capsulas",
      items: [{ ticketTypeId: TYPE_ID, qty: 1 }],
      buyer: { name: "Ana", email: "ana@exemplo.com" },
      acceptedPrivacy: true,
      acceptedTerms: true,
    });
    expect(result).toMatchObject({ error: expect.stringMatching(/código/i) });
    expect(mocks.rpc.mock.calls.some(([fn]) => fn === "create_checkout_order")).toBe(false);
  });
});
