import { describe, expect, it } from "vitest";
import {
  parseChangeWhat,
  parseEmail,
  parseOrganizerProfile,
  parsePassword,
  parseReason,
  parseSignupRequest,
} from "@/lib/organizer/validation";

const profile = {
  fullName: "Fulana de Tal",
  publicName: "Coletivo Exemplo",
  phone: "(71) 99999-0000",
  pixKeyType: "cpf",
  pixKey: "529.982.247-25",
  pixHolderName: "Fulana de Tal",
  pixHolderDocument: "529.982.247-25",
};

describe("validação", () => {
  it("pedido público: tamanhos do spec", () => {
    expect(parseSignupRequest({ name: "Fu", contact: "71999990000", idea: "Peça de teatro infantil", approxDate: "", privacyAccepted: true }).ok).toBe(true);
    expect(parseSignupRequest({ name: "F", contact: "71999990000", idea: "Peça de teatro", privacyAccepted: true }).ok).toBe(false);
    expect(parseSignupRequest({ name: "Fulana", contact: "71999990000", idea: "curta", privacyAccepted: true }).ok).toBe(false);
    expect(parseSignupRequest({ name: "Fulana", contact: "71999990000", idea: "Peça de teatro", privacyAccepted: false }).ok).toBe(false);
  });
  it("pedido público: apara textos, data vazia vira null e limites altos", () => {
    expect(
      parseSignupRequest({ name: "  Fulana  ", contact: " fulana@exemplo.com ", idea: " Peça de teatro ", approxDate: "  ", privacyAccepted: true }),
    ).toEqual({ ok: true, value: { name: "Fulana", contact: "fulana@exemplo.com", idea: "Peça de teatro", approxDate: null } });
    expect(parseSignupRequest({ name: "Fulana", contact: "71999990000", idea: "Peça de teatro", approxDate: "dezembro", privacyAccepted: true })).toEqual(
      { ok: true, value: expect.objectContaining({ approxDate: "dezembro" }) },
    );
    const base = { name: "Fulana", contact: "71999990000", idea: "Peça de teatro", privacyAccepted: true };
    expect(parseSignupRequest({ ...base, name: "x".repeat(121) }).ok).toBe(false);
    expect(parseSignupRequest({ ...base, contact: "1234" }).ok).toBe(false);
    expect(parseSignupRequest({ ...base, contact: "x".repeat(161) }).ok).toBe(false);
    expect(parseSignupRequest({ ...base, idea: "x".repeat(1001) }).ok).toBe(false);
    expect(parseSignupRequest({ ...base, approxDate: "x".repeat(61) }).ok).toBe(false);
    expect(parseSignupRequest(null).ok).toBe(false);
    expect(parseSignupRequest({ ...base, name: 42 }).ok).toBe(false);
  });
  it("perfil: normaliza telefone e documento, exige chave CPF igual ao titular", () => {
    const ok = parseOrganizerProfile(profile);
    expect(ok).toEqual({ ok: true, value: expect.objectContaining({ phone: "71999990000", pixKey: "52998224725", pixHolderDocument: "52998224725" }) });
    expect(parseOrganizerProfile({ ...profile, pixKey: "111.444.777-35" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixHolderDocument: "529.982.247-24" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "email", pixKey: "fulana@exemplo.com" }).ok).toBe(true);
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "aleatoria", pixKey: "nao-e-uuid" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, publicName: "x".repeat(81) }).ok).toBe(false);
  });
  it("perfil: mensagem da chave CPF/CNPJ diferente do titular", () => {
    expect(parseOrganizerProfile({ ...profile, pixKey: "111.444.777-35" })).toEqual({
      ok: false,
      error: "Para chave CPF/CNPJ, use o documento do titular informado.",
    });
  });
  it("perfil: CNPJ, telefone, e-mail e aleatória no formato guardado pelo banco", () => {
    expect(
      parseOrganizerProfile({ ...profile, pixKeyType: "cnpj", pixKey: "11.222.333/0001-81", pixHolderDocument: "11.222.333/0001-81" }),
    ).toEqual({ ok: true, value: expect.objectContaining({ pixKey: "11222333000181", pixHolderDocument: "11222333000181" }) });
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "cnpj", pixKey: "529.982.247-25" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "telefone", pixKey: "(71) 99999-0000" })).toEqual({
      ok: true,
      value: expect.objectContaining({ pixKey: "+5571999990000" }),
    });
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "telefone", pixKey: "+55 71 99999-0000" })).toEqual({
      ok: true,
      value: expect.objectContaining({ pixKey: "+5571999990000" }),
    });
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "telefone", pixKey: "123" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "email", pixKey: " Fulana@Exemplo.com " })).toEqual({
      ok: true,
      value: expect.objectContaining({ pixKey: "fulana@exemplo.com" }),
    });
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "email", pixKey: `${"a".repeat(60)}@${"b".repeat(10)}.com.br` }).ok).toBe(false);
    expect(
      parseOrganizerProfile({ ...profile, pixKeyType: "aleatoria", pixKey: "123E4567-E89B-12D3-A456-426614174000" }),
    ).toEqual({ ok: true, value: expect.objectContaining({ pixKey: "123e4567-e89b-12d3-a456-426614174000" }) });
    expect(parseOrganizerProfile({ ...profile, pixKeyType: "boleto" }).ok).toBe(false);
  });
  it("perfil: telefone de 10 a 13 dígitos, nomes aparados e titular com documento válido", () => {
    expect(parseOrganizerProfile({ ...profile, phone: "7199999" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, phone: "55719999900001" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, fullName: "  Fulana de Tal  " })).toEqual({
      ok: true,
      value: expect.objectContaining({ fullName: "Fulana de Tal" }),
    });
    expect(parseOrganizerProfile({ ...profile, fullName: "F" }).ok).toBe(false);
    expect(parseOrganizerProfile({ ...profile, pixHolderName: "x".repeat(121) }).ok).toBe(false);
    expect(parseOrganizerProfile(undefined).ok).toBe(false);
  });
  it("senha: mínimo 12, máximo 72", () => {
    expect(parsePassword("curta").ok).toBe(false);
    expect(parsePassword("uma frase longa ok").ok).toBe(true);
    expect(parsePassword("x".repeat(73)).ok).toBe(false);
    expect(parsePassword(12345678901234).ok).toBe(false);
  });
  it("senha: os 72 contam em bytes (acento ocupa 2)", () => {
    expect(parsePassword("é".repeat(36)).ok).toBe(true);
    expect(parsePassword("é".repeat(37))).toEqual({ ok: false, error: "A senha pode ter no máximo 72 caracteres." });
    expect(parsePassword("a".repeat(72)).ok).toBe(true);
  });
  it("motivo: 5 a 500", () => {
    expect(parseReason("ok").ok).toBe(false);
    expect(parseReason("  motivo certo  ")).toEqual({ ok: true, value: "motivo certo" });
    expect(parseReason("x".repeat(501)).ok).toBe(false);
    expect(parseReason(null).ok).toBe(false);
  });
  it("o que mudar: o assunto já preenchido não conta como conteúdo", () => {
    const error = { ok: false, error: "Descreva a mudança (de 5 a 500 caracteres)." };
    expect(parseChangeWhat("Local: ", "Local")).toEqual(error);
    expect(parseChangeWhat("Local: abcd", "Local")).toEqual(error);
    expect(parseChangeWhat("  Local: Salão 2 ", "Local")).toEqual({ ok: true, value: "Local: Salão 2" });
    expect(parseChangeWhat("Mudar o local", "Local")).toEqual({ ok: true, value: "Mudar o local" });
    expect(parseChangeWhat("Mudar o local", undefined)).toEqual({ ok: true, value: "Mudar o local" });
    expect(parseChangeWhat("Local:", undefined)).toEqual({ ok: true, value: "Local:" });
    expect(parseChangeWhat(`Local: ${"x".repeat(494)}`, "Local")).toEqual(error);
    expect(parseChangeWhat(null, "Local")).toEqual(error);
  });
  it("e-mail: apara, minúsculas e o mesmo formato que o banco aceita", () => {
    expect(parseEmail("  Fulana@Exemplo.COM ")).toEqual({ ok: true, value: "fulana@exemplo.com" });
    expect(parseEmail("sem-arroba").ok).toBe(false);
    expect(parseEmail("a@b.c").ok).toBe(false);
    expect(parseEmail("a b@exemplo.com").ok).toBe(false);
    expect(parseEmail(`${"a".repeat(65)}@exemplo.com`).ok).toBe(false);
    expect(parseEmail(`a@${"b".repeat(250)}.com`).ok).toBe(false);
    expect(parseEmail(undefined).ok).toBe(false);
  });
});
