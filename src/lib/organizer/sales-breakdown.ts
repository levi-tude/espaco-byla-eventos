import type {
  OrganizerSalesTotals,
  OrganizerSalesTypeRow,
} from "@/components/organizer/OrganizerSalesPanel";
import type { EventAvailabilityWithTypes } from "@/lib/domain/availability";

export type SoldTicketRow = {
  session_id: string;
  ticket_type_id: string;
  price_cents: number;
};

export type TypeMeta = {
  id: string;
  name: string;
  peoplePerUnit: number;
  sortOrder: number;
};

/**
 * Agrupa ingressos pagos/check-in por tipo; une com disponibilidade (limites)
 * e ordena como no editor.
 */
export function buildTypeRows(
  soldTickets: readonly SoldTicketRow[],
  types: readonly TypeMeta[],
  availability: EventAvailabilityWithTypes | null,
): OrganizerSalesTypeRow[] {
  const byType = new Map<string, { people: number; revenue: number }>();
  for (const ticket of soldTickets) {
    const current = byType.get(ticket.ticket_type_id) ?? { people: 0, revenue: 0 };
    current.people += 1;
    current.revenue += Math.max(0, ticket.price_cents);
    byType.set(ticket.ticket_type_id, current);
  }

  const availabilityById = new Map(
    (availability?.types ?? []).map((type) => [type.ticketTypeId, type]),
  );

  const rows: OrganizerSalesTypeRow[] = types.map((type) => {
    const sold = byType.get(type.id);
    const avail = availabilityById.get(type.id);
    const peopleSold = sold?.people ?? 0;
    const unitsSold =
      avail?.unitsSold ??
      (type.peoplePerUnit > 0 ? Math.floor(peopleSold / type.peoplePerUnit) : peopleSold);
    return {
      ticketTypeId: type.id,
      name: type.name,
      unitsSold,
      peopleSold: peopleSold || unitsSold * type.peoplePerUnit,
      peoplePerUnit: type.peoplePerUnit,
      revenueCents: sold?.revenue ?? 0,
      maxUnits: avail?.maxUnits ?? null,
    };
  });

  for (const [typeId, sold] of byType) {
    if (rows.some((row) => row.ticketTypeId === typeId)) continue;
    rows.push({
      ticketTypeId: typeId,
      name: "Tipo removido da venda",
      unitsSold: sold.people,
      peopleSold: sold.people,
      peoplePerUnit: 1,
      revenueCents: sold.revenue,
      maxUnits: null,
    });
  }

  rows.sort((a, b) => {
    const orderA = types.find((type) => type.id === a.ticketTypeId)?.sortOrder ?? 999;
    const orderB = types.find((type) => type.id === b.ticketTypeId)?.sortOrder ?? 999;
    return orderA - orderB || a.name.localeCompare(b.name, "pt-BR");
  });
  return rows;
}

export function sumTypeRevenue(types: readonly OrganizerSalesTypeRow[]): number {
  return types.reduce((total, type) => total + type.revenueCents, 0);
}

export function mergeTypeRows(
  sessions: readonly { types: OrganizerSalesTypeRow[] }[],
  types: readonly TypeMeta[],
): OrganizerSalesTypeRow[] {
  const merged = new Map<string, OrganizerSalesTypeRow>();
  for (const session of sessions) {
    for (const row of session.types) {
      const current = merged.get(row.ticketTypeId);
      if (!current) {
        merged.set(row.ticketTypeId, { ...row });
        continue;
      }
      merged.set(row.ticketTypeId, {
        ...current,
        unitsSold: current.unitsSold + row.unitsSold,
        peopleSold: current.peopleSold + row.peopleSold,
        revenueCents: current.revenueCents + row.revenueCents,
        maxUnits:
          current.maxUnits === null || row.maxUnits === null
            ? null
            : current.maxUnits + row.maxUnits,
      });
    }
  }
  const list = [...merged.values()];
  list.sort((a, b) => {
    const orderA = types.find((type) => type.id === a.ticketTypeId)?.sortOrder ?? 999;
    const orderB = types.find((type) => type.id === b.ticketTypeId)?.sortOrder ?? 999;
    return orderA - orderB || a.name.localeCompare(b.name, "pt-BR");
  });
  return list;
}

export function buildEventTotals(input: {
  sold: number | null;
  remaining: number | null;
  held: number | null;
  types: OrganizerSalesTypeRow[];
}): OrganizerSalesTotals {
  return {
    sold: input.sold,
    remaining: input.remaining,
    held: input.held,
    revenueCents: sumTypeRevenue(input.types),
    types: input.types,
  };
}
