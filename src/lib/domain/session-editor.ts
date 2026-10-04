import { formatSessionShort, parseEventInputValue } from "@/lib/datetime";
import { quotasError } from "@/lib/domain/quotas";
import { TICKET_TYPE_LIMITS } from "@/lib/domain/ticket-types";
import { type LimitedType, typeLimitsError } from "@/lib/domain/type-limits";

/** Até 20 sessões ativas por evento (conferido também no banco). */
export const MAX_SESSIONS = 20;
export const SESSION_NAME_MAX_LENGTH = 60;
const MAX_CAPACITY = 100_000;

/** Preço, "à venda" e limite de um tipo numa sessão; `typeIndex` = posição do tipo na lista. */
export type SessionPriceInput = {
  typeIndex: number;
  priceCents: number | null;
  maxUnits: number | null;
  onSale: boolean;
};

/** Sessão como o formulário envia: horários no formato do campo (horário de Brasília). */
export type SessionInput = {
  id: string | null;
  name: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  inteiraQuota: number | null;
  meiaQuota: number | null;
  prices: SessionPriceInput[];
};

/** Formato de `save_event_with_sessions` (p_sessions). */
export type SessionRpcItem = {
  id: string | null;
  name: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number;
  inteira_quota: number | null;
  meia_quota: number | null;
  prices: { type_index: number; price_cents: number | null; max_units: number | null; on_sale: boolean }[];
};

/** O que importa de cada tipo (na ordem da lista) para validar as sessões. */
export type SessionTypeInfo = Omit<LimitedType, "maxUnits">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPositiveInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

function isQuota(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value, MAX_CAPACITY);
}

/** "Sessão 2 (sáb, 10/10 · 20h30)"; em evento de sessão única, vazio. */
export function sessionErrorLabel(index: number, total: number, startsAtIso?: string | null): string {
  if (total <= 1) return "";
  const when = startsAtIso ? formatSessionShort(startsAtIso) : "";
  return when ? `Sessão ${index + 1} (${when})` : `Sessão ${index + 1}`;
}

function withLabel(label: string, message: string): string {
  return label ? `${label}: ${message}` : message;
}

type NormalizeResult = { ok: true; items: SessionRpcItem[] } | { ok: false; error: string };

/**
 * Valida as sessões do formulário (servidor e tela usam a mesma regra; o banco
 * confere de novo, inclusive o que já foi vendido).
 */
export function normalizeSessions(input: unknown, types: readonly SessionTypeInfo[]): NormalizeResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Cadastre pelo menos uma sessão." };
  }
  if (input.length > MAX_SESSIONS) {
    return { ok: false, error: `Cadastre no máximo ${MAX_SESSIONS} sessões.` };
  }

  const items: SessionRpcItem[] = [];
  const starts = new Set<number>();
  const ids = new Set<string>();
  const total = input.length;

  for (const [index, raw] of input.entries()) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Sessão inválida." };
    const session = raw as Record<string, unknown>;

    const startsAt =
      typeof session.startsAt === "string" && session.startsAt.trim()
        ? parseEventInputValue(session.startsAt)
        : null;
    const startIso = startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : null;
    const label = sessionErrorLabel(index, total, startIso);
    const fail = (message: string): NormalizeResult => ({ ok: false, error: withLabel(label, message) });

    let id: string | null = null;
    if (session.id !== null && session.id !== undefined) {
      if (typeof session.id !== "string" || !UUID_PATTERN.test(session.id) || ids.has(session.id)) {
        return fail("Sessão inválida. Recarregue a página e tente de novo.");
      }
      id = session.id;
      ids.add(id);
    }

    if (!startIso) return fail("Informe a data e o horário de início.");
    const startMs = Date.parse(startIso);
    if (starts.has(startMs)) return fail("Duas sessões não podem começar no mesmo horário.");
    starts.add(startMs);

    let endIso: string | null = null;
    if (typeof session.endsAt === "string" && session.endsAt.trim()) {
      const endsAt = parseEventInputValue(session.endsAt);
      if (Number.isNaN(endsAt.getTime())) return fail("Informe um término válido ou deixe em branco.");
      if (endsAt.getTime() <= startMs) return fail("O término precisa ser depois do início.");
      endIso = endsAt.toISOString();
    } else if (session.endsAt !== undefined && session.endsAt !== null && typeof session.endsAt !== "string") {
      return fail("Informe um término válido ou deixe em branco.");
    }

    const name = typeof session.name === "string" ? session.name.trim() : "";
    if (session.name !== undefined && session.name !== null && typeof session.name !== "string") {
      return fail("Nome da sessão inválido.");
    }
    if (name.length > SESSION_NAME_MAX_LENGTH) {
      return fail(`O nome da sessão pode ter até ${SESSION_NAME_MAX_LENGTH} caracteres.`);
    }

    if (!isPositiveInteger(session.capacity, MAX_CAPACITY)) {
      return fail("Informe um total de ingressos válido.");
    }
    const capacity = session.capacity;
    const inteiraQuota = session.inteiraQuota ?? null;
    const meiaQuota = session.meiaQuota ?? null;
    if (!isQuota(inteiraQuota) || !isQuota(meiaQuota)) {
      return fail("Use números inteiros nas quantidades de inteiras e meias, ou deixe em branco.");
    }
    const quotas = { inteiraQuota, meiaQuota };
    const quotaProblem = quotasError(capacity, quotas);
    if (quotaProblem) return fail(quotaProblem);

    if (!Array.isArray(session.prices)) return fail("Preços inválidos.");
    const seen = new Set<number>();
    const prices: SessionRpcItem["prices"] = [];
    const limited: LimitedType[] = [];
    for (const rawPrice of session.prices) {
      if (!rawPrice || typeof rawPrice !== "object") return fail("Preços inválidos.");
      const price = rawPrice as Record<string, unknown>;
      const typeIndex = price.typeIndex;
      if (
        typeof typeIndex !== "number" ||
        !Number.isInteger(typeIndex) ||
        typeIndex < 0 ||
        typeIndex >= types.length ||
        seen.has(typeIndex)
      ) {
        return fail("Preços inválidos.");
      }
      seen.add(typeIndex);
      const type = types[typeIndex];
      if (typeof price.onSale !== "boolean") return fail("Preços inválidos.");
      const priceCents = price.priceCents ?? null;
      if (priceCents !== null && !isPositiveInteger(priceCents, TICKET_TYPE_LIMITS.maxPriceCents)) {
        return fail(`Informe um preço válido para “${type.name}”.`);
      }
      if (price.onSale && priceCents === null) {
        return fail(`Informe o preço de “${type.name}” (ex.: 45,00).`);
      }
      const maxUnits = price.maxUnits ?? null;
      if (maxUnits !== null && !isPositiveInteger(maxUnits, TICKET_TYPE_LIMITS.maxUnits)) {
        return fail(`Informe um limite válido para “${type.name}” ou deixe em branco.`);
      }
      prices.push({ type_index: typeIndex, price_cents: priceCents, max_units: maxUnits, on_sale: price.onSale });
      if (price.onSale) limited.push({ ...type, maxUnits });
    }
    if (!limited.length) return fail("Deixe pelo menos um tipo à venda.");
    const limitProblem = typeLimitsError(capacity, quotas, limited);
    if (limitProblem) return fail(limitProblem);

    items.push({
      id,
      name: name || null,
      starts_at: startIso,
      ends_at: endIso,
      capacity,
      inteira_quota: inteiraQuota,
      meia_quota: meiaQuota,
      prices,
    });
  }

  return { ok: true, items };
}

/**
 * Preço-espelho de cada tipo (código anterior lê `ticket_types.price_cents`): o da
 * primeira sessão que tem preço. `null` na posição = tipo sem preço em nenhuma sessão.
 */
export function mirrorPrices(items: readonly SessionRpcItem[], typeCount: number): (number | null)[] {
  return Array.from({ length: typeCount }, (_, index) => {
    for (const item of items) {
      const price = item.prices.find((entry) => entry.type_index === index)?.price_cents;
      if (price) return price;
    }
    return null;
  });
}

const CATEGORY_NAMES = { inteira: "inteiras", meia: "meias" } as const;

/**
 * Traduz os erros `SESSAO_*` do banco. `labels[i]` = rótulo da sessão na posição
 * i+1 da lista enviada; `removedLabels` = rótulo das sessões que saíram da lista.
 */
export function sessionsDbErrorMessage(
  message: string | undefined,
  labels: readonly string[],
  removedLabels: ReadonlyMap<string, string> = new Map(),
): string | null {
  if (!message) return null;
  const at = (position: string) => labels[Number(position) - 1] ?? "";

  const lower = message.match(/SESSAO_LOTACAO_MENOR:(\d+):(\d+)/);
  if (lower) {
    return withLabel(at(lower[1]), `O total não pode ser menor que ${lower[2]} (já vendidos ou reservados).`);
  }
  const quota = message.match(/SESSAO_COTA_MENOR:(\d+):(inteira|meia):(\d+)/);
  if (quota) {
    const name = CATEGORY_NAMES[quota[2] as "inteira" | "meia"];
    return withLabel(at(quota[1]), `A quantidade de ${name} não pode ser menor que ${quota[3]} (já vendidos ou reservados).`);
  }
  const limit = message.match(/SESSAO_LIMITE_MENOR:(\d+):(\d+):(.+?)(?:$|\n)/);
  if (limit) {
    return withLabel(at(limit[1]), `O limite de “${limit[3].trim()}” não pode ser menor que ${limit[2]} (já vendidos ou reservados).`);
  }
  const sold = message.match(/SESSAO_COM_VENDAS:([0-9a-f-]{36})/i);
  if (sold) {
    const label = removedLabels.get(sold[1]);
    return `${label ? `A sessão ${label}` : "Uma das sessões removidas"} tem vendas e não pode ser removida. Recarregue a página.`;
  }
  const position = message.match(/SESSAO_(HORARIO_REPETIDO|PRECO|SEM_TIPO|CANCELADA|COTA_INVALIDA|INVALIDA):(\d+)/);
  if (position) {
    const label = at(position[2]);
    switch (position[1]) {
      case "HORARIO_REPETIDO":
        return withLabel(label, "Já existe uma sessão neste horário.");
      case "PRECO":
        return withLabel(label, "Informe o preço de cada tipo à venda.");
      case "SEM_TIPO":
        return withLabel(label, "Deixe pelo menos um tipo à venda.");
      case "CANCELADA":
        return withLabel(label, "Sessão cancelada não pode ser editada.");
      case "COTA_INVALIDA":
        return withLabel(label, "As quantidades de inteiras e meias precisam caber no total de ingressos.");
      default:
        return withLabel(label, "Confira os dados da sessão.");
    }
  }
  if (message.includes("SESSAO_DESATUALIZADA")) {
    return "As sessões mudaram enquanto você editava. Recarregue a página e tente de novo.";
  }
  if (message.includes("SESSAO_QUANTIDADE")) {
    return `Cadastre de 1 a ${MAX_SESSIONS} sessões.`;
  }
  return null;
}
