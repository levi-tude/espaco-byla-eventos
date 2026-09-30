import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markOrderPaidIfPending: vi.fn(),
  sendTicketsEmail: vi.fn(),
  alertTeam: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/domain/orders", () => ({
  markOrderPaidIfPending: mocks.markOrderPaidIfPending,
}));
vi.mock("@/lib/email/send-tickets", () => ({
  sendTicketsEmail: mocks.sendTicketsEmail,
}));
vi.mock("@/lib/alerts/team-alert", () => ({
  alertTeam: mocks.alertTeam,
}));

import { confirmOrderPaid } from "@/lib/payments/confirm-order";
import type { SupabaseAdmin } from "@/lib/domain/orders";

const orderId = "00000000-0000-4000-8000-000000000010";

type Row = Record<string, unknown> | Record<string, unknown>[] | null;

/** Cada tabela devolve sempre a mesma linha, seja por maybeSingle/single ou await direto. */
function fakeAdmin(rows: Record<string, Row>) {
  return {
    from: (table: string) => {
      const result = { data: rows[table] ?? null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: async () => result,
        single: async () => result,
        then: (resolve: (value: typeof result) => unknown) => resolve(result),
      };
      return chain;
    },
  } as unknown as SupabaseAdmin;
}

const paidOrderRows = {
  orders: {
    total_cents: 5000,
    buyer_email: "comprador@example.com",
    buyer_name: "Comprador Teste",
    public_token: "token-publico",
    event_id: "evento-1",
  },
  events: { name: "Evento", venue: "Espaço", starts_at: "2026-10-10T20:00:00Z" },
  tickets: [{ code: "codigo-1", buyer_name: "Comprador Teste", kind: "inteira" }],
};

function adminWithOrderTotal(totalCents: number | null) {
  return fakeAdmin({
    orders: totalCents === null ? null : { total_cents: totalCents },
  });
}

describe("confirmOrderPaid confere o valor pago", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markOrderPaidIfPending.mockResolvedValue("noop");
  });

  it("confirma quando o valor pago é igual ao total do pedido", async () => {
    await confirmOrderPaid(adminWithOrderTotal(5000), orderId, "mercadopago", 5000);
    expect(mocks.markOrderPaidIfPending).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
    );
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it.each([
    ["valor menor", 100],
    ["valor maior", 9000],
    ["valor desconhecido", null],
  ])("não marca como pago com %s e avisa a equipe", async (_caso, paid) => {
    await expect(
      confirmOrderPaid(adminWithOrderTotal(5000), orderId, "mercadopago", paid),
    ).rejects.toThrow("Valor pago não confere");
    expect(mocks.markOrderPaidIfPending).not.toHaveBeenCalled();
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "valor_divergente",
      orderId,
      expect.stringContaining("NÃO foi marcado como pago"),
    );
  });

  it("não marca como pago se o pedido não existe", async () => {
    await expect(
      confirmOrderPaid(adminWithOrderTotal(null), orderId, "mercadopago", 5000),
    ).rejects.toThrow("Valor pago não confere");
    expect(mocks.markOrderPaidIfPending).not.toHaveBeenCalled();
  });
});

describe("confirmOrderPaid avisa a equipe quando algo falha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markOrderPaidIfPending.mockResolvedValue("updated");
    mocks.sendTicketsEmail.mockResolvedValue("sent");
  });

  it("não avisa quando pagamento e e-mail dão certo", async () => {
    await expect(
      confirmOrderPaid(fakeAdmin(paidOrderRows), orderId, "mercadopago", 5000),
    ).resolves.toBe("updated");
    expect(mocks.sendTicketsEmail).toHaveBeenCalledTimes(1);
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it("avisa quando o pagamento chega mas o ingresso não é liberado", async () => {
    mocks.markOrderPaidIfPending.mockRejectedValue(
      new Error("Pagamento recebido após a capacidade esgotar."),
    );
    await expect(
      confirmOrderPaid(fakeAdmin(paidOrderRows), orderId, "mercadopago", 5000),
    ).rejects.toThrow("capacidade esgotar");
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "confirmacao_falhou",
      orderId,
      expect.stringContaining("capacidade esgotar"),
    );
  });

  it.each([
    ["failed", "recusou ou falhou"],
    ["skipped", "não configurado"],
  ])("avisa quando o e-mail dos ingressos fica %s", async (result, reason) => {
    mocks.sendTicketsEmail.mockResolvedValue(result);
    await expect(
      confirmOrderPaid(fakeAdmin(paidOrderRows), orderId, "mercadopago", 5000),
    ).resolves.toBe("updated");
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "email_nao_enviado",
      orderId,
      expect.stringContaining(reason),
    );
  });

  it("não reenvia nem avisa em confirmações repetidas", async () => {
    mocks.markOrderPaidIfPending.mockResolvedValue("noop");
    await confirmOrderPaid(fakeAdmin(paidOrderRows), orderId, "mercadopago", 5000);
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });
});
