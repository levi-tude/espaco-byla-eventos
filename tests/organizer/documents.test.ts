import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCpf, isValidTaxDocument, maskTaxDocument, onlyDigits } from "@/lib/organizer/documents";

describe("CPF e CNPJ", () => {
  it("aceita dígitos verificadores certos", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });
  it("recusa dígito errado, repetidos e tamanho errado", () => {
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
  });
  it("tira pontuação e mascara", () => {
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(maskTaxDocument("52998224725")).toBe("•••.982.247-••");
    expect(maskTaxDocument("11222333000181")).toBe("••.•••.333/0001-••");
  });
  it("documento genérico: CPF ou CNPJ pelo tamanho, outro tamanho recusa", () => {
    expect(isValidTaxDocument("52998224725")).toBe(true);
    expect(isValidTaxDocument("11222333000181")).toBe(true);
    expect(isValidTaxDocument("123")).toBe(false);
    expect(maskTaxDocument("123")).toBe("•••");
  });
});
