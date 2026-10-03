import { describe, expect, it } from "vitest";
import { checkInMessage, parseCheckInOutcome } from "@/lib/domain/check-in";

describe("resultado do check-in vindo do banco", () => {
  it("só 'ok' libera a entrada", () => {
    expect(parseCheckInOutcome("ok")).toEqual({ ok: true });
  });

  it.each([
    ["ja_usado", "ja_usado"],
    ["evento_errado", "evento_errado"],
    ["nao_encontrado", "nao_encontrado"],
    ["nao_pago", "nao_pago"],
    ["cancelado", "cancelado"],
    ["estornado", "estornado"],
    ["invalido", "invalido"],
  ] as const)("recusa %s", (outcome, reason) => {
    expect(parseCheckInOutcome(outcome)).toEqual({ ok: false, reason });
  });

  it.each(["desconhecido", "", "OK", "toString", "__proto__", null, undefined, 1])(
    "recusa resultado fora da lista (%s)",
    (outcome) => {
      expect(parseCheckInOutcome(outcome)).toEqual({ ok: false, reason: "invalido" });
    },
  );
});

describe("mensagens do check-in", () => {
  it.each([
    ["nao_encontrado", "Ingresso não encontrado"],
    ["nao_pago", "Ingresso não pago"],
    ["cancelado", "Cancelado"],
    ["estornado", "Estornado — não liberar entrada"],
    ["ja_usado", "Já utilizado"],
    ["invalido", "Ingresso inválido — não liberar entrada"],
  ] as const)("traduz %s para português", (reason, message) => {
    expect(checkInMessage(reason)).toBe(message);
  });

  it("ingresso de outro evento mostra o nome do evento", () => {
    expect(checkInMessage("evento_errado", "  Festa Junina  ")).toBe(
      "Ingresso de outro evento: Festa Junina",
    );
  });

  it.each([null, undefined, "", "   "])("sem nome do evento (%s) ainda avisa", (name) => {
    expect(checkInMessage("evento_errado", name)).toBe("Ingresso de outro evento");
  });
});
