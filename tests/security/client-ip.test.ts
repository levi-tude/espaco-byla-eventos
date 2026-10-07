import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));

import { clientIp, resolveClientIp } from "@/lib/security/rate-limit";

function req(values: Record<string, string>) {
  return new Headers(values);
}

describe("resolveClientIp", () => {
  const all = req({
    "x-real-ip": "203.0.113.1",
    "x-nf-client-connection-ip": "203.0.113.2",
    "cf-connecting-ip": "203.0.113.3",
    "x-forwarded-for": "198.51.100.9, 203.0.113.4, 10.0.0.1",
  });

  it.each([
    ["x-real-ip", "203.0.113.1"],
    ["x-nf-client-connection-ip", "203.0.113.2"],
    ["cf-connecting-ip", "203.0.113.3"],
    ["x-forwarded-for-first", "198.51.100.9"],
    ["x-forwarded-for-last", "10.0.0.1"],
  ])("modo %s lê só o cabeçalho configurado", (mode, ip) => {
    expect(resolveClientIp(all, mode)).toBe(ip);
  });

  it("sem configuração usa x-real-ip e não cai para x-forwarded-for (falsificável)", () => {
    expect(resolveClientIp(all, undefined)).toBe("203.0.113.1");
    expect(resolveClientIp(req({ "x-forwarded-for": "198.51.100.9" }), undefined)).toBe(
      "desconhecido",
    );
  });

  it("valor desconhecido na configuração volta ao padrão", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveClientIp(all, "X-Forwarded-For")).toBe("203.0.113.1");
  });

  it("aceita maiúsculas e espaços na configuração", () => {
    expect(resolveClientIp(all, " CF-Connecting-IP ")).toBe("203.0.113.3");
  });

  it("cabeçalho ausente ou lixo vira 'desconhecido'", () => {
    expect(resolveClientIp(req({}), "cf-connecting-ip")).toBe("desconhecido");
    expect(resolveClientIp(req({ "x-real-ip": "<script>" }), "x-real-ip")).toBe("desconhecido");
    expect(resolveClientIp(req({ "x-real-ip": "1".repeat(80) }), "x-real-ip")).toBe(
      "desconhecido",
    );
  });

  it("aceita IPv6", () => {
    expect(resolveClientIp(req({ "x-real-ip": "2001:db8::1" }), "x-real-ip")).toBe("2001:db8::1");
  });
});

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("usa TRUSTED_IP_HEADER", async () => {
    mocks.headers = req({ "x-real-ip": "203.0.113.1", "cf-connecting-ip": "203.0.113.3" });
    vi.stubEnv("TRUSTED_IP_HEADER", "cf-connecting-ip");
    await expect(clientIp()).resolves.toBe("203.0.113.3");
  });
});
