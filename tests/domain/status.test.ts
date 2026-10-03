import { describe, expect, it } from "vitest";
import {
  canAcceptDecision,
  canEnter,
  countsTowardCapacity,
  decisionLabel,
  isRecentlyPaid,
} from "@/lib/domain/status";

describe("status", () => {
  it("só pago pode entrar", () => {
    expect(canEnter("pago")).toBe(true);
    expect(canEnter("nao_pago")).toBe(false);
    expect(canEnter("cancelado")).toBe(false);
    expect(canEnter("check_in")).toBe(false);
    expect(canEnter("estornado")).toBe(false);
  });

  it("pago e cortesia-check_in contam capacidade; nao_pago, cancelado e estornado não", () => {
    expect(countsTowardCapacity("pago")).toBe(true);
    expect(countsTowardCapacity("check_in")).toBe(true);
    expect(countsTowardCapacity("nao_pago")).toBe(false);
    expect(countsTowardCapacity("cancelado")).toBe(false);
    expect(countsTowardCapacity("estornado")).toBe(false);
  });

  it("texto do pedido aguardando decisão segue o motivo", () => {
    expect(decisionLabel("sem_vaga")).toBe("Pago sem vaga — decidir");
    expect(decisionLabel("pago_apos_cancelamento")).toBe(
      "Pago após cancelamento — decidir",
    );
    expect(decisionLabel(null)).toBe("Pago sem vaga — decidir");
    expect(decisionLabel("sessao_encerrada")).toBe("Pago após o fim das vendas — decidir");
    expect(decisionLabel("sessao_cancelada")).toBe("Pago em sessão cancelada — estornar");
    expect(decisionLabel("toString")).toBe("Pago sem vaga — decidir");
  });

  it("sessão cancelada só permite estornar", () => {
    expect(canAcceptDecision("sem_vaga")).toBe(true);
    expect(canAcceptDecision("sessao_encerrada")).toBe(true);
    expect(canAcceptDecision(null)).toBe(true);
    expect(canAcceptDecision("sessao_cancelada")).toBe(false);
  });

  it("selo 'Novo' só para pagamento nas últimas 24 h", () => {
    const now = Date.parse("2026-10-01T15:00:00Z");
    expect(isRecentlyPaid("2026-10-01T14:59:00Z", now)).toBe(true);
    expect(isRecentlyPaid("2026-09-30T15:00:01Z", now)).toBe(true);
    expect(isRecentlyPaid("2026-09-30T15:00:00Z", now)).toBe(false);
    expect(isRecentlyPaid(null, now)).toBe(false);
    expect(isRecentlyPaid("data inválida", now)).toBe(false);
  });
});
