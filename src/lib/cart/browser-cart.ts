import { isPublicTokenFormat } from "@/lib/domain/public-token";

export type CartKind = "inteira" | "meia";

export type BrowserCart = {
  quantities: Record<CartKind, number>;
  name: string;
  email: string;
  phone: string;
  /** Pedido criado a partir deste carrinho que pode ainda estar aguardando pagamento. */
  pendingOrderToken?: string;
  updatedAt: number;
};

type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const CART_VERSION = 1;
const CART_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CART_KINDS: readonly CartKind[] = ["inteira", "meia"];
const MAX_QTY = 10;
const FIELD_LIMITS = { name: 200, email: 320, phone: 40 } as const;

export function cartStorageKey(slug: string) {
  return `byla:cart:v${CART_VERSION}:${slug}`;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function parseCart(raw: string | null, now = Date.now()): BrowserCart | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.v !== CART_VERSION) return null;

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
  const quantities = Object.fromEntries(
    CART_KINDS.map((kind) => {
      const qty = rawQuantities[kind];
      return [
        kind,
        Number.isInteger(qty) ? Math.min(Math.max(qty as number, 0), MAX_QTY) : 0,
      ];
    }),
  ) as Record<CartKind, number>;

  return {
    quantities,
    name: cleanText(record.name, FIELD_LIMITS.name),
    email: cleanText(record.email, FIELD_LIMITS.email),
    phone: cleanText(record.phone, FIELD_LIMITS.phone),
    ...(isPublicTokenFormat(record.pendingOrderToken)
      ? { pendingOrderToken: record.pendingOrderToken }
      : {}),
    updatedAt,
  };
}

export function isEmptyCart(cart: Omit<BrowserCart, "updatedAt">): boolean {
  return (
    !cart.pendingOrderToken &&
    CART_KINDS.every((kind) => cart.quantities[kind] === 0) &&
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

export function readCart(storage: CartStorage | null, slug: string, now = Date.now()) {
  if (!storage) return null;
  try {
    const key = cartStorageKey(slug);
    const raw = storage.getItem(key);
    const cart = parseCart(raw, now);
    if (raw && !cart) storage.removeItem(key);
    return cart;
  } catch {
    return null;
  }
}

export function writeCart(
  storage: CartStorage | null,
  slug: string,
  cart: Omit<BrowserCart, "updatedAt">,
  now = Date.now(),
) {
  if (!storage) return;
  try {
    const key = cartStorageKey(slug);
    if (isEmptyCart(cart)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ v: CART_VERSION, ...cart, updatedAt: now }));
  } catch {
    // Sem armazenamento disponível: segue sem carrinho salvo.
  }
}

export function clearCart(storage: CartStorage | null, slug: string) {
  if (!storage) return;
  try {
    storage.removeItem(cartStorageKey(slug));
  } catch {
    // Sem armazenamento disponível: nada a apagar.
  }
}
