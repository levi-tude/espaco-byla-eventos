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

import { confirmOrderPaid, sendOrderTicketsEmail } from "@/lib/payments/confirm-order";
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
    status: "pendente",
    total_cents: 5000,
    buyer_email: "comprador@example.com",
    buyer_name: "Comprador Teste",
    public_token: "token-publico",
    event_id: "evento-1",
    session_id: "sessao-1",
  },
  events: { name: "Evento", venue: "Espaço", starts_at: "2026-10-10T20:00:00Z" },
  event_sessions: { name: null, starts_at: "2026-10-10T20:00:00Z", ends_at: null },
  tickets: [{ code: "codigo-1", buyer_name: "Comprador Teste", kind: "inteira" }],
};

function adminWithOrder(totalCents: number | null, status = "pendente") {
  return fakeAdmin({
    orders: totalCents === null ? null : { status, total_cents: totalCents },
  });
}

describe("confirmOrderPaid confere o valor pago", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markOrderPaidIfPending.mockResolvedValue("noop");
  });

  it("confirma quando o valor pago é igual ao total do pedido", async () => {
    await confirmOrderPaid(adminWithOrder(5000), orderId, "mercadopago", 5000);
    expect(mocks.markOrderPaidIfPending).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
      {},
    );
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it("repassa os IDs do Mercado Pago", async () => {
    const ids = { providerOrderId: "ORD01", providerPaymentId: "PAY01" };
    await confirmOrderPaid(adminWithOrder(5000), orderId, "mercadopago", 5000, ids);
    expect(mocks.markOrderPaidIfPending).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      "mercadopago",
      ids,
    );
  });

  it.each([
    ["valor menor", 100],
    ["valor maior", 9000],
    ["valor desconhecido", null],
  ])("não marca como pago com %s e avisa a equipe", async (_caso, paid) => {
    await expect(
      confirmOrderPaid(adminWithOrder(5000), orderId, "mercadopago", paid),
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

  it.each(["expirado", "cancelado", "status_desconhecido"])(
    "confere o valor quando o pedido está %s",
    async (status) => {
      await expect(
        confirmOrderPaid(adminWithOrder(5000, status), orderId, "mercadopago", 100),
      ).rejects.toThrow("Valor pago não confere");
      expect(mocks.markOrderPaidIfPending).not.toHaveBeenCalled();
    },
  );

  it.each(["pago", "estornado", "aguardando_decisao"])(
    "não compara valor nem dá alerta falso quando o pedido já está %s",
    async (status) => {
      await expect(
        confirmOrderPaid(adminWithOrder(5000, status), orderId, "mercadopago", null),
      ).resolves.toBe("noop");
      expect(mocks.alertTeam).not.toHaveBeenCalled();
      expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
    },
  );

  it("não marca como pago se o pedido não existe", async () => {
    await expect(
      confirmOrderPaid(adminWithOrder(null), orderId, "mercadopago", 5000),
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
      new Error("Não foi possível confirmar o pagamento do pedido."),
    );
    await expect(
      confirmOrderPaid(fakeAdmin(paidOrderRows), orderId, "mercadopago", 5000),
    ).rejects.toThrow("Não foi possível confirmar");
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "confirmacao_falhou",
      orderId,
      expect.stringContaining("Não foi possível confirmar"),
    );
  });

  it.each([
    ["needs_decision_capacity", "pago_sem_vaga", "Pago sem vaga — decidir"],
    [
      "needs_decision_cancelled",
      "pago_apos_cancelamento",
      "Pago após cancelamento — decidir",
    ],
  ])(
    "%s avisa a equipe e não envia ingressos",
    async (outcome, kind, label) => {
      mocks.markOrderPaidIfPending.mockResolvedValue(outcome);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(
        confirmOrderPaid(fakeAdmin(paidOrderRows), orderId, "mercadopago", 5000),
      ).resolves.toBe(outcome);
      expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
      expect(mocks.alertTeam).toHaveBeenCalledTimes(1);
      expect(mocks.alertTeam).toHaveBeenCalledWith(
        expect.anything(),
        kind,
        orderId,
        expect.stringContaining(label),
      );
    },
  );

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

describe("sendOrderTicketsEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devolve true quando o e-mail sai", async () => {
    mocks.sendTicketsEmail.mockResolvedValue("sent");
    await expect(sendOrderTicketsEmail(fakeAdmin(paidOrderRows), orderId)).resolves.toBe(true);
    expect(mocks.alertTeam).not.toHaveBeenCalled();
  });

  it("usa o horário e o nome da sessão do pedido, não o do evento", async () => {
    mocks.sendTicketsEmail.mockResolvedValue("sent");
    await sendOrderTicketsEmail(
      fakeAdmin({
        ...paidOrderRows,
        event_sessions: {
          name: "Sessão infantil",
          starts_at: "2026-10-10T19:00:00Z",
          ends_at: "2026-10-10T20:30:00Z",
        },
      }),
      orderId,
    );
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2026-10-10T19:00:00Z",
        endsAt: "2026-10-10T20:30:00Z",
        sessionName: "Sessão infantil",
        orderNumber: "00000000",
      }),
    );
  });

  it("leva ao e-mail o resumo do pedido com a taxa gravada no banco", async () => {
    mocks.sendTicketsEmail.mockResolvedValue("sent");
    await sendOrderTicketsEmail(
      fakeAdmin({
        ...paidOrderRows,
        orders: { ...paidOrderRows.orders, total_cents: 5250, service_fee_cents: 250 },
        order_items: [{ name: "Inteira", quantity: 1, line_total_cents: 5000 }],
      }),
      orderId,
    );
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: {
          items: [{ name: "Inteira", quantity: 1, lineTotalCents: 5000 }],
          feeCents: 250,
          totalCents: 5250,
        },
      }),
    );
  });

  it("cortesia (total 0) vai sem resumo de valores", async () => {
    mocks.sendTicketsEmail.mockResolvedValue("sent");
    await sendOrderTicketsEmail(
      fakeAdmin({
        ...paidOrderRows,
        orders: { ...paidOrderRows.orders, total_cents: 0, service_fee_cents: 0 },
        order_items: [{ name: "Cortesia", quantity: 1, line_total_cents: 0 }],
      }),
      orderId,
    );
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(
      expect.objectContaining({ summary: null }),
    );
  });

  it("não envia e avisa a equipe quando a sessão não é encontrada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendOrderTicketsEmail(fakeAdmin({ ...paidOrderRows, event_sessions: null }), orderId),
    ).resolves.toBe(false);
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "email_nao_enviado",
      orderId,
      expect.stringContaining("sessão não encontrada"),
    );
  });

  it("devolve false e avisa a equipe quando não há ingressos pagos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendOrderTicketsEmail(fakeAdmin({ ...paidOrderRows, tickets: [] }), orderId),
    ).resolves.toBe(false);
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled();
    expect(mocks.alertTeam).toHaveBeenCalledWith(
      expect.anything(),
      "email_nao_enviado",
      orderId,
      expect.stringContaining("ingressos não encontrados"),
    );
  });
});
