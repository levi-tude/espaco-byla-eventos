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
  /** Preço nesta sessão (`session_availability`); `null` = sem preço ou não informado. */
  priceCents?: number | null;
  /** À venda nesta sessão; `null`/ausente = não informado. */
  onSale?: boolean | null;
};

/** Categorias com cota opcional no evento (a cortesia conta só na lotação). */
export type QuotaKind = "inteira" | "meia";

export const QUOTA_KINDS: readonly QuotaKind[] = ["inteira", "meia"];

/** Cota de uma categoria, em pessoas (cada pessoa de Casadinha conta como inteira). */
export type CategoryAvailability = {
  /** `null` = sem cota própria (vale só a lotação). */
  quota: number | null;
  sold: number;
  /** Vendidos + reservas ativas. */
  taken: number;
  remaining: number | null;
};

export type CategoryRemaining = Record<QuotaKind, number | null>;

export type EventAvailabilityWithTypes = EventAvailability & {
  categories: Record<QuotaKind, CategoryAvailability>;
  types: TypeAvailability[];
  /**
   * A sessão está vendendo (evento e sessão abertos, sessão ativa e antes de
   * início + 5 min). `null` = o banco não informou; vale só a chave do evento.
   */
  selling: boolean | null;
};

/** O mínimo que o checkout precisa para refazer os limites depois de uma recusa. */
export type CheckoutAvailability = {
  remaining: number;
  categoryRemaining: CategoryRemaining;
  typeRemaining: Record<string, number | null>;
};

export const NO_CATEGORY_LIMIT: CategoryRemaining = { inteira: null, meia: null };

function categoryRemainingOf(
  categoryRemaining: Partial<CategoryRemaining>,
  kind: string,
): number | null {
  return kind === "inteira" || kind === "meia" ? (categoryRemaining[kind] ?? null) : null;
}

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

/**
 * Sem `availability` (falha na consulta), segue só a chave de venda; o banco ainda
 * barra a lotação e o horário. `selling === false` (venda encerrada pelo horário
 * ou pela equipe) fecha a venda.
 */
export function salesState(
  salesOpen: boolean,
  availability: (EventAvailability & { selling?: boolean | null }) | null,
): SalesState {
  if (!availability) return salesOpen ? "open" : "closed";
  if (availability.sold >= availability.capacity) return "sold_out";
  if (!salesOpen || availability.selling === false) return "closed";
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
  categoryRemaining = null,
  categoryPeopleSelectedElsewhere = 0,
}: {
  remaining: number;
  peopleSelectedElsewhere: number;
  peoplePerUnit?: number;
  typeRemainingUnits?: number | null;
  /** Pessoas restantes na cota da categoria do tipo; `null` = sem cota. */
  categoryRemaining?: number | null;
  /** Pessoas da mesma categoria já escolhidas nos outros tipos. */
  categoryPeopleSelectedElsewhere?: number;
}): number {
  const perUnit = Math.max(1, Math.trunc(peoplePerUnit) || 1);
  let people =
    Math.min(remaining, MAX_PEOPLE_PER_ORDER) - peopleSelectedElsewhere;
  if (categoryRemaining !== null) {
    people = Math.min(people, categoryRemaining - categoryPeopleSelectedElsewhere);
  }
  const units = Math.floor(Math.max(people, 0) / perUnit);
  return typeRemainingUnits === null
    ? units
    : Math.min(units, Math.max(typeRemainingUnits, 0));
}

export type SelectableType = {
  id: string;
  kind: string;
  peoplePerUnit: number;
  remainingUnits: number | null;
};

/**
 * Reduz a seleção, na ordem dos tipos, para caber nos lugares restantes, na cota
 * da categoria, no limite de cada tipo e no máximo de pessoas por compra. Tipos
 * que não estão na lista saem da seleção.
 */
export function fitSelection(
  quantities: Readonly<Record<string, number>>,
  types: readonly SelectableType[],
  remaining: number,
  categoryRemaining: Partial<CategoryRemaining> = NO_CATEGORY_LIMIT,
): Record<string, number> {
  let budget = Math.max(0, Math.min(remaining, MAX_PEOPLE_PER_ORDER));
  const categoryBudget: Partial<Record<string, number>> = {};
  for (const kind of QUOTA_KINDS) {
    const left = categoryRemaining[kind];
    if (left !== null && left !== undefined) categoryBudget[kind] = Math.max(0, left);
  }
  const fitted: Record<string, number> = {};
  for (const type of types) {
    const perUnit = Math.max(1, Math.trunc(type.peoplePerUnit) || 1);
    let qty = Math.max(0, Math.trunc(quantities[type.id] ?? 0) || 0);
    if (type.remainingUnits !== null) qty = Math.min(qty, Math.max(type.remainingUnits, 0));
    qty = Math.min(qty, Math.floor(budget / perUnit));
    const categoryLeft = categoryBudget[type.kind];
    if (categoryLeft !== undefined) {
      qty = Math.min(qty, Math.floor(categoryLeft / perUnit));
      categoryBudget[type.kind] = categoryLeft - qty * perUnit;
    }
    fitted[type.id] = qty;
    budget -= qty * perUnit;
  }
  return fitted;
}

/**
 * Unidades que ainda cabem no limite do tipo e na cota da categoria (o menor
 * vale); `null` = nenhum dos dois limita. A lotação do evento é avisada à parte.
 */
export function typeUnitsLeft(
  type: { kind: string; peoplePerUnit: number; remainingUnits: number | null },
  categoryRemaining: Partial<CategoryRemaining>,
): number | null {
  const perUnit = Math.max(1, Math.trunc(type.peoplePerUnit) || 1);
  const categoryLeft = categoryRemainingOf(categoryRemaining, type.kind);
  const byCategory =
    categoryLeft === null ? null : Math.floor(Math.max(categoryLeft, 0) / perUnit);
  if (type.remainingUnits === null) return byCategory;
  const byType = Math.max(type.remainingUnits, 0);
  return byCategory === null ? byType : Math.min(byType, byCategory);
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

const categoryNames: Record<QuotaKind, string> = {
  inteira: "inteira",
  meia: "meia-entrada",
};

export function categoryRefusalMessage(kind: QuotaKind, remaining: number): string {
  const name = categoryNames[kind];
  if (remaining <= 0) return `Os ingressos ${name} esgotaram. Ajustamos sua seleção.`;
  return remaining === 1
    ? `Resta apenas 1 ingresso ${name}. Ajustamos sua seleção.`
    : `Restam apenas ${remaining} ingressos ${name}. Ajustamos sua seleção.`;
}

export function toCheckoutAvailability(
  availability: EventAvailabilityWithTypes,
): CheckoutAvailability {
  return {
    remaining: availability.remaining,
    categoryRemaining: {
      inteira: availability.categories.inteira.remaining,
      meia: availability.categories.meia.remaining,
    },
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
