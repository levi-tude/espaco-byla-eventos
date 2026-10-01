import { describe, expect, it } from "vitest";

import {
  cartStorageKey,
  clearCart,
  parseCart,
  readCart,
  writeCart,
} from "@/lib/cart/browser-cart";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const cart = {
  quantities: { inteira: 2, meia: 1 },
  name: "Comprador",
  email: "comprador@example.com",
  phone: "",
};

const NOW = Date.parse("2026-10-01T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("carrinho no navegador", () => {
  it("grava e lê de volta a seleção e os dados", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    expect(readCart(storage, "show", NOW + 1000)).toEqual({ ...cart, updatedAt: NOW });
  });

  it("um carrinho por evento", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    expect(readCart(storage, "outro-show", NOW)).toBeNull();
    expect(cartStorageKey("show")).toBe("byla:cart:v1:show");
  });

  it("vence depois de 7 dias e é apagado", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    expect(readCart(storage, "show", NOW + 7 * DAY)).not.toBeNull();
    expect(readCart(storage, "show", NOW + 7 * DAY + 1)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("ignora versão diferente ou conteúdo inválido", () => {
    expect(parseCart(JSON.stringify({ v: 2, ...cart, updatedAt: NOW }), NOW)).toBeNull();
    expect(parseCart("{quebrado", NOW)).toBeNull();
    expect(parseCart(null, NOW)).toBeNull();
  });

  it("saneia quantidades e textos adulterados", () => {
    const parsed = parseCart(
      JSON.stringify({
        v: 1,
        quantities: { inteira: 999, meia: -3, cortesia: 5 },
        name: 42,
        email: "x".repeat(400),
        phone: null,
        updatedAt: NOW,
      }),
      NOW,
    );
    expect(parsed?.quantities).toEqual({ inteira: 10, meia: 0 });
    expect(parsed?.name).toBe("");
    expect(parsed?.email).toHaveLength(320);
    expect(parsed?.phone).toBe("");
  });

  it("carrinho vazio não fica salvo", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    writeCart(
      storage,
      "show",
      { quantities: { inteira: 0, meia: 0 }, name: " ", email: "", phone: "" },
      NOW,
    );
    expect(storage.data.size).toBe(0);
  });

  it("apaga ao confirmar o pagamento", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    clearCart(storage, "show");
    expect(readCart(storage, "show", NOW)).toBeNull();
  });

  it("sem armazenamento disponível não quebra", () => {
    const failing = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cota cheia");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(readCart(failing, "show", NOW)).toBeNull();
    expect(() => writeCart(failing, "show", cart, NOW)).not.toThrow();
    expect(() => clearCart(failing, "show")).not.toThrow();
    expect(readCart(null, "show", NOW)).toBeNull();
  });
});
