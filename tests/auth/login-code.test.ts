import { describe, expect, it } from "vitest";

import {
  deviceLabel,
  generateLoginCode,
  maskEmail,
  newDeviceToken,
  normalizeLoginCode,
  secondsUntil,
} from "@/lib/auth/login-code";

describe("generateLoginCode", () => {
  it("sempre 6 dígitos, inclusive com zeros à esquerda", () => {
    for (let i = 0; i < 200; i += 1) expect(generateLoginCode()).toMatch(/^\d{6}$/);
    expect(generateLoginCode(() => 42)).toBe("000042");
    expect(generateLoginCode(() => 999_999)).toBe("999999");
  });
});

describe("normalizeLoginCode", () => {
  it("aceita espaços, traços e pontos do que a pessoa colou", () => {
    expect(normalizeLoginCode(" 12 34-56 ")).toBe("123456");
    expect(normalizeLoginCode("123.456")).toBe("123456");
  });

  it("recusa o que não são exatamente 6 números", () => {
    for (const value of ["12345", "1234567", "12a456", "", "١٢٣٤٥٦", null, undefined, 123456]) {
      expect(normalizeLoginCode(value)).toBeNull();
    }
    expect(normalizeLoginCode("1".repeat(200))).toBeNull();
  });
});

describe("maskEmail", () => {
  it("mostra só o começo do nome e do domínio", () => {
    expect(maskEmail("levi@gmail.com")).toBe("le***@gm***.com");
    expect(maskEmail("Contato.Espaco@empresa.com.br")).toBe("co***@em***.br");
  });

  it("nomes e domínios curtos", () => {
    expect(maskEmail("a@b.co")).toBe("a***@b***.co");
    expect(maskEmail("ab@cd.io")).toBe("a***@c***.io");
  });

  it("formato inesperado vira texto genérico", () => {
    expect(maskEmail("sem-arroba")).toBe("seu e-mail");
    expect(maskEmail("x@semponto")).toBe("seu e-mail");
    expect(maskEmail(undefined)).toBe("seu e-mail");
  });
});

describe("deviceLabel", () => {
  const ua = {
    chromeAndroid:
      "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    safariIphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    edgeWindows:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
    samsung:
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    chromeIphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  };

  it("navegador e sistema em português", () => {
    expect(deviceLabel(ua.chromeAndroid)).toBe("Chrome no Android");
    expect(deviceLabel(ua.safariIphone)).toBe("Safari no iPhone");
    expect(deviceLabel(ua.edgeWindows)).toBe("Edge no Windows");
    expect(deviceLabel(ua.firefoxMac)).toBe("Firefox no Mac");
    expect(deviceLabel(ua.samsung)).toBe("Samsung Internet no Android");
    expect(deviceLabel(ua.chromeIphone)).toBe("Chrome no iPhone");
  });

  it("desconhecido ou vazio vira 'Navegador'", () => {
    expect(deviceLabel(null)).toBe("Navegador");
    expect(deviceLabel("")).toBe("Navegador");
    expect(deviceLabel("curl/8.0")).toBe("Navegador");
  });

  it("nunca passa de 60 caracteres", () => {
    expect(deviceLabel("x".repeat(5000)).length).toBeLessThanOrEqual(60);
  });
});

describe("newDeviceToken", () => {
  it("32 bytes aleatórios em base64url (43 caracteres)", () => {
    const a = newDeviceToken();
    const b = newDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("secondsUntil", () => {
  const now = new Date("2026-10-14T15:00:00.000Z");

  it("segundos que faltam, arredondando para cima, nunca negativo", () => {
    expect(secondsUntil("2026-10-14T15:00:42.300Z", now)).toBe(43);
    expect(secondsUntil("2026-10-14T14:59:00.000Z", now)).toBe(0);
    expect(secondsUntil(null, now)).toBe(0);
    expect(secondsUntil("lixo", now)).toBe(0);
  });
});
