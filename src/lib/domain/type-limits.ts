import type { EventQuotas } from "@/lib/domain/quotas";
import { presetDefinition, type TicketTypeRpcItem } from "@/lib/domain/ticket-types";

/** Tipo à venda reduzido ao que importa para os limites; `maxUnits` é em unidades. */
export type LimitedType = {
  name: string;
  kind: "inteira" | "meia";
  peoplePerUnit: number;
  maxUnits: number | null;
};

const CATEGORY_NAMES = { inteira: "inteiras", meia: "meias" } as const;

export function limitedTypesFromRpcItems(items: TicketTypeRpcItem[]): LimitedType[] {
  return items.map((item) => {
    if ("preset" in item) {
      const definition = presetDefinition(item.preset);
      return {
        name: definition?.name ?? item.preset,
        kind: definition?.kind ?? "inteira",
        peoplePerUnit: definition?.peoplePerUnit ?? 1,
        maxUnits: item.max_units,
      };
    }
    return {
      name: item.name,
      kind: "inteira",
      peoplePerUnit: item.people_per_unit,
      maxUnits: item.max_units,
    };
  });
}

/** Limite em ingressos (pessoas): 3 casadinhas = 6. */
export function limitPeople(type: LimitedType): number | null {
  return type.maxUnits === null ? null : type.maxUnits * type.peoplePerUnit;
}

function limitText(type: LimitedType, people: number): string {
  return type.peoplePerUnit === 1
    ? String(people)
    : `${type.maxUnits} × ${type.peoplePerUnit} pessoas = ${people} ingressos`;
}

function peopleSum(types: LimitedType[]): number {
  return types.reduce((sum, type) => sum + (limitPeople(type) ?? 0), 0);
}

/**
 * Limites dos tipos contados em ingressos: cada um cabe no total e na cota da
 * sua categoria, e a soma dos limites também (decisão de 2026-10-03).
 */
export function typeLimitsError(
  capacity: number,
  quotas: EventQuotas,
  types: LimitedType[],
): string | null {
  for (const type of types) {
    const people = limitPeople(type);
    if (people === null) continue;
    if (people > capacity) {
      return `O limite de “${type.name}” (${limitText(type, people)}) passa do total da sessão (${capacity}). Diminua o limite ou aumente o total.`;
    }
    const quota = type.kind === "inteira" ? quotas.inteiraQuota : quotas.meiaQuota;
    if (quota !== null && people > quota) {
      return `O limite de “${type.name}” (${limitText(type, people)}) passa da quantidade de ${CATEGORY_NAMES[type.kind]} (${quota}). Diminua o limite ou aumente a quantidade de ${CATEGORY_NAMES[type.kind]}.`;
    }
  }

  const total = peopleSum(types);
  if (total > capacity) {
    return `A soma dos limites dos tipos (${total} ingressos) passa do total (${capacity}). Diminua algum limite ou aumente o total.`;
  }
  for (const kind of ["inteira", "meia"] as const) {
    const quota = kind === "inteira" ? quotas.inteiraQuota : quotas.meiaQuota;
    if (quota === null) continue;
    const sum = peopleSum(types.filter((type) => type.kind === kind));
    if (sum > quota) {
      return `A soma dos limites das ${CATEGORY_NAMES[kind]} (${sum} ingressos) passa da quantidade de ${CATEGORY_NAMES[kind]} (${quota}). Diminua algum limite ou aumente a quantidade de ${CATEGORY_NAMES[kind]}.`;
    }
  }
  return null;
}

/** Resumo ao vivo para a equipe; `null` quando nenhum tipo tem limite. */
export function typeLimitsSummary(capacity: number, types: LimitedType[]): string | null {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const limited = types.filter((type) => type.maxUnits !== null);
  if (!limited.length) return null;
  const total = peopleSum(limited);
  const left = Math.max(capacity - total, 0);
  const line = `Limites dos tipos: ${total} de ${capacity} ingressos.`;
  if (limited.length < types.length) {
    return `${line} Os tipos sem limite dividem os ${left} que sobram.`;
  }
  return left === 0
    ? `${line} Tudo distribuído entre os tipos.`
    : `${line} Sobram ${left} que nenhum tipo pode vender (só cortesias).`;
}
