import { describe, expect, it } from "vitest";
import { LOCKED_FIELD_LABELS, lockedFieldsFor } from "@/lib/organizer/post-approval";

describe("campos travados depois da aprovação", () => {
  it("rascunho e recusado: nada travado", () => {
    expect(lockedFieldsFor("rascunho", true)).toEqual([]);
    expect(lockedFieldsFor("recusado", true)).toEqual([]);
  });
  it("aprovado: nome e local sempre; horário, preço e lugares só em sessão com venda", () => {
    expect(lockedFieldsFor("aprovado", false)).toEqual(["nome", "local"]);
    expect(lockedFieldsFor("aprovado", true)).toEqual(["nome", "local", "horario", "preco", "lotacao"]);
  });
  it("em análise e situação desconhecida: o dono não edita nada, mas a trava é do banco", () => {
    expect(lockedFieldsFor("em_analise", false)).toEqual([]);
  });
  it("cada campo travado tem um nome simples para a tela", () => {
    expect(LOCKED_FIELD_LABELS).toEqual({
      nome: "nome do evento",
      local: "local",
      horario: "horário",
      preco: "preço",
      lotacao: "lugares",
    });
  });
});
