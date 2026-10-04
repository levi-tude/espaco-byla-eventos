import { describe, expect, it } from "vitest";

import { nextQuotaReset, parseDailyQuota } from "@/lib/notices/rules";

describe("nextQuotaReset", () => {
  it("é a próxima meia-noite UTC (21h em Brasília)", () => {
    expect(nextQuotaReset(Date.parse("2026-10-04T15:30:00.000Z"))).toBe("2026-10-05T00:00:00.000Z");
    expect(nextQuotaReset(Date.parse("2026-10-04T23:59:59.000Z"))).toBe("2026-10-05T00:00:00.000Z");
  });

  it("logo depois da renovação, aponta para a do dia seguinte", () => {
    expect(nextQuotaReset(Date.parse("2026-10-05T00:00:01.000Z"))).toBe("2026-10-06T00:00:00.000Z");
  });

  it("vira o mês e o ano", () => {
    expect(nextQuotaReset(Date.parse("2026-12-31T22:00:00.000Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("parseDailyQuota", () => {
  it("lê o número do cabeçalho", () => {
    expect(parseDailyQuota("42")).toBe(42);
    expect(parseDailyQuota(" 80 ")).toBe(80);
  });

  it("ignora ausente ou inválido", () => {
    expect(parseDailyQuota(null)).toBeNull();
    expect(parseDailyQuota("")).toBeNull();
    expect(parseDailyQuota("abc")).toBeNull();
    expect(parseDailyQuota("-1")).toBeNull();
    expect(parseDailyQuota("1e3")).toBeNull();
  });
});
