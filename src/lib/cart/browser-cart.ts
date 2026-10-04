import { isPublicTokenFormat } from "@/lib/domain/public-token";
import { isUuid } from "@/lib/domain/ticket-types";

/** Categorias do carrinho antigo (v1), antes dos tipos configuráveis. */
export type LegacyCartKind = "inteira" | "meia";

/** Para onde vão as quantidades do carrinho antigo: id do tipo pronto à venda. */
export type LegacyKindMap = Partial<Record<LegacyCartKind, string>>;

export type BrowserCart = {
  /** Unidades por id de tipo de ingresso. */
  quantities: Record<string, number>;
  name: string;
  email: string;
  phone: string;
  /** Pedido criado a partir deste carrinho que pode ainda estar aguardando pagamento. */
  pendingOrderToken?: string;
  /** Sessão da seleção; carrinho de antes das sessões não tem. */
  sessionId?: string;
  /** Carrinho antigo tinha item que não está mais à venda e ficou de fora. */
  droppedItems?: boolean;
  updatedAt: number;
};

type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const CART_VERSION = 2;
const LEGACY_VERSION = 1;
const CART_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_KINDS: readonly LegacyCartKind[] = ["inteira", "meia"];
const MAX_QTY = 10;
const MAX_TYPES = 20;
const FIELD_LIMITS = { name: 200, email: 320, phone: 40 } as const;

export function cartStorageKey(slug: string, version = CART_VERSION) {
  return `byla:cart:v${version}:${slug}`;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanQty(value: unknown): number {
  return Number.isInteger(value) ? Math.min(Math.max(value as number, 0), MAX_QTY) : 0;
}

export function parseCart(
  raw: string | null,
  now = Date.now(),
  legacyKinds: LegacyKindMap = {},
): BrowserCart | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.v !== CART_VERSION && record.v !== LEGACY_VERSION) return null;

  const updatedAt = record.updatedAt;
  if (
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    now - updatedAt > CART_MAX_AGE_MS
  ) {
    return null;
  }

  const rawQuantities =
    record.quantities && typeof record.quantities === "object"
      ? (record.quantities as Record<string, unknown>)
      : {};
  const quantities: Record<string, number> = {};
  let droppedItems = false;
  if (record.v === CART_VERSION) {
    for (const [id, value] of Object.entries(rawQuantities).slice(0, MAX_TYPES)) {
      const qty = cleanQty(value);
      if (isUuid(id) && qty > 0) quantities[id] = qty;
    }
  } else {
    // v1 guardava por categoria: inteira/meia viram os tipos prontos do evento.
    for (const kind of LEGACY_KINDS) {
      const qty = cleanQty(rawQuantities[kind]);
      if (qty === 0) continue;
      const id = legacyKinds[kind];
      if (id) quantities[id] = qty;
      else droppedItems = true;
    }
  }

  return {
    quantities,
    name: cleanText(record.name, FIELD_LIMITS.name),
    email: cleanText(record.email, FIELD_LIMITS.email),
    phone: cleanText(record.phone, FIELD_LIMITS.phone),
    ...(isPublicTokenFormat(record.pendingOrderToken)
      ? { pendingOrderToken: record.pendingOrderToken }
      : {}),
    ...(typeof record.sessionId === "string" && isUuid(record.sessionId)
      ? { sessionId: record.sessionId }
      : {}),
    ...(droppedItems ? { droppedItems } : {}),
    updatedAt,
  };
}

type StoredCart = Omit<BrowserCart, "updatedAt" | "droppedItems">;

export function isEmptyCart(cart: StoredCart): boolean {
  return (
    !cart.pendingOrderToken &&
    Object.values(cart.quantities).every((qty) => qty === 0) &&
    !cart.name.trim() &&
    !cart.email.trim() &&
    !cart.phone.trim()
  );
}

// Navegação anônima, iframes isolados e cota cheia fazem o localStorage lançar
// erro; o carrinho é só conveniência, então toda falha vira "sem carrinho".
export function browserStorage(): CartStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Lê o carrinho atual; sem ele, aproveita o carrinho antigo (v1) do mesmo evento. */
export function readCart(
  storage: CartStorage | null,
  slug: string,
  now = Date.now(),
  legacyKinds: LegacyKindMap = {},
) {
  if (!storage) return null;
  try {
    for (const version of [CART_VERSION, LEGACY_VERSION]) {
      const key = cartStorageKey(slug, version);
      const raw = storage.getItem(key);
      if (!raw) continue;
      const cart = parseCart(raw, now, legacyKinds);
      if (cart) return cart;
      storage.removeItem(key);
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCart(
  storage: CartStorage | null,
  slug: string,
  cart: StoredCart,
  now = Date.now(),
) {
  if (!storage) return;
  try {
    const key = cartStorageKey(slug);
    storage.removeItem(cartStorageKey(slug, LEGACY_VERSION));
    const quantities = Object.fromEntries(
      Object.entries(cart.quantities).filter(([, qty]) => qty > 0),
    );
    if (isEmptyCart(cart)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify({ v: CART_VERSION, ...cart, quantities, updatedAt: now }),
    );
  } catch {
    // Sem armazenamento disponível: segue sem carrinho salvo.
  }
}

export function clearCart(storage: CartStorage | null, slug: string) {
  if (!storage) return;
  try {
    storage.removeItem(cartStorageKey(slug));
    storage.removeItem(cartStorageKey(slug, LEGACY_VERSION));
  } catch {
    // Sem armazenamento disponível: nada a apagar.
  }
}
