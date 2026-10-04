import { describe, expect, it } from "vitest";

import {
  isCancelConfirmation,
  parseMoneyToCents,
  parseSessionOpsSummary,
  refundBatchItemLabel,
  sessionOpsErrorMessage,
} from "@/lib/domain/session-ops";

describe("isCancelConfirmation", () => {
  it("aceita CANCELAR em maiúsculas ou minúsculas, com espaços nas pontas", () => {
    expect(isCancelConfirmation("CANCELAR")).toBe(true);
    expect(isCancelConfirmation(" cancelar ")).toBe(true);
    expect(isCancelConfirmation("Cancelar")).toBe(true);
  });

  it("recusa qualquer outra coisa", () => {
    expect(isCancelConfirmation("cancela")).toBe(false);
    expect(isCancelConfirmation("CANCELAR!")).toBe(false);
    expect(isCancelConfirmation("")).toBe(false);
    expect(isCancelConfirmation(null)).toBe(false);
    expect(isCancelConfirmation(1)).toBe(false);
  });
});

describe("parseMoneyToCents", () => {
  it("aceita as formas combinadas na spec", () => {
    expect(parseMoneyToCents("1.250,00")).toBe(125000);
    expect(parseMoneyToCents("1250,00")).toBe(125000);
    expect(parseMoneyToCents("1250")).toBe(125000);
    expect(parseMoneyToCents("R$ 1.250,00")).toBe(125000);
    expect(parseMoneyToCents("1.250")).toBe(125000);
    expect(parseMoneyToCents("12,5")).toBe(1250);
    expect(parseMoneyToCents(" 50,00 ")).toBe(5000);
    expect(parseMoneyToCents("0,99")).toBe(99);
  });

  it("recusa formatos ambíguos ou inválidos", () => {
    expect(parseMoneyToCents("1,250.00")).toBeNull();
    expect(parseMoneyToCents("1250.00")).toBeNull();
    expect(parseMoneyToCents("12.50")).toBeNull();
    expect(parseMoneyToCents("1.25,00")).toBeNull();
    expect(parseMoneyToCents("12,345")).toBeNull();
    expect(parseMoneyToCents("-10")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents("9".repeat(30))).toBeNull();
  });
});

describe("parseSessionOpsSummary", () => {
  const raw = {
    session_id: "s1",
    status: "cancelada",
    starts_at: "2026-10-10T22:00:00+00:00",
    cancelled_at: "2026-10-04T12:00:00+00:00",
    cancelled_by_name: "Equipe",
    cancel_reason: "Chuva",
    schedule_change: null,
    notices: [
      { id: "n1", kind: "cancelamento", created_at: "2026-10-04T12:00:00+00:00", requested_by_name: "Equipe", new_starts_at: null, total: 3, sent: 2, pending: 1, failed: 0, skipped: 0 },
      { id: "n2", kind: "outro", created_at: "x" },
    ],
    impact: { paid_orders: 2, paid_cents: 15000, decision_orders: 1, decision_cents: 5000, pending_orders: 0, courtesy_orders: 1, checked_in_orders: 1, refunded_orders: 0, refunded_cents: 0 },
    refund: { orders: 2, cents: 15000, skipped_check_in: 1, skipped_deadline: 0 },
    batch: {
      id: "b1", status: "em_andamento", reason: "Sessão cancelada: Chuva", requested_by_name: "Equipe",
      expected_count: 2, expected_total_cents: 15000, consecutive_errors: 0,
      created_at: "2026-10-04T12:05:00+00:00", finished_at: null,
      items: [
        { order_id: "o1", buyer_name: "Comprador", amount_cents: 10000, status: "estornado", code: null },
        { order_id: "o2", buyer_name: "Comprador 2", amount_cents: 5000, status: "inventado", code: null },
      ],
    },
    email_paused_until: null,
  };

  it("lê o resumo e descarta itens com forma inesperada", () => {
    const summary = parseSessionOpsSummary(raw);
    expect(summary?.status).toBe("cancelada");
    expect(summary?.notices).toHaveLength(1);
    expect(summary?.notices[0]).toMatchObject({ kind: "cancelamento", total: 3, sent: 2, pending: 1 });
    expect(summary?.impact.paidCents).toBe(15000);
    expect(summary?.refund).toEqual({ orders: 2, cents: 15000, skippedCheckIn: 1, skippedDeadline: 0 });
    expect(summary?.batch?.items).toEqual([
      { orderId: "o1", buyerName: "Comprador", amountCents: 10000, status: "estornado", code: null },
    ]);
  });

  it("lê a mudança de horário pendente", () => {
    const summary = parseSessionOpsSummary({
      ...raw,
      status: "ativa",
      schedule_change: {
        change_id: "c1",
        previous_starts_at: "2026-10-10T22:00:00+00:00",
        previous_ends_at: null,
        new_starts_at: "2026-10-10T23:00:00+00:00",
        new_ends_at: null,
        recipients: 5,
      },
    });
    expect(summary?.scheduleChange).toEqual({
      changeId: "c1",
      previousStartsAt: "2026-10-10T22:00:00+00:00",
      previousEndsAt: null,
      newStartsAt: "2026-10-10T23:00:00+00:00",
      newEndsAt: null,
      recipients: 5,
    });
  });

  it("forma inválida vira null", () => {
    expect(parseSessionOpsSummary(null)).toBeNull();
    expect(parseSessionOpsSummary([])).toBeNull();
    expect(parseSessionOpsSummary({ ...raw, status: "outra" })).toBeNull();
  });
});

describe("refundBatchItemLabel", () => {
  it("explica cada situação para a equipe", () => {
    expect(refundBatchItemLabel("estornado", null)).toBe("Estornado");
    expect(refundBatchItemLabel("em_processamento", null)).toBe("Aguardando confirmação do banco");
    expect(refundBatchItemLabel("pulado", "com_entrada")).toBe("Pulado — já entrou");
    expect(refundBatchItemLabel("pulado", "ja_estornado")).toBe("Pulado — já estornado");
    expect(refundBatchItemLabel("falhou", "insufficient_money")).toBe("Falhou — saldo insuficiente");
    expect(refundBatchItemLabel("falhou", "codigo_novo")).toBe("Falhou — recusado pelo Mercado Pago");
    expect(refundBatchItemLabel("pendente", "erro_temporario")).toBe("Tentando de novo");
  });
});

describe("sessionOpsErrorMessage", () => {
  it("traduz os erros conhecidos do banco", () => {
    expect(sessionOpsErrorMessage("LOTE_TOTAL_MUDOU:15000")).toBe(
      "Os números mudaram. Confira de novo antes de confirmar.",
    );
    expect(sessionOpsErrorMessage("CANCELAR_CONFIRMACAO: Digite CANCELAR.")).toBe("Digite CANCELAR para confirmar.");
    expect(sessionOpsErrorMessage("AVISO_SEM_ALTERACAO: x")).toContain("Nenhuma mudança");
  });

  it("erro inesperado não vaza detalhe", () => {
    expect(sessionOpsErrorMessage("duplicate key value violates unique constraint")).toBeNull();
    expect(sessionOpsErrorMessage(undefined)).toBeNull();
  });
});
