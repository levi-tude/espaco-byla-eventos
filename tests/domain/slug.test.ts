import { describe, expect, it } from "vitest";
import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";

describe("slugify", () => {
  it("normaliza acentos, espaços e caracteres especiais", () => {
    expect(slugify("Noite de Teste")).toBe("noite-de-teste");
    expect(slugify("São Paulo — Show!")).toBe("sao-paulo-show");
  });

  it("usa fallback quando o nome vira vazio", () => {
    expect(slugify("   ")).toBe("evento");
    expect(slugify("---")).toBe("evento");
  });
});

describe("resolveUniqueSlug", () => {
  it("retorna o slug base quando ainda não existe", () => {
    expect(resolveUniqueSlug("noite-de-teste", [])).toBe("noite-de-teste");
    expect(resolveUniqueSlug("noite-de-teste", ["outro-evento"])).toBe(
      "noite-de-teste",
    );
  });

  it("adiciona sufixo numérico para colisões", () => {
    expect(resolveUniqueSlug("noite-de-teste", ["noite-de-teste"])).toBe(
      "noite-de-teste-2",
    );
    expect(
      resolveUniqueSlug("noite-de-teste", [
        "noite-de-teste",
        "noite-de-teste-2",
      ]),
    ).toBe("noite-de-teste-3");
  });
});
