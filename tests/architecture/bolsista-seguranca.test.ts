import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("código de acesso e leituras grandes", () => {
  it("o código e o cookie não usam a chave do service_role nem SHA-256 puro novo", () => {
    for (const path of ["src/lib/tickets/unlock-code.ts", "src/lib/tickets/unlock-code-crypto.ts"]) {
      expect(read(path)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
    expect(read("src/lib/events/event-input.ts")).not.toMatch(/createHash\(/);
  });

  it("contagens de ingressos vendidos são paginadas (sem corte em 1000)", () => {
    expect(read("src/app/organizador/page.tsx")).toContain("fetchAllPages");
    expect(read("src/app/organizador/eventos/[id]/page.tsx")).toContain("fetchAllPages");
    expect(read("src/app/equipe/eventos/[id]/page.tsx")).toContain("fetchAllPages");
  });
});
