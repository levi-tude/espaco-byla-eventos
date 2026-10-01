import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    order: {} as Record<string, unknown>,
  },
  alertTeam: vi.fn(),
  sendTicketsEmail: vi.fn(),
  refundOrder: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
}));
vi.mock("botid/server", () => ({ checkBotId: async () => ({ isBot: false }) }));
vi.mock("@/lib/alerts/team-alert", () => ({ alertTeam: mocks.alertTeam }));
vi.mock("@/lib/email/send-tickets", () => ({ sendTicketsEmail: mocks.sendTicketsEmail }));

/** Banco em memória com as mesmas transições das RPCs da fase 2. */
const admin = {
  from: (table: string) => {
    const data = table === "orders" ? { ...mocks.db.order } : { slug: "show" };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error: null }),
    };
    return chain;
  },
  rpc: async (fn: string) => {
    const order = mocks.db.order;
    if (fn === "consume_rate_limit") return { data: true, error: null };
    if (fn === "cancel_pending_order") {
      if (order.status !== "pendente") return { data: "noop", error: null };
      Object.assign(order, { status: "cancelado", cancel_reason: "alterado_pelo_comprador" });
      return { data: "updated", error: null };
    }
    if (fn === "mark_order_paid_by_external") {
      if (order.status !== "cancelado") return { data: "noop", error: null };
      Object.assign(order, {
        status: "aguardando_decisao",
        decision_reason: "pago_apos_cancelamento",
      });
      return { data: "needs_decision_cancelled", error: null };
    }
    throw new Error(`rpc inesperada: ${fn}`);
  },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({
    name: "mercadopago",
    // A rede falhou ao cancelar e a busca ainda não mostrava o PIX: segue a troca.
    cancelPendingCharges: async () => ({ kind: "cleared" }),
    refundOrder: mocks.refundOrder,
  }),
}));

import { changeOrderSelection } from "@/app/pedidos/[publicToken]/actions";
import type { SupabaseAdmin } from "@/lib/domain/orders";
import { confirmOrderPaid } from "@/lib/payments/confirm-order";

const orderId = "00000000-0000-4000-8000-000000000010";

describe("PIX pago depois de Alterar seleção", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.db.order = {
      id: orderId,
      event_id: "00000000-0000-4000-8000-000000000001",
      status: "pendente",
      total_cents: 2500,
      buyer_email: "comprador@example.com",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      created_at: new Date().toISOString(),
      hold_extended_at: new Date().toISOString(),
    };
  });

  it("vai para a fila “Precisa de decisão”, avisa a equipe e não estorna nem envia ingressos", async () => {
    await expect(changeOrderSelection("token-1")).resolves.toMatchObject({ status: "changed" });
    expect(mocks.db.order.status).toBe("cancelado");

    // O aviso do Mercado Pago chega depois, como na rota do webhook.
    await expect(
      confirmOrderPaid(admin as unknown as SupabaseAdmin, orderId, "mercadopago", 2500, {
        providerOrderId: "ORDPIX1",
      }),
    ).resolves.toBe("needs_decision_cancelled");

    expect(mocks.db.order).toMatchObject({
      status: "aguardando_decisao",
      decision_reason: "pago_apos_cancelamento",
    });
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "pago_apos_cancelamento",
      orderId,
      expect.stringContaining("Pago após cancelamento — decidir"),
    );
    expect(mocks.refundOrder).not.toHaveBeenCalled();
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
  });
});
