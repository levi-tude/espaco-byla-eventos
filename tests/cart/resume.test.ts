import { describe, expect, it } from "vitest";

import { buildCheckoutResume } from "@/lib/cart/resume";

const NOW = Date.parse("2026-10-01T15:00:00Z");
const INTEIRA = "20000000-0000-4000-8000-000000000001";
const MEIA = "20000000-0000-4000-8000-000000000002";
const CASADINHA = "20000000-0000-4000-8000-000000000004";

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
  it("volta com itens (em unidades) e dados do pedido cancelado", () => {
    expect(
      buildCheckoutResume({
        order: order(),
        items: [
          { ticket_type_id: INTEIRA, quantity: 2 },
          { ticket_type_id: CASADINHA, quantity: 1 },
        ],
        offeredTypeIds: [INTEIRA, MEIA, CASADINHA],
        now: NOW,
      }),
    ).toEqual({
      publicToken: "token-1",
      quantities: { [INTEIRA]: 2, [CASADINHA]: 1 },
      buyer: { name: "Comprador", email: "comprador@example.com", phone: "" },
      droppedItems: false,
      awaitingUntil: null,
    });
  });

  it("tipo que saiu da venda fica de fora, com aviso", () => {
    const resume = buildCheckoutResume({
      order: order({ status: "expirado" }),
      items: [
        { ticket_type_id: INTEIRA, quantity: 1 },
        { ticket_type_id: MEIA, quantity: 1 },
      ],
      offeredTypeIds: [INTEIRA],
      now: NOW,
    });
    expect(resume?.quantities).toEqual({ [INTEIRA]: 1 });
    expect(resume?.droppedItems).toBe(true);
  });

  it("pedido pendente dentro da reserva é oferecido para continuar o pagamento", () => {
    const expiresAt = new Date(NOW + 5 * 60_000).toISOString();
    const resume = buildCheckoutResume({
      order: order({ status: "pendente", expires_at: expiresAt }),
      items: [{ ticket_type_id: MEIA, quantity: 1 }],
      offeredTypeIds: [INTEIRA, MEIA],
      now: NOW,
    });
    expect(resume?.awaitingUntil).toBe(expiresAt);
  });

  it("pendente com reserva vencida vira checkout novo já preenchido", () => {
    const resume = buildCheckoutResume({
      order: order({ status: "pendente", expires_at: new Date(NOW - 1).toISOString() }),
      items: [{ ticket_type_id: INTEIRA, quantity: 1 }],
      offeredTypeIds: [INTEIRA, MEIA],
      now: NOW,
    });
    expect(resume?.awaitingUntil).toBeNull();
    expect(resume?.quantities[INTEIRA]).toBe(1);
  });

  it.each(["pago", "estornado", "aguardando_decisao"])(
    "pedido %s não preenche o checkout",
    (status) => {
      expect(
        buildCheckoutResume({
          order: order({ status }),
          items: [{ ticket_type_id: INTEIRA, quantity: 1 }],
          offeredTypeIds: [INTEIRA, MEIA],
          now: NOW,
        }),
      ).toBeNull();
    },
  );
});
