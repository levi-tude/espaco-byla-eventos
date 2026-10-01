import { describe, expect, it } from "vitest";
import { checkInMessage, evaluateCheckIn } from "@/lib/domain/check-in";

describe("check-in", () => {
  it("libera ingresso pago do evento certo", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "e1",
        eventId: "e1",
        status: "pago",
      }),
    ).toEqual({ ok: true });
  });
  it("bloqueia já usado", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "e1",
        eventId: "e1",
        status: "check_in",
      }),
    ).toEqual({ ok: false, reason: "ja_usado" });
  });
  it("bloqueia evento errado", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "11111111-1111-4111-8111-111111111111",
        eventId: "22222222-2222-4222-8222-222222222222",
        status: "pago",
      }),
    ).toEqual({ ok: false, reason: "evento_errado" });
  });
  it("bloqueia não pago", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "33333333-3333-4333-8333-333333333333",
        eventId: "33333333-3333-4333-8333-333333333333",
        status: "nao_pago",
      }),
    ).toEqual({ ok: false, reason: "nao_pago" });
  });
  it("bloqueia cancelado", () => {
    expect(
      evaluateCheckIn({
        ticketEventId: "44444444-4444-4444-8444-444444444444",
        eventId: "44444444-4444-4444-8444-444444444444",
        status: "cancelado",
      }),
    ).toEqual({ ok: false, reason: "cancelado" });
  });
  it("bloqueia estornado", () => {
    expect(
      evaluateCheckIn({ ticketEventId: "e1", eventId: "e1", status: "estornado" }),
    ).toEqual({ ok: false, reason: "estornado" });
  });
  it.each(["desconhecido", "", "PAGO", "toString", "__proto__"])(
    "bloqueia status fora da lista (%s)",
    (status) => {
      expect(evaluateCheckIn({ ticketEventId: "e1", eventId: "e1", status })).toEqual({
        ok: false,
        reason: "invalido",
      });
    },
  );
});

describe("mensagens do check-in", () => {
  it.each([
    ["evento_errado", "Evento errado"],
    ["nao_pago", "Ingresso não pago"],
    ["cancelado", "Cancelado"],
    ["estornado", "Estornado — não liberar entrada"],
    ["ja_usado", "Já utilizado"],
    ["invalido", "Ingresso inválido — não liberar entrada"],
  ] as const)("traduz %s para português", (reason, message) => {
    expect(checkInMessage(reason)).toBe(message);
  });
});
