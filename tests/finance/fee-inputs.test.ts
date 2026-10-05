import { describe, expect, it } from "vitest";

import {
  isFeeAmount,
  isValidPixDate,
  normalizeFeeNote,
  normalizeFeeReason,
  parseReaisInput,
} from "@/lib/finance/fee-inputs";
import { feeSituationLabel, formatSigned } from "@/lib/finance/situation";

/** O formatador de moeda usa espaço inseparável depois de "R$". */
const plain = (text: string) => text.replace(/\u00a0/g, " ");

describe("parseReaisInput", () => {
  it.each([
    ["2,50", 250],
    ["-2,50", -250],
    ["−2,50", -250],
    ["+10", 1000],
    ["R$ 1.234,56", 123456],
    ["2.5", 250],
    ["1.000", 100000],
    ["0,05", 5],
  ])("%s → %i centavos", (text, cents) => {
    expect(parseReaisInput(text)).toBe(cents);
  });

  it.each(["", "abc", "2,555", "1,2,3", "--2", "2-"])("não entende %s", (text) => {
    expect(parseReaisInput(text)).toBeNull();
  });
});

describe("validações", () => {
  it("valor do repasse: inteiro positivo até R$ 100.000,00", () => {
    expect(isFeeAmount(1, { allowNegative: false })).toBe(true);
    expect(isFeeAmount(10_000_000, { allowNegative: false })).toBe(true);
    expect(isFeeAmount(-1, { allowNegative: false })).toBe(false);
    expect(isFeeAmount(-1, { allowNegative: true })).toBe(true);
    expect(isFeeAmount(0, { allowNegative: true })).toBe(false);
    expect(isFeeAmount(Number.NaN, { allowNegative: true })).toBe(false);
  });

  it("data do PIX: existe e não é futura", () => {
    expect(isValidPixDate("2026-10-04", "2026-10-04")).toBe(true);
    expect(isValidPixDate("2026-10-05", "2026-10-04")).toBe(false);
    expect(isValidPixDate("2026-02-29", "2026-10-04")).toBe(false);
    expect(isValidPixDate("2026-10-4", "2026-10-04")).toBe(false);
  });

  it("nota: vazia vira nula; sem quebra de linha; até 140", () => {
    expect(normalizeFeeNote(undefined)).toEqual({ ok: true, note: null });
    expect(normalizeFeeNote("  ")).toEqual({ ok: true, note: null });
    expect(normalizeFeeNote(" E1 ")).toEqual({ ok: true, note: "E1" });
    expect(normalizeFeeNote("a\r\nb")).toEqual({ ok: false });
    expect(normalizeFeeNote("a".repeat(141))).toEqual({ ok: false });
    expect(normalizeFeeNote(42)).toEqual({ ok: false });
  });

  it("motivo: 5 a 500 sem contar espaços nas pontas", () => {
    expect(normalizeFeeReason("  abcde ")).toBe("abcde");
    expect(normalizeFeeReason("abcd")).toBeNull();
    expect(normalizeFeeReason("a".repeat(501))).toBeNull();
    expect(normalizeFeeReason(null)).toBeNull();
  });
});

describe("textos da situação", () => {
  it.each([
    [{ kind: "aguardando", dueDate: "2026-10-04" } as const, "Aguardando fim do evento"],
    [{ kind: "a_pagar", balanceCents: 1875 } as const, "A pagar · R$ 18,75"],
    [{ kind: "sem_taxa" } as const, "Sem taxa"],
    [{ kind: "desconto", balanceCents: -250 } as const, "Desconto pendente · −R$ 2,50"],
    [
      {
        kind: "pago",
        last: { createdAt: "2026-10-07T01:00:00.000Z", createdByName: "Ana", pixDate: null },
      } as const,
      "Pago em 06/10 por Ana",
    ],
  ])("%o → %s", (situation, label) => {
    expect(plain(feeSituationLabel(situation))).toBe(label);
  });

  it("valor com sinal", () => {
    expect(plain(formatSigned(200))).toBe("+R$ 2,00");
    expect(plain(formatSigned(-200))).toBe("−R$ 2,00");
  });
});
