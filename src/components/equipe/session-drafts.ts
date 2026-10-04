import { toEventInputValue } from "@/lib/datetime";
import { parseQuotaInput } from "@/lib/domain/quotas";
import { MAX_SESSIONS, type SessionInput } from "@/lib/domain/session-editor";
import { TICKET_TYPE_LIMITS } from "@/lib/domain/ticket-types";
import type { LimitedType } from "@/lib/domain/type-limits";

/** Preço, "à venda" e limite de um tipo numa sessão, como digitados. */
export type PriceDraft = { onSale: boolean; price: string; maxUnits: string };

/** Tipo marcado no editor, na ordem da lista (a posição vira `typeIndex`). */
export type DraftType = Omit<LimitedType, "maxUnits"> & { key: string };

/** Sessão como a página da equipe carrega do banco. */
export type EditorSession = {
  id: string;
  name: string | null;
  startsAt: string;
  endsAt: string | null;
  capacity: number;
  inteiraQuota: number | null;
  meiaQuota: number | null;
  /** Por chave do tipo no editor (`preset:<tipo>` ou `custom:<id>`). */
  prices: Record<string, { priceCents: number; maxUnits: number | null; onSale: boolean }>;
  /** Pessoas com ingresso pago ou entrada registrada. */
  sold: number;
  /** Vendidos + reservas ativas. */
  occupied: number;
  /** Algum pedido (de qualquer status) já foi feito nesta sessão. */
  hasOrders: boolean;
  /** Pago, aguardando decisão ou reserva ativa: não pode ser removida. */
  liveOrders: boolean;
  /** Pedidos pagos (para o aviso de mudança de horário). */
  paidOrders: number;
};

/** Chave do tipo no editor (liga o tipo ao preço de cada sessão). */
export function presetTypeKey(preset: string): string {
  return `preset:${preset}`;
}

export function customTypeKey(rowKey: string): string {
  return `custom:${rowKey}`;
}

/** Chave de um tipo salvo, como a página carrega do banco. */
export function savedTypeKey(type: { id: string; preset: string | null }): string {
  return type.preset ? presetTypeKey(type.preset) : customTypeKey(type.id);
}

export type SessionDraft = {
  key: string;
  id: string | null;
  name: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  inteiraQuota: string;
  meiaQuota: string;
  prices: Record<string, PriceDraft>;
  /** Situação no banco; `null` = sessão nova. */
  saved: (Pick<EditorSession, "sold" | "occupied" | "hasOrders" | "liveOrders" | "paidOrders"> & {
    startsAt: string;
    endsAt: string;
  }) | null;
};

const EMPTY_PRICE: PriceDraft = { onSale: true, price: "", maxUnits: "" };

let draftSequence = 0;
function newDraftKey() {
  draftSequence += 1;
  return `sessao-nova-${draftSequence}`;
}

function priceText(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** "45", "45,5", "45,50" ou "45.50" → centavos; `null` se inválido. */
export function parsePriceCents(value: string): number | null {
  const clean = value.trim().replace(/\s/g, "");
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean.replace(",", ".")) * 100);
  return cents >= 1 && cents <= TICKET_TYPE_LIMITS.maxPriceCents ? cents : null;
}

/** Limite digitado: vazio = sem limite; `undefined` = inválido. */
export function parseLimit(value: string): number | null | undefined {
  const clean = value.trim();
  if (!clean) return null;
  if (!/^\d{1,6}$/.test(clean)) return undefined;
  const units = Number(clean);
  return units >= 1 && units <= TICKET_TYPE_LIMITS.maxUnits ? units : undefined;
}

export function priceDraftFor(draft: SessionDraft, key: string): PriceDraft {
  return draft.prices[key] ?? EMPTY_PRICE;
}

function blankDraft(): SessionDraft {
  return {
    key: newDraftKey(),
    id: null,
    name: "",
    startsAt: "",
    endsAt: "",
    capacity: "",
    inteiraQuota: "",
    meiaQuota: "",
    prices: {},
    saved: null,
  };
}

/** Evento novo: uma sessão em branco. Existente: as sessões do banco. */
export function initialSessionDrafts(sessions?: readonly EditorSession[]): SessionDraft[] {
  if (!sessions?.length) return [blankDraft()];
  return sessions.map((session) => {
    const startsAt = toEventInputValue(session.startsAt);
    const endsAt = session.endsAt ? toEventInputValue(session.endsAt) : "";
    return {
      key: session.id,
      id: session.id,
      name: session.name ?? "",
      startsAt,
      endsAt,
      capacity: String(session.capacity),
      inteiraQuota: session.inteiraQuota === null ? "" : String(session.inteiraQuota),
      meiaQuota: session.meiaQuota === null ? "" : String(session.meiaQuota),
      prices: Object.fromEntries(
        Object.entries(session.prices).map(([key, price]) => [
          key,
          {
            onSale: price.onSale,
            price: priceText(price.priceCents),
            maxUnits: price.maxUnits === null ? "" : String(price.maxUnits),
          },
        ]),
      ),
      saved: {
        sold: session.sold,
        occupied: session.occupied,
        hasOrders: session.hasOrders,
        liveOrders: session.liveOrders,
        paidOrders: session.paidOrders,
        startsAt,
        endsAt,
      },
    };
  });
}

/** "+ Adicionar sessão": copia lotação, cotas, preços, limites e "à venda" da última. */
export function addSessionDraft(drafts: readonly SessionDraft[]): SessionDraft[] {
  if (drafts.length >= MAX_SESSIONS) return [...drafts];
  const last = drafts.at(-1);
  const next = blankDraft();
  if (last) {
    next.capacity = last.capacity;
    next.inteiraQuota = last.inteiraQuota;
    next.meiaQuota = last.meiaQuota;
    next.prices = Object.fromEntries(
      Object.entries(last.prices).map(([key, price]) => [key, { ...price }]),
    );
  }
  return [...drafts, next];
}

/**
 * Volta a uma sessão só: a tela junta tipo e preço numa linha, então todo tipo
 * marcado fica à venda (sem preço, o formulário pede).
 */
export function removeSessionDraft(drafts: readonly SessionDraft[], key: string): SessionDraft[] {
  const next = drafts.filter((draft) => draft.key !== key);
  if (next.length !== 1) return next;
  const only = next[0];
  return [
    {
      ...only,
      prices: Object.fromEntries(
        Object.entries(only.prices).map(([typeKey, price]) => [typeKey, { ...price, onSale: true }]),
      ),
    },
  ];
}

/** "Aplicar estes preços a todas as sessões". */
export function applyPricesToAll(
  drafts: readonly SessionDraft[],
  fromKey: string,
  types: readonly DraftType[],
): SessionDraft[] {
  const source = drafts.find((draft) => draft.key === fromKey);
  if (!source) return [...drafts];
  const prices = Object.fromEntries(types.map((type) => [type.key, { ...priceDraftFor(source, type.key) }]));
  return drafts.map((draft) =>
    draft.key === fromKey ? draft : { ...draft, prices: { ...draft.prices, ...structuredClone(prices) } },
  );
}

/** Limites de uma sessão como estão na tela (para o resumo ao vivo); inválido conta como vazio. */
export function limitedTypesForDraft(
  draft: SessionDraft,
  types: readonly DraftType[],
  single: boolean,
): LimitedType[] {
  return types
    .filter((type) => single || priceDraftFor(draft, type.key).onSale)
    .map((type) => ({
      name: type.name,
      kind: type.kind,
      peoplePerUnit: type.peoplePerUnit,
      maxUnits: parseLimit(priceDraftFor(draft, type.key).maxUnits) ?? null,
    }));
}

type ToInputResult = { ok: true; sessions: SessionInput[] } | { ok: false; error: string };

/**
 * Converte as sessões da tela para a ação. Em sessão única todo tipo marcado
 * fica à venda (como hoje). O servidor e o banco validam tudo de novo.
 */
export function sessionsToInput(
  drafts: readonly SessionDraft[],
  types: readonly DraftType[],
): ToInputResult {
  const single = drafts.length === 1;
  const sessions: SessionInput[] = [];
  for (const [index, draft] of drafts.entries()) {
    const prefix = single ? "" : `Sessão ${index + 1}: `;
    const capacity = Number(draft.capacity);
    if (!draft.capacity.trim() || !Number.isInteger(capacity) || capacity < 1) {
      return { ok: false, error: `${prefix}Informe um total de ingressos válido.` };
    }
    const inteiraQuota = parseQuotaInput(draft.inteiraQuota);
    const meiaQuota = parseQuotaInput(draft.meiaQuota);
    if (inteiraQuota === undefined || meiaQuota === undefined) {
      return {
        ok: false,
        error: `${prefix}Use números inteiros nas quantidades de inteiras e meias, ou deixe em branco.`,
      };
    }
    const prices: SessionInput["prices"] = [];
    for (const [typeIndex, type] of types.entries()) {
      const row = priceDraftFor(draft, type.key);
      const onSale = single || row.onSale;
      const priceCents = row.price.trim() ? parsePriceCents(row.price) : null;
      if (row.price.trim() && priceCents === null) {
        return { ok: false, error: `${prefix}Informe um preço válido para “${type.name}” (ex.: 45,00).` };
      }
      if (onSale && priceCents === null) {
        return { ok: false, error: `${prefix}Informe o preço de “${type.name}” (ex.: 45,00).` };
      }
      const maxUnits = parseLimit(row.maxUnits);
      if (maxUnits === undefined) {
        return { ok: false, error: `${prefix}Informe um limite válido para “${type.name}” ou deixe em branco.` };
      }
      prices.push({ typeIndex, priceCents, maxUnits, onSale });
    }
    sessions.push({
      id: draft.id,
      name: draft.name.trim(),
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      capacity,
      inteiraQuota,
      meiaQuota,
      prices,
    });
  }
  return { ok: true, sessions };
}

/** Sessões com pedidos pagos cujo horário mudou na tela (pede confirmação ao salvar). */
export function scheduleChangesWithSales(
  drafts: readonly SessionDraft[],
): { draft: SessionDraft; paidOrders: number }[] {
  return drafts.flatMap((draft) =>
    draft.saved &&
    draft.saved.paidOrders > 0 &&
    (draft.saved.startsAt !== draft.startsAt || draft.saved.endsAt !== draft.endsAt)
      ? [{ draft, paidOrders: draft.saved.paidOrders }]
      : [],
  );
}
