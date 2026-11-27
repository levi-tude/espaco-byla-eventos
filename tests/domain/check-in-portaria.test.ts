import { describe, expect, it } from "vitest";

import {
  buildOrderSummary,
  checkInCounts,
  manualCheckInPrompt,
  manualCheckInResult,
  orderSummaryLine,
  successTone,
  ticketMatchesSearch,
  usedByLine,
} from "@/lib/domain/check-in";

describe("pedido na tela da portaria", () => {
  it("conta só ingressos válidos e marca o lido agora", () => {
    const summary = buildOrderSummary(
      [
        { id: "a", kind: "meia", status: "check_in", checkedInAt: "2026-11-28T20:04:00Z", typeLabel: "Meia-entrada" },
        { id: "b", kind: "inteira", status: "pago", checkedInAt: null, typeLabel: "Inteira" },
        { id: "c", kind: "inteira", status: "estornado", checkedInAt: null, typeLabel: "Inteira" },
      ],
      "a",
    );
    expect(summary.total).toBe(2);
    expect(summary.entered).toBe(1);
    expect(summary.tickets[0]).toMatchObject({ current: true, enteredAt: "17h04" });
    expect(summary.tickets[1]).toMatchObject({ current: false, entered: false, enteredAt: null });
  });

  it.each([
    [{ total: 1, entered: 1 }, "Pedido com 1 ingresso · 1 já entrou"],
    [{ total: 4, entered: 0 }, "Pedido com 4 ingressos · 0 já entraram"],
    [{ total: 7, entered: 3 }, "Pedido com 7 ingressos · 3 já entraram"],
  ])("linha do pedido %o", (summary, line) => {
    expect(orderSummaryLine(summary)).toBe(line);
  });

  it("linha de quem validou", () => {
    expect(usedByLine("2026-11-28T20:12:00Z", "Ana")).toBe("Entrou às 17h12 · validado por Ana");
    expect(usedByLine("2026-11-28T20:12:00Z", null)).toBe("Entrou às 17h12");
    expect(usedByLine(null, null)).toBe("");
  });

  it("meia fica amarela; inteira e bônus verdes", () => {
    expect(successTone("meia")).toBe("meia");
    expect(successTone("inteira")).toBe("success");
    expect(successTone("cortesia")).toBe("success");
    expect(successTone(null)).toBe("success");
  });
});

describe("contador da sessão", () => {
  it("presentes, vendidos, capacidade e meias", () => {
    expect(
      checkInCounts(
        [
          { kind: "meia", status: "check_in" },
          { kind: "meia", status: "pago" },
          { kind: "inteira", status: "check_in" },
          { kind: "cortesia", status: "pago" },
          { kind: "inteira", status: "estornado" },
          { kind: "inteira", status: "nao_pago" },
        ],
        70,
      ),
    ).toEqual({ present: 2, sold: 4, capacity: 70, meiaPresent: 1, meiaSold: 2 });
  });

  it("sem capacidade válida mostra vazio", () => {
    expect(checkInCounts([], null).capacity).toBeNull();
    expect(checkInCounts([], 0).capacity).toBeNull();
  });
});

describe("entrada pela lista de participantes", () => {
  const ticket = { buyerName: "João Conceição", buyerEmail: "joao.c@exemplo.com" };

  it.each([
    ["joao", true],
    ["CONCEIÇÃO", true],
    ["conceicao", true],
    ["exemplo.com", true],
    ["maria", false],
    ["   ", true],
  ])("busca '%s'", (term, expected) => {
    expect(ticketMatchesSearch(ticket, term)).toBe(expected);
  });

  it("confirmação lembra o comprovante da meia e a sessão", () => {
    const text = manualCheckInPrompt({
      buyerName: "Maria",
      typeLabel: "Meia-entrada",
      kind: "meia",
      sessionLabel: "sáb, 28/11 · 17h00",
    });
    expect(text).toContain("Dar entrada para Maria?");
    expect(text).toContain("Sessão: sáb, 28/11 · 17h00");
    expect(text).toContain("MEIA: confira o comprovante");
    expect(manualCheckInPrompt({ buyerName: "Ivan", typeLabel: "Bônus", kind: "cortesia" })).not.toContain(
      "MEIA",
    );
  });

  it("mensagem depois da entrada", () => {
    expect(
      manualCheckInResult({
        ok: true,
        buyerName: "Maria",
        kind: "meia",
        typeLabel: "Meia-entrada",
        order: { total: 3, entered: 2 },
      }),
    ).toEqual({
      ok: true,
      text: "Entrada registrada: Maria · Meia-entrada. Meia: conferir comprovante. Pedido com 3 ingressos · 2 já entraram.",
    });
    expect(
      manualCheckInResult({ ok: false, message: "Já utilizado", usedLine: "Entrou às 17h12" }),
    ).toEqual({ ok: false, text: "Já utilizado · Entrou às 17h12" });
  });
});
