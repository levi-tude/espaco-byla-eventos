import { describe, expect, it } from "vitest";

import {
  feeRefusalMessage,
  feeSituation,
  parseEventFinanceSummary,
  parseServiceFeeOverview,
  todayKey,
} from "@/lib/domain/fee-payout";

const payout = { createdAt: "2026-10-06T15:00:00Z", createdByName: "Admin Teste", pixDate: "2026-10-06" };

describe("todayKey", () => {
  it("usa o dia de São Paulo, não o de UTC", () => {
    expect(todayKey(new Date("2026-10-05T02:30:00Z"))).toBe("2026-10-04");
    expect(todayKey(new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-05");
  });
});

describe("feeSituation", () => {
  const base = { dueDate: "2026-10-05", lastPayout: null };

  it("antes da data: aguardando fim do evento", () => {
    expect(feeSituation({ ...base, balanceCents: 1875, today: "2026-10-04" })).toEqual({
      kind: "aguardando",
      dueDate: "2026-10-05",
    });
  });

  it("no dia de pagar: a pagar", () => {
    expect(feeSituation({ ...base, balanceCents: 1875, today: "2026-10-05" })).toEqual({
      kind: "a_pagar",
      balanceCents: 1875,
    });
  });

  it("saldo zero com repasse: pago", () => {
    expect(feeSituation({ ...base, balanceCents: 0, lastPayout: payout, today: "2026-10-07" })).toEqual({
      kind: "pago",
      last: payout,
    });
  });

  it("saldo zero sem repasse: sem taxa", () => {
    expect(feeSituation({ ...base, balanceCents: 0, today: "2026-10-07" }).kind).toBe("sem_taxa");
  });

  it("saldo negativo: desconto pendente, mesmo antes da data", () => {
    expect(feeSituation({ ...base, balanceCents: -250, today: "2026-10-01" })).toEqual({
      kind: "desconto",
      balanceCents: -250,
    });
  });

  it("sem data (evento sem sessões) nunca fica a pagar", () => {
    expect(feeSituation({ dueDate: null, balanceCents: 100, lastPayout: null, today: "2030-01-01" }).kind).toBe(
      "aguardando",
    );
  });
});

describe("parse", () => {
  it("resumo inválido = null", () => {
    expect(parseEventFinanceSummary(null)).toBeNull();
    expect(parseEventFinanceSummary({})).toBeNull();
    expect(parseServiceFeeOverview({ events: "x" })).toBeNull();
  });

  it("resumo do evento com campos do banco", () => {
    const summary = parseEventFinanceSummary({
      event_id: "e1",
      due_date: "2026-10-05",
      fee_cents: 1875,
      balance_cents: "1875",
      history: [{ id: "p1", kind: "ajuste", amount_cents: -100, reason: "corrige", created_by_name: "Ana", created_at: "x" }, 3],
      contested_order_ids: ["o1", 2],
      last_payout: { created_at: "2026-10-06T15:00:00Z", created_by_name: "Ana", pix_date: "2026-10-06" },
      pending_discounts: [{ event_id: "e2", event_name: "Outro", balance_cents: -250 }],
      suggested_payout_cents: 1625,
    });
    expect(summary).toMatchObject({
      eventId: "e1",
      feeCents: 1875,
      balanceCents: 1875,
      contestedOrderIds: ["o1"],
      suggestedPayoutCents: 1625,
      lastPayout: { createdByName: "Ana", pixDate: "2026-10-06" },
      pendingDiscounts: [{ eventId: "e2", balanceCents: -250 }],
    });
    expect(summary?.history).toHaveLength(1);
    expect(summary?.history[0]).toMatchObject({ kind: "ajuste", amountCents: -100, reason: "corrige" });
  });

  it("visão geral", () => {
    const overview = parseServiceFeeOverview({
      events: [{ event_id: "e1", name: "Show", balance_cents: 500, last_payout: { created_at: "x", note: "E123" } }],
      to_pay_cents: 500,
      paid_in_period_cents: 0,
      pending_discount_cents: -250,
    });
    expect(overview?.events[0]).toMatchObject({ eventId: "e1", balanceCents: 500, lastPayout: { note: "E123" } });
    expect(overview?.pendingDiscountCents).toBe(-250);
  });
});

describe("feeRefusalMessage", () => {
  it("traduz prefixos e ignora o resto", () => {
    expect(feeRefusalMessage("TAXA_DEV: x")).toMatch(/desenvolvedor/);
    expect(feeRefusalMessage("TAXA_MUDOU:1500")).toMatch(/mudaram/);
    expect(feeRefusalMessage("erro qualquer")).toBeNull();
  });
});
