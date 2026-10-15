import { describe, expect, it } from "vitest";

import { checkPassword, PASSWORD_MESSAGES } from "@/lib/security/password-policy";

const bytes = (value: string) => new TextEncoder().encode(value).length;

describe("checkPassword", () => {
  it.each([
    "Festa no quintal 47",
    "Maracuja-azul-2026",
    "carnaval na ribeira 9x",
    "Pão de açúcar 1984 céu",
    "TrovaoRoxo#4821",
  ])("aceita senha comum de gente: %s", (password) => {
    expect(checkPassword(password)).toEqual({ ok: true, value: password });
  });

  it("tamanho: mínimo 12 caracteres, máximo 72 bytes (acento conta 2)", () => {
    expect(checkPassword("Curta12")).toEqual({ ok: false, error: PASSWORD_MESSAGES.tooShort });
    expect(checkPassword(12345678901234)).toEqual({ ok: false, error: PASSWORD_MESSAGES.tooShort });
    expect(checkPassword(undefined)).toEqual({ ok: false, error: PASSWORD_MESSAGES.tooShort });
    expect(checkPassword("é".repeat(37))).toEqual({ ok: false, error: PASSWORD_MESSAGES.tooLong });

    const accented = "Mãe Joana comeu açaí às 7h na Ribeira com pão";
    const atLimit = accented + " quintal festeiro do bairro".slice(0, 72 - bytes(accented));
    expect(bytes(atLimit)).toBe(72);
    expect(checkPassword(atLimit).ok).toBe(true);
    expect(checkPassword(`${atLimit}y`)).toEqual({ ok: false, error: PASSWORD_MESSAGES.tooLong });
  });

  it.each(["123456789123", "98765432109876", "festanoquintal", "Festa no Quintal!", "çãõéíóúâêôàü"])(
    "pede letras e números: %s",
    (password) => {
      expect(checkPassword(password)).toEqual({ ok: false, error: PASSWORD_MESSAGES.lettersAndNumbers });
    },
  );

  it.each(["aaaaFesta2026", "Festa20261111", "abc1abc1abc1", "festa1festa1", "ab12ab12ab12ab"])(
    "recusa senha repetitiva: %s",
    (password) => {
      expect(checkPassword(password)).toEqual({ ok: false, error: PASSWORD_MESSAGES.repetitive });
    },
  );

  it.each(["Festa123456x", "Maria54321rosa", "abcdeFesta2026", "QWERTYcasa2026", "asdfgFesta2026", "Festa67890x!"])(
    "recusa sequência fácil: %s",
    (password) => {
      expect(checkPassword(password)).toEqual({ ok: false, error: PASSWORD_MESSAGES.sequence });
    },
  );

  it.each([
    "Senha@2026!!",
    "senha20262026!",
    "espacobyla2026",
    "Espaço Byla 2026",
    "byla20262027",
    "Ingressos2026!",
    "bylaingressos26",
    "P4ssw0rd2026!",
    "s3nh4f0rt3!!2026",
    "Flamengo1981!",
    "Admin2026Admin!",
  ])("recusa senha muito comum: %s", (password) => {
    expect(checkPassword(password)).toEqual({ ok: false, error: PASSWORD_MESSAGES.common });
  });

  it("palavra comum dentro de frase maior vale", () => {
    expect(checkPassword("minha festa no byla 2026").ok).toBe(true);
    expect(checkPassword("passaporte azul 2026").ok).toBe(true);
  });

  it("recusa nome ou e-mail da pessoa, sem diferença de maiúscula ou acento", () => {
    const personal = { email: "fulana.silva90@exemplo.com", names: ["Fulana de Tal", "Coletivo Exemplo"] };
    expect(checkPassword("Silva#Festa2026", personal)).toEqual({ ok: false, error: PASSWORD_MESSAGES.personal });
    expect(checkPassword("FULANA quer 2026", personal)).toEqual({ ok: false, error: PASSWORD_MESSAGES.personal });
    expect(checkPassword("meu coletivo 2026!", personal)).toEqual({ ok: false, error: PASSWORD_MESSAGES.personal });
    expect(checkPassword("Joao e Colétivo 7x", personal)).toEqual({ ok: false, error: PASSWORD_MESSAGES.personal });
    expect(checkPassword("Silv4 do samba 2026", { email: "silva@exemplo.com" })).toEqual({
      ok: false,
      error: PASSWORD_MESSAGES.personal,
    });
    expect(checkPassword("Maracuja-azul-2026", personal).ok).toBe(true);
  });

  it("partes curtas do nome (menos de 4 letras) não bloqueiam", () => {
    expect(checkPassword("Festa de Ana 2026", { names: ["Ana Lu"], email: "ana@exemplo.com" }).ok).toBe(true);
  });

  it("dados pessoais vazios ou estranhos não quebram a regra", () => {
    expect(checkPassword("Maracuja-azul-2026", { email: null, names: [null, undefined, ""] }).ok).toBe(true);
    expect(checkPassword("Maracuja-azul-2026", { email: "sem-arroba" }).ok).toBe(true);
  });
});
