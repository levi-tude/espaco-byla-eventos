import { describe, expect, it } from "vitest";
import {
  checkInMessage,
  checkInSessionLine,
  parseCheckInOutcome,
} from "@/lib/domain/check-in";

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

  it("sessão errada diz a sessão certa, com nome se houver", () => {
    expect(
      checkInMessage("sessao_errada", null, {
        name: "Sessão infantil",
        startsAt: "2026-10-10T19:00:00.000Z",
      }),
    ).toBe("Sessão errada — este ingresso é da sessão “Sessão infantil”, das 16h00 (sáb, 10/10)");
    expect(checkInMessage("sessao_errada")).toBe("Sessão errada");
  });

  it("sessão cancelada nunca libera", () => {
    expect(checkInMessage("sessao_cancelada")).toBe("Sessão cancelada — não liberar entrada");
    expect(parseCheckInOutcome("sessao_cancelada")).toEqual({
      ok: false,
      reason: "sessao_cancelada",
    });
    expect(parseCheckInOutcome("sessao_errada")).toEqual({ ok: false, reason: "sessao_errada" });
  });
});

describe("linha da sessão no 'Pode entrar'", () => {
  it("nome, data curta e evento", () => {
    expect(
      checkInSessionLine("Sessão infantil", "2026-10-10T19:00:00.000Z", "Festa"),
    ).toBe("Sessão infantil · sáb, 10/10 · 16h00 · Festa");
  });

  it("sem nome nem data, não sobra separador", () => {
    expect(checkInSessionLine(null, "2026-10-10T22:00:00.000Z", "Festa")).toBe(
      "sáb, 10/10 · 19h00 · Festa",
    );
    expect(checkInSessionLine(null, null, null)).toBe("");
  });
});
