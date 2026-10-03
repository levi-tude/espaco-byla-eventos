import type { Enums } from "@/types/database";

type TicketKind = Enums<"ticket_kind">;

export const ticketKindLabels: Record<TicketKind, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
  cortesia: "Cortesia",
};

export type TicketPreset = "inteira" | "meia" | "casadinha" | "familia";

export type PresetDefinition = {
  preset: TicketPreset;
  name: string;
  kind: "inteira" | "meia";
  peoplePerUnit: number;
};

/** Tipos prontos de todo evento (decisão do dono, 2026-10-03). Iguais à constraint do banco. */
export const TICKET_PRESETS: readonly PresetDefinition[] = [
  { preset: "inteira", name: "Inteira", kind: "inteira", peoplePerUnit: 1 },
  { preset: "meia", name: "Meia-entrada", kind: "meia", peoplePerUnit: 1 },
  { preset: "casadinha", name: "Casadinha", kind: "inteira", peoplePerUnit: 2 },
  { preset: "familia", name: "Pacote família", kind: "inteira", peoplePerUnit: 4 },
];

export const TICKET_TYPE_LIMITS = {
  maxTypes: 20,
  nameMaxLength: 60,
  maxPeoplePerUnit: 10,
  maxPriceCents: 10_000_000,
  maxUnits: 100_000,
} as const;

const RESERVED_NAMES = new Set([
  "cortesia",
  "inteira",
  "meia",
  "meia-entrada",
  "meia entrada",
  "casadinha",
  "pacote família",
  "pacote familia",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function presetDefinition(preset: unknown): PresetDefinition | null {
  return TICKET_PRESETS.find((item) => item.preset === preset) ?? null;
}

function normalizedName(name: string) {
  return name.trim().toLocaleLowerCase("pt-BR");
}

/** Nomes dos tipos prontos e da cortesia não valem para tipos criados pela equipe. */
export function isReservedTypeName(name: string): boolean {
  return RESERVED_NAMES.has(normalizedName(name));
}

/** "Casadinha — Inteira"; quando o nome já é a categoria, só "Inteira". */
export function ticketTypeLabel(name: string | null | undefined, kind: TicketKind): string {
  const kindLabel = ticketKindLabels[kind];
  const clean = name?.trim();
  if (!clean || normalizedName(clean) === normalizedName(kindLabel)) return kindLabel;
  return `${clean} — ${kindLabel}`;
}

/** Nome gravado no item do pedido; o embed do PostgREST pode vir como objeto ou lista. */
export function orderItemName(
  item: { name: string } | { name: string }[] | null | undefined,
): string | null {
  return (Array.isArray(item) ? item[0]?.name : item?.name) ?? null;
}

export function peopleLabel(count: number): string {
  return count === 1 ? "1 pessoa" : `${count} pessoas`;
}

/** O que cada unidade gera: "2 ingressos inteira". */
export function unitContentsLabel(peoplePerUnit: number, kind: TicketKind): string {
  const category = ticketKindLabels[kind].toLocaleLowerCase("pt-BR");
  return peoplePerUnit === 1
    ? `1 ingresso ${category}`
    : `${peoplePerUnit} ingressos ${category}`;
}

export type TicketTypeInput =
  | { preset: TicketPreset; priceCents: number; maxUnits: number | null }
  | {
      preset: null;
      id: string | null;
      name: string;
      peoplePerUnit: number;
      priceCents: number;
      maxUnits: number | null;
    };

/** Formato de `save_event_ticket_types` / `update_event_with_capacity`. */
export type TicketTypeRpcItem =
  | { preset: TicketPreset; price_cents: number; max_units: number | null }
  | {
      id: string | null;
      name: string;
      people_per_unit: number;
      price_cents: number;
      max_units: number | null;
    };

type NormalizeResult =
  | { ok: true; items: TicketTypeRpcItem[] }
  | { ok: false; error: string };

function isPositiveInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** Valida a lista do editor da equipe; o banco revalida tudo ao salvar. */
export function normalizeTicketTypes(input: unknown): NormalizeResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Marque pelo menos um tipo de ingresso para vender." };
  }
  if (input.length > TICKET_TYPE_LIMITS.maxTypes) {
    return {
      ok: false,
      error: `Cadastre no máximo ${TICKET_TYPE_LIMITS.maxTypes} tipos de ingresso.`,
    };
  }

  const items: TicketTypeRpcItem[] = [];
  const presets = new Set<string>();
  const names = new Set<string>();
  const ids = new Set<string>();

  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "Tipo de ingresso inválido." };
    }
    const item = raw as Record<string, unknown>;
    const definition = item.preset == null ? null : presetDefinition(item.preset);
    if (item.preset != null && (!definition || presets.has(definition.preset))) {
      return { ok: false, error: "Tipo de ingresso inválido." };
    }

    const name = definition ? definition.name : typeof item.name === "string" ? item.name.trim() : "";
    if (!definition) {
      if (!name || name.length > TICKET_TYPE_LIMITS.nameMaxLength) {
        return {
          ok: false,
          error: `Informe o nome de cada tipo novo (até ${TICKET_TYPE_LIMITS.nameMaxLength} caracteres).`,
        };
      }
      if (isReservedTypeName(name)) {
        return {
          ok: false,
          error: `O nome “${name}” é de um tipo pronto. Use outro nome para o tipo novo.`,
        };
      }
    }
    if (names.has(normalizedName(name))) {
      return { ok: false, error: `Há dois tipos com o nome “${name}”.` };
    }

    if (!isPositiveInteger(item.priceCents, TICKET_TYPE_LIMITS.maxPriceCents)) {
      return { ok: false, error: `Informe um preço válido para “${name}”.` };
    }
    const maxUnits = item.maxUnits ?? null;
    if (maxUnits !== null && !isPositiveInteger(maxUnits, TICKET_TYPE_LIMITS.maxUnits)) {
      return {
        ok: false,
        error: `Informe um limite válido para “${name}” ou deixe em branco.`,
      };
    }

    if (definition) {
      presets.add(definition.preset);
      items.push({
        preset: definition.preset,
        price_cents: item.priceCents,
        max_units: maxUnits,
      });
    } else {
      if (!isPositiveInteger(item.peoplePerUnit, TICKET_TYPE_LIMITS.maxPeoplePerUnit)) {
        return {
          ok: false,
          error: `Informe de 1 a ${TICKET_TYPE_LIMITS.maxPeoplePerUnit} pessoas para “${name}”.`,
        };
      }
      const id = isUuid(item.id) ? item.id : null;
      if (item.id != null && (id === null || ids.has(id))) {
        return { ok: false, error: "Tipo de ingresso inválido." };
      }
      if (id) ids.add(id);
      items.push({
        id,
        name,
        people_per_unit: item.peoplePerUnit,
        price_cents: item.priceCents,
        max_units: maxUnits,
      });
    }
    names.add(normalizedName(name));
  }

  return { ok: true, items };
}

/** Traduz os erros `TIPOS_*` do banco; `null` se não for erro do editor de tipos. */
export function ticketTypesErrorMessage(message: string | undefined): string | null {
  if (!message || !message.includes("TIPOS_")) return null;

  const withSales = message.match(/TIPOS_PESSOAS_COM_VENDAS:(.+)$/);
  if (withSales) {
    return `“${withSales[1].trim()}” já tem vendas, então o número de pessoas não pode mudar. Crie um tipo novo se precisar.`;
  }
  const belowTaken = message.match(/TIPOS_LIMITE_MENOR:(\d+):(.+)$/);
  if (belowTaken) {
    return `O limite de “${belowTaken[2].trim()}” não pode ser menor que ${belowTaken[1]} (já vendidos ou reservados).`;
  }
  const repeated = message.match(/TIPOS_NOME_REPETIDO:(.+)$/);
  if (repeated) return `Há dois tipos com o nome “${repeated[1].trim()}”.`;
  const reserved = message.match(/TIPOS_NOME_RESERVADO:(.+)$/);
  if (reserved) {
    return `O nome “${reserved[1].trim()}” é de um tipo pronto. Use outro nome para o tipo novo.`;
  }
  if (message.includes("TIPOS_DESATUALIZADO")) {
    return "Os tipos de ingresso mudaram enquanto você editava. Recarregue a página e tente de novo.";
  }
  if (message.includes("TIPOS_QUANTIDADE")) {
    return `Marque de 1 a ${TICKET_TYPE_LIMITS.maxTypes} tipos de ingresso para vender.`;
  }
  return "Confira os tipos de ingresso e tente de novo.";
}
