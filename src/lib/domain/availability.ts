export const MAX_PEOPLE_PER_ORDER = 10;

/** Duração da reserva criada por `create_checkout_order`. */
export const RESERVATION_MINUTES = 15;

const LOW_AVAILABILITY_THRESHOLD = 20;

export type EventAvailability = {
  capacity: number;
  /** Pessoas com ingresso pago ou com entrada registrada (inclui cortesias). */
  sold: number;
  /** Pessoas em reservas de compra ainda dentro do prazo. */
  held: number;
  remaining: number;
};

/** Situação de um tipo à venda, contada em unidades (1 Casadinha = 1 unidade). */
export type TypeAvailability = {
  ticketTypeId: string;
  unitsTaken: number;
  unitsSold: number;
  maxUnits: number | null;
  /** `null` = sem limite próprio (vale só a lotação do evento). */
  remainingUnits: number | null;
  hasSales: boolean;
};

export type EventAvailabilityWithTypes = EventAvailability & {
  types: TypeAvailability[];
};

/** O mínimo que o checkout precisa para refazer os limites depois de uma recusa. */
export type CheckoutAvailability = {
  remaining: number;
  typeRemaining: Record<string, number | null>;
};

export type SalesState = "open" | "closed" | "sold_out" | "held";

/** `occupied` vem de `event_occupied_count`: vendidos + reservas ativas. */
export function computeAvailability({
  capacity,
  sold,
  occupied,
}: {
  capacity: number;
  sold: number;
  occupied: number;
}): EventAvailability {
  const safeSold = Math.max(0, Math.trunc(sold) || 0);
  const safeOccupied = Math.max(safeSold, Math.trunc(occupied) || 0);
  return {
    capacity,
    sold: safeSold,
    held: safeOccupied - safeSold,
    remaining: Math.max(capacity - safeOccupied, 0),
  };
}

/** Sem `availability` (falha na consulta), segue só a chave de venda; o banco ainda barra a lotação. */
export function salesState(
  salesOpen: boolean,
  availability: EventAvailability | null,
): SalesState {
  if (!availability) return salesOpen ? "open" : "closed";
  if (availability.sold >= availability.capacity) return "sold_out";
  if (!salesOpen) return "closed";
  if (availability.remaining === 0) return "held";
  return "open";
}

export const HELD_MESSAGE = `Ingressos reservados no momento. Se alguém não concluir a compra, novas vagas podem abrir em até ${RESERVATION_MINUTES} minutos.`;

export const salesStateMessages: Record<Exclude<SalesState, "open">, string> = {
  sold_out: "Ingressos esgotados",
  closed: "Venda fechada",
  held: HELD_MESSAGE,
};

/** Quantas unidades de um tipo ainda podem ser escolhidas nesta compra. */
export function maxSelectableUnits({
  remaining,
  peopleSelectedElsewhere,
  peoplePerUnit = 1,
  typeRemainingUnits = null,
}: {
  remaining: number;
  peopleSelectedElsewhere: number;
  peoplePerUnit?: number;
  typeRemainingUnits?: number | null;
}): number {
  const perUnit = Math.max(1, Math.trunc(peoplePerUnit) || 1);
  const people =
    Math.min(remaining, MAX_PEOPLE_PER_ORDER) - peopleSelectedElsewhere;
  const units = Math.floor(Math.max(people, 0) / perUnit);
  return typeRemainingUnits === null
    ? units
    : Math.min(units, Math.max(typeRemainingUnits, 0));
}

export type SelectableType = {
  id: string;
  peoplePerUnit: number;
  remainingUnits: number | null;
};

/**
 * Reduz a seleção, na ordem dos tipos, para caber nos lugares restantes, no
 * limite de cada tipo e no máximo de pessoas por compra. Tipos que não estão na
 * lista saem da seleção.
 */
export function fitSelection(
  quantities: Readonly<Record<string, number>>,
  types: readonly SelectableType[],
  remaining: number,
): Record<string, number> {
  let budget = Math.max(0, Math.min(remaining, MAX_PEOPLE_PER_ORDER));
  const fitted: Record<string, number> = {};
  for (const type of types) {
    const perUnit = Math.max(1, Math.trunc(type.peoplePerUnit) || 1);
    let qty = Math.max(0, Math.trunc(quantities[type.id] ?? 0) || 0);
    if (type.remainingUnits !== null) qty = Math.min(qty, Math.max(type.remainingUnits, 0));
    qty = Math.min(qty, Math.floor(budget / perUnit));
    fitted[type.id] = qty;
    budget -= qty * perUnit;
  }
  return fitted;
}

export function remainingNotice(remaining: number): string | null {
  if (remaining <= 0 || remaining > LOW_AVAILABILITY_THRESHOLD) return null;
  return remaining === 1 ? "Resta 1 lugar" : `Restam ${remaining} lugares`;
}

/** Aviso por tipo com limite próprio: só quando está acabando. */
export function typeRemainingNotice(remainingUnits: number | null): string | null {
  if (remainingUnits === null || remainingUnits > LOW_AVAILABILITY_THRESHOLD) return null;
  if (remainingUnits <= 0) return "Esgotado";
  return remainingUnits === 1 ? "Resta 1" : `Restam ${remainingUnits}`;
}

export function typeRefusalMessage(name: string, remainingUnits: number): string {
  if (remainingUnits <= 0) return `“${name}” esgotou. Ajustamos sua seleção.`;
  return remainingUnits === 1
    ? `Resta apenas 1 “${name}”. Ajustamos sua seleção.`
    : `Restam apenas ${remainingUnits} “${name}”. Ajustamos sua seleção.`;
}

export function toCheckoutAvailability(
  availability: EventAvailabilityWithTypes,
): CheckoutAvailability {
  return {
    remaining: availability.remaining,
    typeRemaining: Object.fromEntries(
      availability.types.map((type) => [type.ticketTypeId, type.remainingUnits]),
    ),
  };
}

export function capacityRefusalMessage(availability: EventAvailability | null): string {
  if (!availability) {
    return "Não há lugares suficientes para a sua seleção. Diminua a quantidade e tente novamente.";
  }
  if (availability.sold >= availability.capacity) {
    return "Os ingressos deste evento esgotaram.";
  }
  if (availability.remaining === 0) return HELD_MESSAGE;
  return availability.remaining === 1
    ? "Resta apenas 1 lugar. Ajustamos sua seleção."
    : `Restam apenas ${availability.remaining} lugares. Ajustamos sua seleção.`;
}
