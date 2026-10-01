import { describe, expect, it } from "vitest";

import { maskEmail } from "@/lib/domain/mask";

describe("maskEmail", () => {
  it("mostra só a primeira letra e o domínio", () => {
    expect(maskEmail("joana@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("  a@exemplo.com.br ")).toBe("a***@exemplo.com.br");
  });

  it("e-mail malformado não vaza o texto original", () => {
    expect(maskEmail("sem-arroba")).toBe("seu e-mail");
    expect(maskEmail("@dominio.com")).toBe("seu e-mail");
    expect(maskEmail("nome@")).toBe("seu e-mail");
  });
});
