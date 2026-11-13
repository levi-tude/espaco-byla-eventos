import { describe, expect, it } from "vitest";

import {
  buildEventTotals,
  buildTypeRows,
  mergeTypeRows,
} from "@/lib/organizer/sales-breakdown";

const INTEIRA = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Inteira",
  peoplePerUnit: 1,
  sortOrder: 0,
};
const CASADINHA = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Casadinha",
  peoplePerUnit: 2,
  sortOrder: 1,
};
const BOLSISTA = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Bolsista",
  peoplePerUnit: 1,
  sortOrder: 2,
};

describe("buildTypeRows", () => {
  it("conta pessoas, unidades e valor por tipo (casadinha = 2 pessoas)", () => {
    const rows = buildTypeRows(
      [
        { session_id: "s1", ticket_type_id: CASADINHA.id, price_cents: 4000 },
        { session_id: "s1", ticket_type_id: CASADINHA.id, price_cents: 4000 },
        { session_id: "s1", ticket_type_id: INTEIRA.id, price_cents: 5000 },
        { session_id: "s1", ticket_type_id: BOLSISTA.id, price_cents: 2500 },
      ],
      [INTEIRA, CASADINHA, BOLSISTA],
      {
        capacity: 100,
        sold: 4,
        held: 0,
        remaining: 96,
        categories: {
          inteira: { quota: null, sold: 3, taken: 3, remaining: null },
          meia: { quota: null, sold: 0, taken: 0, remaining: null },
        },
        types: [
          {
            ticketTypeId: CASADINHA.id,
            unitsTaken: 1,
            unitsSold: 1,
            maxUnits: 10,
            remainingUnits: 9,
            hasSales: true,
            priceCents: 8000,
            onSale: true,
          },
          {
            ticketTypeId: INTEIRA.id,
            unitsTaken: 1,
            unitsSold: 1,
            maxUnits: null,
            remainingUnits: null,
            hasSales: true,
            priceCents: 5000,
            onSale: true,
          },
          {
            ticketTypeId: BOLSISTA.id,
            unitsTaken: 1,
            unitsSold: 1,
            maxUnits: 20,
            remainingUnits: 19,
            hasSales: true,
            priceCents: 2500,
            onSale: true,
          },
        ],
        selling: true,
      },
    );

    expect(rows).toEqual([
      {
        ticketTypeId: INTEIRA.id,
        name: "Inteira",
        unitsSold: 1,
        peopleSold: 1,
        peoplePerUnit: 1,
        revenueCents: 5000,
        maxUnits: null,
      },
      {
        ticketTypeId: CASADINHA.id,
        name: "Casadinha",
        unitsSold: 1,
        peopleSold: 2,
        peoplePerUnit: 2,
        revenueCents: 8000,
        maxUnits: 10,
      },
      {
        ticketTypeId: BOLSISTA.id,
        name: "Bolsista",
        unitsSold: 1,
        peopleSold: 1,
        peoplePerUnit: 1,
        revenueCents: 2500,
        maxUnits: 20,
      },
    ]);
  });
});

describe("mergeTypeRows / buildEventTotals", () => {
  it("soma sessões no total do evento", () => {
    const sessionA = {
      types: buildTypeRows(
        [{ session_id: "a", ticket_type_id: INTEIRA.id, price_cents: 5000 }],
        [INTEIRA, CASADINHA],
        null,
      ),
    };
    const sessionB = {
      types: buildTypeRows(
        [
          { session_id: "b", ticket_type_id: INTEIRA.id, price_cents: 5000 },
          { session_id: "b", ticket_type_id: CASADINHA.id, price_cents: 4000 },
          { session_id: "b", ticket_type_id: CASADINHA.id, price_cents: 4000 },
        ],
        [INTEIRA, CASADINHA],
        null,
      ),
    };
    const merged = mergeTypeRows([sessionA, sessionB], [INTEIRA, CASADINHA]);
    const totals = buildEventTotals({
      sold: 4,
      remaining: 96,
      held: 1,
      types: merged,
    });
    expect(totals.revenueCents).toBe(18000);
    expect(merged.find((row) => row.ticketTypeId === INTEIRA.id)?.peopleSold).toBe(2);
    expect(merged.find((row) => row.ticketTypeId === CASADINHA.id)?.peopleSold).toBe(2);
  });
});
