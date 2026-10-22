import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { organizerNeedsTermsAcceptance } from "@/lib/organizer/terms-gate";
import { ORGANIZER_TERMS_VERSION } from "@/lib/legal/organizer-terms";
import type { createAdminClient } from "@/lib/supabase/admin";

function fakeAdmin(result: { data: unknown; error: { code?: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain } as unknown as ReturnType<typeof createAdminClient>;
}

describe("organizerNeedsTermsAcceptance", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("false quando a versão no banco é a vigente", async () => {
    await expect(
      organizerNeedsTermsAcceptance(
        fakeAdmin({ data: { terms_version: ORGANIZER_TERMS_VERSION }, error: null }),
        "user-1",
      ),
    ).resolves.toBe(false);
  });

  it("true quando a versão é antiga ou não há perfil", async () => {
    await expect(
      organizerNeedsTermsAcceptance(
        fakeAdmin({ data: { terms_version: "2026-01-01" }, error: null }),
        "user-1",
      ),
    ).resolves.toBe(true);
    await expect(
      organizerNeedsTermsAcceptance(fakeAdmin({ data: null, error: null }), "user-1"),
    ).resolves.toBe(true);
  });

  it("erro do banco não mantém o aviso (evita falso positivo depois do aceite)", async () => {
    await expect(
      organizerNeedsTermsAcceptance(
        fakeAdmin({ data: null, error: { code: "57014" } }),
        "user-1",
      ),
    ).resolves.toBe(false);
  });
});
