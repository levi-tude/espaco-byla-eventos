import { describe, expect, it } from "vitest";

import {
  arrivalBucketLabel,
  arrivalBuckets,
  averageTicket,
  closeFinance,
  countsTowardCapacity,
  noShowCount,
  occupancyPercent,
  reportBucket,
  reportedFinanceCloses,
  summarizePeople,
  unitsSold,
  type ReportTicket,
} from "@/lib/domain/event-report";

const valid = (partial: Partial<ReportTicket> & Pick<ReportTicket, "kind">): ReportTicket => ({
  status: "pago",
  peoplePerUnit: 1,
  preset: null,
  hasUnlockCode: false,
  ...partial,
});

describe("lotação e tipos", () => {
  it("capacitação fica fora da lotação e o bônus entra", () => {
    const summary = summarizePeople([
      valid({ kind: "inteira", preset: "inteira" }),
      valid({ kind: "cortesia" }),
      valid({ kind: "meia", preset: "meia" }),
      valid({ kind: "inteira", hasUnlockCode: true, preset: "inteira" }),
      valid({ kind: "inteira", status: "cancelado" }),
      valid({ kind: "inteira", status: "estornado" }),
    ]);
    expect(summary.occupied).toBe(3);
    expect(summary.training).toBe(1);
    expect(summary.valid).toBe(4);
    expect(summary.buckets.bonus).toBe(1);
    expect(summary.buckets.capacitacao).toBe(1);
    expect(countsTowardCapacity(valid({ kind: "inteira", hasUnlockCode: true }))).toBe(false);
    expect(countsTowardCapacity(valid({ kind: "cortesia" }))).toBe(true);
  });

  it("casadinha conta pessoas, e a unidade é o item do pedido", () => {
    const people = Array.from({ length: 10 }, () =>
      valid({ kind: "inteira", preset: "casadinha", peoplePerUnit: 2 }),
    );
    const summary = summarizePeople(people);
    expect(reportBucket(people[0])).toBe("casadinha");
    expect(summary.buckets.casadinha).toBe(10);
    expect(summary.occupied).toBe(10);
    expect(unitsSold(Array.from({ length: 5 }, () => ({ people: 2, peoplePerUnit: 2 })))).toBe(5);
    expect(reportBucket(valid({ kind: "inteira", preset: "familia", peoplePerUnit: 4 }))).toBe("familia");
  });

  it("o exemplo das duas sessões fecha 78 na lotação e 4 de capacitação", () => {
    const row = (kind: ReportTicket["kind"], preset: string, count: number, unlock = false): ReportTicket[] =>
      Array.from({ length: count }, () => valid({ kind, preset, hasUnlockCode: unlock, peoplePerUnit: preset === "casadinha" ? 2 : 1 }));
    const summary = summarizePeople([
      ...row("inteira", "inteira", 9),
      ...row("inteira", "casadinha", 20),
      ...row("meia", "meia", 40),
      ...row("cortesia", "cortesia", 9),
      ...row("inteira", "inteira", 4, true),
    ]);
    expect(summary.occupied).toBe(78);
    expect(summary.training).toBe(4);
    expect(summary.valid).toBe(82);
    expect(occupancyPercent(78, 140)).toBe(56);
  });
});

describe("dinheiro", () => {
  it("o exemplo real fecha: organizador + taxa bruta = cliente; líquida = bruta − tarifa", () => {
    const closed = closeFinance({ organizerCents: 235_000, grossFeeCents: 14_971, providerFeeCents: 4_406 });
    expect(closed.clientPaidCents).toBe(249_971);
    expect(closed.netFeeCents).toBe(10_565);
    expect(closed.organizerCents + closed.netFeeCents + closed.providerFeeCents).toBe(249_971);
    expect(reportedFinanceCloses(closed)).toBe(true);
  });

  it("a tarifa de estorno continua na conta e a soma ainda fecha", () => {
    const closed = closeFinance({ organizerCents: 100_00, grossFeeCents: 10_00, providerFeeCents: 1_50 });
    expect(closed.netFeeCents).toBe(8_50);
    expect(reportedFinanceCloses({ ...closed, netFeeCents: 9_00 })).toBe(false);
  });

  it("ticket médio do exemplo: por pedido e por pessoa pagante", () => {
    expect(averageTicket(235_000, 43, 73)).toEqual({ perOrderCents: 5465, perPersonCents: 3219 });
    expect(averageTicket(0, 0, 0)).toEqual({ perOrderCents: null, perPersonCents: null });
  });
});

describe("portaria no relatório", () => {
  const now = Date.parse("2026-11-28T22:00:00Z");

  it("falta só depois do fim da sessão ativa", () => {
    expect(noShowCount({ notEntered: 4, sessionStatus: "ativa", endsAt: "2026-11-28T21:00:00Z", now })).toBe(4);
    expect(noShowCount({ notEntered: 4, sessionStatus: "ativa", endsAt: "2026-11-28T23:00:00Z", now })).toBeNull();
    expect(noShowCount({ notEntered: 4, sessionStatus: "cancelada", endsAt: "2026-11-28T21:00:00Z", now })).toBeNull();
    expect(noShowCount({ notEntered: 4, sessionStatus: "ativa", endsAt: null, now })).toBeNull();
  });

  it("agrupa a chegada de 10 em 10 minutos no horário de Brasília", () => {
    expect(arrivalBucketLabel("2026-11-28T20:04:00Z")).toBe("17:00");
    expect(arrivalBucketLabel("2026-11-28T20:09:00Z")).toBe("17:00");
    expect(arrivalBuckets(["2026-11-28T20:04:00Z", "2026-11-28T20:09:00Z", "2026-11-28T20:12:00Z"])).toEqual([
      { label: "17:00", count: 2 },
      { label: "17:10", count: 1 },
    ]);
  });
});
