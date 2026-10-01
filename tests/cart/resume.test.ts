import { describe, expect, it } from "vitest";

import { buildCheckoutResume } from "@/lib/cart/resume";

const NOW = Date.parse("2026-10-01T15:00:00Z");

function order(overrides: Record<string, unknown> = {}) {
  return {
    status: "cancelado",
    public_token: "token-1",
    buyer_name: "Comprador",
    buyer_email: "comprador@example.com",
    buyer_phone: null,
    expires_at: null,
    ...overrides,
  };
}

describe("retomar a compra (?retomar=)", () => {
  it("volta com itens e dados do pedido cancelado", () => {
    expect(
      buildCheckoutResume({
        order: order(),
        ticketKinds: ["inteira", "inteira", "meia"],
        offeredKinds: ["inteira", "meia"],
        now: NOW,
      }),
    ).toEqual({
      publicToken: "token-1",
      quantities: { inteira: 2, meia: 1 },
      buyer: { name: "Comprador", email: "comprador@example.com", phone: "" },
      droppedItems: false,
      awaitingUntil: null,
    });
  });

  it("tipo que saiu da venda fica de fora, com aviso", () => {
    const resume = buildCheckoutResume({
      order: order({ status: "expirado" }),
      ticketKinds: ["inteira", "meia"],
      offeredKinds: ["inteira"],
      now: NOW,
    });
    expect(resume?.quantities).toEqual({ inteira: 1, meia: 0 });
    expect(resume?.droppedItems).toBe(true);
  });

  it("pedido pendente dentro da reserva é oferecido para continuar o pagamento", () => {
    const expiresAt = new Date(NOW + 5 * 60_000).toISOString();
    const resume = buildCheckoutResume({
      order: order({ status: "pendente", expires_at: expiresAt }),
      ticketKinds: ["meia"],
      offeredKinds: ["inteira", "meia"],
      now: NOW,
    });
    expect(resume?.awaitingUntil).toBe(expiresAt);
  });

  it("pendente com reserva vencida vira checkout novo já preenchido", () => {
    const resume = buildCheckoutResume({
      order: order({ status: "pendente", expires_at: new Date(NOW - 1).toISOString() }),
      ticketKinds: ["inteira"],
      offeredKinds: ["inteira", "meia"],
      now: NOW,
    });
    expect(resume?.awaitingUntil).toBeNull();
    expect(resume?.quantities.inteira).toBe(1);
  });

  it.each(["pago", "estornado", "aguardando_decisao"])(
    "pedido %s não preenche o checkout",
    (status) => {
      expect(
        buildCheckoutResume({
          order: order({ status }),
          ticketKinds: ["inteira"],
          offeredKinds: ["inteira", "meia"],
          now: NOW,
        }),
      ).toBeNull();
    },
  );
});
