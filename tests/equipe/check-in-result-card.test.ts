import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CheckInResultCard,
  toCheckInResult,
  type CheckInResult,
} from "@/components/equipe/CheckInResultCard";
import { CheckInCounter } from "@/components/equipe/CheckInCounter";

function html(result: CheckInResult) {
  return renderToStaticMarkup(createElement(CheckInResultCard, { result }));
}

const order = {
  total: 3,
  entered: 2,
  tickets: [
    { typeLabel: "Meia-entrada", kind: "meia" as const, entered: true, enteredAt: "17h04", current: true },
    { typeLabel: "Inteira", kind: "inteira" as const, entered: false, enteredAt: null, current: false },
    { typeLabel: "Inteira", kind: "inteira" as const, entered: true, enteredAt: "16h58", current: false },
  ],
};

describe("tela de resultado da leitura", () => {
  it("meia: amarela, faixa 'conferir comprovante', nome e lista do pedido", () => {
    const result = toCheckInResult({
      ok: true,
      buyerName: "Maria Souza",
      kind: "meia",
      typeLabel: "Meia-entrada",
      sessionLine: "sáb, 28/11 · 17h00 · Cápsulas do Tempo",
      order,
    });
    expect(result.tone).toBe("meia");
    const markup = html(result);
    expect(markup).toContain('data-tone="meia"');
    expect(markup).toContain("Meia – conferir comprovante");
    expect(markup).toContain("Maria Souza");
    expect(markup).toContain("Pedido com 3 ingressos · 2 já entraram");
    expect(markup).toContain("entrou 17h04");
    expect(markup).toContain("não entrou");
    expect(markup).toContain("(este)");
  });

  it("bônus: verde com faixa Bônus", () => {
    const markup = html(
      toCheckInResult({ ok: true, buyerName: "Ivan", kind: "cortesia", typeLabel: "Bônus", sessionLine: "" }),
    );
    expect(markup).toContain('data-tone="success"');
    expect(markup).toMatch(/>Bônus<\/p>/);
    expect(markup).toContain("Ivan");
  });

  it("sem os detalhes extras, mostra o card simples (sem lista)", () => {
    const markup = html(
      toCheckInResult({ ok: true, buyerName: "Ana", kind: "inteira", typeLabel: "Inteira", sessionLine: "" }),
    );
    expect(markup).toContain("Pode entrar");
    expect(markup).toContain("Ana");
    expect(markup).not.toContain("Pedido com");
  });

  it("já utilizado: vermelho com hora e quem validou", () => {
    const result = toCheckInResult({
      ok: false,
      reason: "ja_usado",
      message: "Já utilizado",
      buyerName: "Maria Souza",
      usedLine: "Entrou às 17h04 · validado por Ana",
      order,
    });
    expect(result.tone).toBe("used");
    const markup = html(result);
    expect(markup).toContain("Já utilizado");
    expect(markup).toContain("Entrou às 17h04 · validado por Ana");
    expect(markup).toContain("Não liberar com este QR");
  });

  it("sessão errada: alerta vermelho próprio", () => {
    const result = toCheckInResult({
      ok: false,
      reason: "sessao_errada",
      message: "Sessão errada — este ingresso é da sessão das 19h00 (sáb, 28/11)",
    });
    expect(result.tone).toBe("wrong_session");
    const markup = html(result);
    expect(markup).toContain("Sessão errada");
    expect(markup).toContain("Não liberar nesta sessão");
  });

  it("outras recusas e resposta antiga (sem reason) ficam vermelhas com a mensagem", () => {
    expect(toCheckInResult({ ok: false, message: "Estornado — não liberar entrada" })).toEqual({
      tone: "error",
      message: "Estornado — não liberar entrada",
    });
  });

  it("pedido malformado é ignorado", () => {
    const result = toCheckInResult({
      ok: true,
      buyerName: "Ana",
      kind: "inteira",
      order: { foo: 1 } as never,
    });
    expect(result).toMatchObject({ tone: "success", typeLabel: "Inteira", order: undefined });
  });
});

describe("contador grande da portaria", () => {
  it("mostra presentes, vendidos, capacidade e meias", () => {
    const markup = renderToStaticMarkup(
      createElement(CheckInCounter, {
        counts: { present: 23, sold: 36, outsideCapacity: 0, capacity: 70, meiaPresent: 12, meiaSold: 20 },
      }),
    );
    expect(markup).toContain(">23<");
    expect(markup).toContain(">36<");
    expect(markup).toContain(">70<");
    expect(markup).toContain("Meias que entraram");
    expect(markup).toContain("faltam 13 pessoas");
  });
});
