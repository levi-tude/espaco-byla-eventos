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

const INTEIRA = "20000000-0000-4000-8000-000000000001";
const MEIA = "20000000-0000-4000-8000-000000000002";
const CASADINHA = "20000000-0000-4000-8000-000000000004";

const cart = {
  quantities: { [INTEIRA]: 2, [CASADINHA]: 1 },
  name: "Comprador",
  email: "comprador@example.com",
  phone: "",
};

const NOW = Date.parse("2026-10-01T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function legacyCart(quantities: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    quantities,
    name: "Comprador",
    email: "comprador@example.com",
    phone: "",
    updatedAt: NOW,
    ...extra,
  });
}

describe("carrinho no navegador", () => {
  it("grava e lê de volta a seleção (por tipo) e os dados", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    expect(readCart(storage, "show", NOW + 1000)).toEqual({ ...cart, updatedAt: NOW });
  });

  it("um carrinho por evento", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    expect(readCart(storage, "outro-show", NOW)).toBeNull();
    expect(cartStorageKey("show")).toBe("byla:cart:v2:show");
  });

  it("vence depois de 7 dias e é apagado", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    expect(readCart(storage, "show", NOW + 7 * DAY)).not.toBeNull();
    expect(readCart(storage, "show", NOW + 7 * DAY + 1)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it("ignora versão desconhecida ou conteúdo inválido", () => {
    expect(parseCart(JSON.stringify({ v: 3, ...cart, updatedAt: NOW }), NOW)).toBeNull();
    expect(parseCart("{quebrado", NOW)).toBeNull();
    expect(parseCart(null, NOW)).toBeNull();
  });

  it("saneia quantidades, ids e textos adulterados", () => {
    const parsed = parseCart(
      JSON.stringify({
        v: 2,
        quantities: { [INTEIRA]: 999, [MEIA]: -3, "../hack": 5, [CASADINHA]: 1.5 },
        name: 42,
        email: "x".repeat(400),
        phone: null,
        updatedAt: NOW,
      }),
      NOW,
    );
    expect(parsed?.quantities).toEqual({ [INTEIRA]: 10 });
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
      { quantities: { [INTEIRA]: 0 }, name: " ", email: "", phone: "" },
      NOW,
    );
    expect(storage.data.size).toBe(0);
  });

  it("guarda o pedido pendente criado a partir do carrinho", () => {
    const storage = memoryStorage();
    const token = "4f0c2a8e-1b2c-4d3e-9f00-112233445566";
    writeCart(storage, "show", { ...cart, pendingOrderToken: token }, NOW);
    expect(readCart(storage, "show", NOW)?.pendingOrderToken).toBe(token);
  });

  it("token adulterado é ignorado", () => {
    const parsed = parseCart(
      JSON.stringify({ v: 2, ...cart, pendingOrderToken: "../x?y", updatedAt: NOW }),
      NOW,
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("pendingOrderToken");
  });

  it("com pedido pendente, o carrinho não é apagado mesmo sem seleção", () => {
    const storage = memoryStorage();
    writeCart(
      storage,
      "show",
      { quantities: {}, name: "", email: "", phone: "", pendingOrderToken: "token-1" },
      NOW,
    );
    expect(readCart(storage, "show", NOW)?.pendingOrderToken).toBe("token-1");
  });

  it("apaga ao confirmar o pagamento (inclusive o carrinho antigo)", () => {
    const storage = memoryStorage();
    writeCart(storage, "show", cart, NOW);
    storage.setItem(cartStorageKey("show", 1), legacyCart({ inteira: 1 }));
    clearCart(storage, "show");
    expect(readCart(storage, "show", NOW)).toBeNull();
    expect(storage.data.size).toBe(0);
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

describe("carrinho antigo (antes dos tipos configuráveis)", () => {
  it("inteira e meia viram os tipos prontos à venda", () => {
    const storage = memoryStorage();
    storage.setItem(
      cartStorageKey("show", 1),
      legacyCart({ inteira: 2, meia: 1 }, { pendingOrderToken: "token-1" }),
    );
    expect(readCart(storage, "show", NOW, { inteira: INTEIRA, meia: MEIA })).toEqual({
      quantities: { [INTEIRA]: 2, [MEIA]: 1 },
      name: "Comprador",
      email: "comprador@example.com",
      phone: "",
      pendingOrderToken: "token-1",
      updatedAt: NOW,
    });
  });

  it("categoria que não está mais à venda é descartada com aviso", () => {
    const parsed = parseCart(legacyCart({ inteira: 2, meia: 1 }), NOW, { inteira: INTEIRA });
    expect(parsed?.quantities).toEqual({ [INTEIRA]: 2 });
    expect(parsed?.droppedItems).toBe(true);
  });

  it("sem itens descartados não há aviso", () => {
    const parsed = parseCart(legacyCart({ inteira: 2, meia: 0 }), NOW, { inteira: INTEIRA });
    expect(parsed).not.toHaveProperty("droppedItems");
  });

  it("ao gravar, o carrinho antigo dá lugar ao novo", () => {
    const storage = memoryStorage();
    storage.setItem(cartStorageKey("show", 1), legacyCart({ inteira: 1 }));
    const converted = readCart(storage, "show", NOW, { inteira: INTEIRA });
    writeCart(
      storage,
      "show",
      {
        quantities: converted!.quantities,
        name: converted!.name,
        email: converted!.email,
        phone: converted!.phone,
      },
      NOW,
    );
    expect([...storage.data.keys()]).toEqual([cartStorageKey("show")]);
  });

  it("o carrinho novo tem prioridade sobre o antigo", () => {
    const storage = memoryStorage();
    storage.setItem(cartStorageKey("show", 1), legacyCart({ inteira: 5 }));
    storage.setItem(
      cartStorageKey("show"),
      JSON.stringify({ v: 2, ...cart, updatedAt: NOW }),
    );
    expect(readCart(storage, "show", NOW, { inteira: INTEIRA })?.quantities).toEqual(
      cart.quantities,
    );
  });
});
