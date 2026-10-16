import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("cabeçalhos de segurança do next.config", () => {
  it("força HTTPS por 1 ano, inclusive nos subdomínios (HSTS)", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((rule) => rule.source === "/:path*");
    const hsts = all?.headers.find((header) => header.key === "Strict-Transport-Security");
    expect(hsts?.value).toBe("max-age=31536000; includeSubDomains");
  });
});
