import { describe, expect, it } from "vitest";

import {
  parseQuotaInput,
  quotaDbErrorMessage,
  quotaSummary,
  quotasError,
} from "@/lib/domain/quotas";

describe("campos de quantidade de inteiras e meias", () => {
  it("vazio = sem quantidade separada; número inteiro positivo vale", () => {
    expect(parseQuotaInput("")).toBeNull();
    expect(parseQuotaInput("  ")).toBeNull();
    expect(parseQuotaInput("60")).toBe(60);
  });

  it.each(["0", "-1", "2,5", "abc", "1e3"])("“%s” é inválido", (value) => {
    expect(parseQuotaInput(value)).toBeUndefined();
  });
});

describe("regras das cotas", () => {
  it("aceita cotas que cabem no total, juntas ou sozinhas", () => {
    expect(quotasError(100, { inteiraQuota: 60, meiaQuota: 40 })).toBeNull();
    expect(quotasError(100, { inteiraQuota: 100, meiaQuota: null })).toBeNull();
    expect(quotasError(100, { inteiraQuota: null, meiaQuota: null })).toBeNull();
  });

  it("recusa cota acima do total ou soma acima do total", () => {
    expect(quotasError(100, { inteiraQuota: 101, meiaQuota: null })).toBe(
      "A quantidade de inteiras não pode passar do total de ingressos.",
    );
    expect(quotasError(100, { inteiraQuota: null, meiaQuota: 120 })).toBe(
      "A quantidade de meias não pode passar do total de ingressos.",
    );
    expect(quotasError(100, { inteiraQuota: 70, meiaQuota: 40 })).toBe(
      "Inteiras + meias não podem passar do total de ingressos (100).",
    );
  });
});

describe("resumo para a equipe", () => {
  it("mostra a divisão e o que falta distribuir", () => {
    expect(quotaSummary(100, { inteiraQuota: 60, meiaQuota: 40 })).toEqual({
      line: "Total 100 · Inteiras 60 · Meias 40",
      detail: "Tudo distribuído.",
    });
    expect(quotaSummary(100, { inteiraQuota: 50, meiaQuota: 30 })?.detail).toBe(
      "Faltam 20 para distribuir. Sem distribuir, esses lugares só servem para cortesias.",
    );
  });

  it("com só uma cota, a outra categoria usa o que sobrar", () => {
    expect(quotaSummary(100, { inteiraQuota: null, meiaQuota: 40 })).toEqual({
      line: "Total 100 · Inteiras sem cota · Meias 40",
      detail: "As inteiras podem usar até 60 ingressos (o que sobrar do total).",
    });
  });

  it("sem cotas, inteiras e meias dividem o total", () => {
    expect(quotaSummary(80, { inteiraQuota: null, meiaQuota: null })?.detail).toBe(
      "Inteiras e meias dividem o total, sem quantidade separada.",
    );
  });

  it("sem total válido não mostra resumo", () => {
    expect(quotaSummary(0, { inteiraQuota: null, meiaQuota: null })).toBeNull();
    expect(quotaSummary(Number.NaN, { inteiraQuota: 10, meiaQuota: null })).toBeNull();
  });
});

describe("erros do banco ao salvar cotas", () => {
  it("cota abaixo do já vendido diz o número", () => {
    expect(quotaDbErrorMessage("COTA_MENOR:meia:12")).toBe(
      "A quantidade de meias não pode ser menor que 12 (já vendidos ou reservados).",
    );
  });

  it("cota fora do total e erros de outro tipo", () => {
    expect(quotaDbErrorMessage("COTA_INVALIDA: x")).toBe(
      "As quantidades de inteiras e meias precisam caber no total de ingressos.",
    );
    expect(quotaDbErrorMessage("TIPOS_DESATUALIZADO")).toBeNull();
    expect(quotaDbErrorMessage(undefined)).toBeNull();
  });
});
