import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

function directives(csp: string) {
  return new Map(
    csp.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values] as const;
    }),
  );
}

describe("Content-Security-Policy", () => {
  const production = directives(
    buildContentSecurityPolicy({
      nonce: "abc123",
      isDev: false,
      upgradeInsecureRequests: true,
      supabaseUrl: "https://exemplo.supabase.co",
    }),
  );

  it("só executa scripts com o nonce da requisição", () => {
    const scripts = production.get("script-src");
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("bloqueia o site dentro de iframes e plugins", () => {
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
    expect(production.has("upgrade-insecure-requests")).toBe(true);
  });

  it("libera Mercado Pago e Supabase onde o pagamento e o login precisam", () => {
    expect(production.get("connect-src")).toContain("https://exemplo.supabase.co");
    expect(production.get("connect-src")).toContain("https://*.mercadopago.com");
    expect(production.get("frame-src")).toContain("https://*.mercadopago.com");
  });

  it("em desenvolvimento permite eval e websocket do Next, sem forçar https", () => {
    const dev = directives(
      buildContentSecurityPolicy({
        nonce: "n",
        isDev: true,
        upgradeInsecureRequests: false,
      }),
    );
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });

  it("gera um nonce diferente a cada requisição", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
