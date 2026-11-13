import type { EventQuotas } from "@/lib/domain/quotas";
import { presetDefinition, type TicketTypeRpcItem } from "@/lib/domain/ticket-types";

/** Tipo à venda reduzido ao que importa para os limites; `maxUnits` é em unidades. */
export type LimitedType = {
  name: string;
  kind: "inteira" | "meia";
  peoplePerUnit: number;
  maxUnits: number | null;
  /**
   * Tipo com código compartilhado (ex.: Projeto Capacitação): **extra** —
   * não conta no total da sessão nem na cota de inteira/meia; só no próprio limite.
   */
  outsideCategoryQuota?: boolean;
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

function inCategoryQuota(type: LimitedType): boolean {
  return !type.outsideCategoryQuota;
}

/**
 * Limites dos tipos contados em ingressos: cada um cabe no total e na cota da
 * sua categoria, e a soma dos limites também (decisão de 2026-10-03).
 * Tipos com código (`outsideCategoryQuota`) são extras: só o próprio limite.
 */
/** Lei 12.933/2013 (art. 1º, § 10): meia-entrada em pelo menos 40% dos ingressos. */
export const MEIA_MIN_SHARE = 0.4;

/** Mínimo de meias para um total (arredonda para cima: 70 → 28). */
export function meiaMinimum(capacity: number): number {
  return Math.ceil(capacity * MEIA_MIN_SHARE - 1e-9);
}

/**
 * Meia-entrada abaixo de 40% do total regular (sem contar os extras com código).
 * Só vale quando há algum tipo de meia à venda na sessão.
 */
export function meiaShareError(
  capacity: number,
  quotas: EventQuotas,
  types: LimitedType[],
): string | null {
  const meiaTypes = types.filter((type) => inCategoryQuota(type) && type.kind === "meia");
  if (!meiaTypes.length || !Number.isInteger(capacity) || capacity < 1) return null;
  const minimum = meiaMinimum(capacity);
  const law = "Pela lei da meia-entrada (Lei 12.933/2013), pelo menos 40% dos ingressos precisam poder ser meia";
  if (quotas.meiaQuota !== null && quotas.meiaQuota < minimum) {
    return `${law}: com total de ${capacity}, coloque pelo menos ${minimum} meias (hoje: ${quotas.meiaQuota}).`;
  }
  if (quotas.inteiraQuota !== null && capacity - quotas.inteiraQuota < minimum) {
    return `${law}: com total de ${capacity}, as inteiras podem ser no máximo ${capacity - minimum} (hoje: ${quotas.inteiraQuota}).`;
  }
  if (meiaTypes.every((type) => type.maxUnits !== null)) {
    const sum = peopleSum(meiaTypes);
    if (sum < minimum) {
      return `${law}: com total de ${capacity}, os limites dos tipos de meia precisam somar pelo menos ${minimum} (hoje: ${sum}). Aumente o limite ou deixe em branco.`;
    }
  }
  return null;
}

export function typeLimitsError(
  capacity: number,
  quotas: EventQuotas,
  types: LimitedType[],
): string | null {
  // Tipo com código é extra (fora do total): sem limite próprio, venderia sem fim.
  const unlimitedExtra = types.find((type) => type.outsideCategoryQuota && type.maxUnits === null);
  if (unlimitedExtra) {
    return `Informe o limite de “${unlimitedExtra.name}”: tipo com código é extra (fora do total) e precisa de um limite por sessão.`;
  }

  const inCapacity = types.filter(inCategoryQuota);

  for (const type of inCapacity) {
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

  const total = peopleSum(inCapacity);
  if (total > capacity) {
    return `A soma dos limites dos tipos (${total} ingressos) passa do total (${capacity}). Diminua algum limite ou aumente o total.`;
  }

  for (const kind of ["inteira", "meia"] as const) {
    const quota = kind === "inteira" ? quotas.inteiraQuota : quotas.meiaQuota;
    if (quota === null) continue;
    const sum = peopleSum(inCapacity.filter((type) => type.kind === kind));
    if (sum > quota) {
      return `A soma dos limites das ${CATEGORY_NAMES[kind]} (${sum} ingressos) passa da quantidade de ${CATEGORY_NAMES[kind]} (${quota}). Diminua algum limite ou aumente a quantidade de ${CATEGORY_NAMES[kind]}.`;
    }
  }
  return meiaShareError(capacity, quotas, types);
}

/** Resumo ao vivo para a equipe; `null` quando nenhum tipo tem limite. */
export function typeLimitsSummary(capacity: number, types: LimitedType[]): string | null {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const inCapacity = types.filter(inCategoryQuota);
  const limited = inCapacity.filter((type) => type.maxUnits !== null);
  const unlockLimited = types.filter((type) => type.outsideCategoryQuota && type.maxUnits !== null);
  if (!limited.length && !unlockLimited.length) return null;

  const parts: string[] = [];
  if (limited.length) {
    const total = peopleSum(limited);
    const left = Math.max(capacity - total, 0);
    let line = `Limites dos tipos: ${total} de ${capacity} ingressos.`;
    if (limited.length < inCapacity.length) {
      line = `${line} Os tipos sem limite dividem os ${left} que sobram.`;
    } else if (left === 0) {
      line = `${line} Tudo distribuído entre os tipos.`;
    } else {
      line = `${line} Sobram ${left} que nenhum tipo pode vender (só cortesias).`;
    }
    parts.push(line);
  }
  if (unlockLimited.length) {
    const extra = peopleSum(unlockLimited);
    parts.push(
      unlockLimited.length === 1
        ? `Tipo com código: até ${extra} ingressos a mais (fora do total).`
        : `Tipos com código: até ${extra} ingressos a mais (fora do total).`,
    );
  }
  return parts.join(" ");
}
