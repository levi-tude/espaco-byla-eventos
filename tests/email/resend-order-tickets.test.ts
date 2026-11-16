import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireEventAccess: vi.fn(),
  createAdminClient: vi.fn(),
  adminFrom: vi.fn(),
  tryConsumeRateLimit: vi.fn(),
  releaseRateLimit: vi.fn(),
  sendOrderTicketsEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/actor", () => ({
  requireActor: mocks.requireActor,
  requireEventAccess: mocks.requireEventAccess,
  ACCESS_DENIED_MESSAGE: "Acesso não permitido.",
  EVENT_NOT_FOUND_MESSAGE: "Evento não encontrado.",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>(
    "@/lib/security/rate-limit",
  );
  return {
    ...actual,
    tryConsumeRateLimit: mocks.tryConsumeRateLimit,
    releaseRateLimit: mocks.releaseRateLimit,
  };
});
vi.mock("@/lib/payments/confirm-order", () => ({
  sendOrderTicketsEmail: mocks.sendOrderTicketsEmail,
}));

import { ActionError } from "@/lib/action-result";
import { ACCESS_DENIED_MESSAGE, EVENT_NOT_FOUND_MESSAGE } from "@/lib/auth/actor";
import {
  RESEND_TICKETS_FALLBACK,
  RESEND_TICKETS_NOT_PAID,
  RESEND_TICKETS_RATE_LIMITED,
  resendOrderTicketsOrThrow,
} from "@/lib/email/resend-order-tickets";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

const ORDER_ID = "00000000-0000-4000-8000-000000000010";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";

function orderLookup(data: unknown, error: unknown = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error }),
  };
  return chain;
}

describe("resendOrderTicketsOrThrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActor.mockResolvedValue({ kind: "equipe", userId: "staff-1" });
    mocks.requireEventAccess.mockResolvedValue({
      actor: { kind: "equipe", userId: "staff-1" },
      access: "equipe",
    });
    mocks.createAdminClient.mockReturnValue({ from: mocks.adminFrom });
    mocks.adminFrom.mockImplementation(() =>
      orderLookup({ id: ORDER_ID, event_id: EVENT_ID, status: "pago" }),
    );
    mocks.tryConsumeRateLimit.mockResolvedValue("allowed");
    mocks.releaseRateLimit.mockResolvedValue(true);
    mocks.sendOrderTicketsEmail.mockResolvedValue(true);
  });

  it("recusa quem não está autenticado antes de buscar o pedido", async () => {
    mocks.requireActor.mockRejectedValue(new ActionError(ACCESS_DENIED_MESSAGE));
    await expect(resendOrderTicketsOrThrow(ORDER_ID)).rejects.toThrow(ACCESS_DENIED_MESSAGE);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
  });

  it("recusa identificador inválido", async () => {
    await expect(resendOrderTicketsOrThrow("abc")).rejects.toThrow("Pedido inválido.");
    expect(mocks.requireActor).not.toHaveBeenCalled();
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
  });

  it("recusa organizador que não é dono do evento", async () => {
    mocks.requireActor.mockResolvedValue({ kind: "organizador", userId: "org-2" });
    mocks.requireEventAccess.mockRejectedValue(new ActionError(EVENT_NOT_FOUND_MESSAGE));
    await expect(resendOrderTicketsOrThrow(ORDER_ID)).rejects.toThrow(EVENT_NOT_FOUND_MESSAGE);
    expect(mocks.requireEventAccess).toHaveBeenCalledWith(EVENT_ID);
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
  });

  it.each(["pendente", "estornado", "aguardando_decisao", "cancelado"])(
    "recusa pedido com status %s",
    async (status) => {
      mocks.adminFrom.mockImplementation(() =>
        orderLookup({ id: ORDER_ID, event_id: EVENT_ID, status }),
      );
      await expect(resendOrderTicketsOrThrow(ORDER_ID)).rejects.toThrow(RESEND_TICKETS_NOT_PAID);
      expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
      expect(mocks.tryConsumeRateLimit).not.toHaveBeenCalled();
    },
  );

  it("respeita o limite de 1 reenvio a cada 2 minutos por pedido", async () => {
    mocks.tryConsumeRateLimit.mockResolvedValue("limited");
    await expect(resendOrderTicketsOrThrow(ORDER_ID)).rejects.toThrow(RESEND_TICKETS_RATE_LIMITED);
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      RATE_LIMITS.resendTicketsPerOrder,
      ORDER_ID,
    );
    expect(RATE_LIMITS.resendTicketsPerOrder).toMatchObject({ limit: 1, windowSeconds: 120 });
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
  });

  it("equipe reenvia o e-mail do pedido pago", async () => {
    await expect(resendOrderTicketsOrThrow(ORDER_ID)).resolves.toBeUndefined();
    expect(mocks.requireEventAccess).toHaveBeenCalledWith(EVENT_ID);
    expect(mocks.sendOrderTicketsEmail).toHaveBeenCalledWith(expect.anything(), ORDER_ID);
  });

  it("dono do evento também pode reenviar", async () => {
    mocks.requireActor.mockResolvedValue({ kind: "organizador", userId: "org-1" });
    mocks.requireEventAccess.mockResolvedValue({
      actor: { kind: "organizador", userId: "org-1" },
      access: "dono",
    });
    await expect(resendOrderTicketsOrThrow(ORDER_ID)).resolves.toBeUndefined();
    expect(mocks.sendOrderTicketsEmail).toHaveBeenCalledWith(expect.anything(), ORDER_ID);
  });

  it("se o envio falha, libera o limite e não vaza PII no log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendOrderTicketsEmail.mockResolvedValue(false);
    await expect(resendOrderTicketsOrThrow(ORDER_ID)).rejects.toThrow(RESEND_TICKETS_FALLBACK);
    expect(mocks.releaseRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      RATE_LIMITS.resendTicketsPerOrder,
      ORDER_ID,
    );
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/@/);
    expect(JSON.stringify(error.mock.calls)).toContain(ORDER_ID);
  });
});
