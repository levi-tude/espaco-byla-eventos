import { describe, expect, it } from "vitest";
import { AREAS, areaForPath, areaRedirectFor, toAreaStatus } from "@/lib/auth/area";

describe("áreas com login", () => {
  it("reconhece só os prefixos certos", () => {
    expect(areaForPath("/equipe")).toBe("equipe");
    expect(areaForPath("/equipe/eventos/x")).toBe("equipe");
    expect(areaForPath("/organizador")).toBe("organizador");
    expect(areaForPath("/organizador/eventos/x")).toBe("organizador");
    expect(areaForPath("/organizadores")).toBeNull();
    expect(areaForPath("/equipes")).toBeNull();
    expect(areaForPath("/convite")).toBeNull();
    expect(areaForPath("/quero-fazer-meu-evento")).toBeNull();
    expect(areaForPath("/")).toBeNull();
  });

  it.each([
    ["/organizador", "fora", "/organizador/entrar"],
    ["/organizador", "pendente", "/organizador/verificar"],
    ["/organizador", "verificado", null],
    ["/organizador/entrar", "fora", null],
    ["/organizador/entrar", "pendente", "/organizador/verificar"],
    ["/organizador/entrar", "verificado", "/organizador"],
    ["/organizador/verificar", "fora", "/organizador/entrar"],
    ["/organizador/verificar", "pendente", null],
    ["/organizador/verificar", "verificado", "/organizador"],
    ["/organizador/eventos/x", "pendente", "/organizador/verificar"],
  ] as const)("organizador %s com %s → %s", (path, status, target) => {
    expect(areaRedirectFor("organizador", path, status)).toBe(target);
  });

  it("conta do tipo errado conta como fora", () => {
    expect(toAreaStatus("verificado", "organizador", "equipe")).toBe("fora");
    expect(toAreaStatus("verificado", "equipe", "organizador")).toBe("fora");
    expect(toAreaStatus("pendente", "organizador", "organizador")).toBe("pendente");
    expect(toAreaStatus("verificado", "equipe", "equipe")).toBe("verificado");
    expect(toAreaStatus("verificado", null, "equipe")).toBe("fora");
    expect(toAreaStatus("VERIFICADO", "equipe", "equipe")).toBe("fora");
    expect(toAreaStatus(undefined, "equipe", "equipe")).toBe("fora");
  });

  it("cookies separados por área", () => {
    expect(AREAS.equipe).toMatchObject({ deviceCookie: "byla_equipe_aparelho", cookiePath: "/equipe" });
    expect(AREAS.organizador).toMatchObject({ deviceCookie: "byla_org_aparelho", cookiePath: "/organizador" });
  });
});
