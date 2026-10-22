import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { organizerNeedsTermsAcceptance } from "@/lib/organizer/terms-gate";
import { ORGANIZER_TERMS_VERSION } from "@/lib/legal/organizer-terms";
import type { createAdminClient } from "@/lib/supabase/admin";

function fakeAdmin(result: { data: unknown; error: { code?: string } | null }, delayMs = 0) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    abortSignal: (signal: AbortSignal) => ({
      maybeSingle: () =>
        new Promise((resolve, reject) => {
          const fail = () =>
            reject(Object.assign(new Error("Aborted"), { name: "AbortError", code: "abort" }));
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener("abort", fail, { once: true });
          if (delayMs <= 0) {
            signal.removeEventListener("abort", fail);
            resolve(result);
            return;
          }
          setTimeout(() => {
            signal.removeEventListener("abort", fail);
            if (!signal.aborted) resolve(result);
          }, delayMs);
        }),
    }),
    maybeSingle: async () => result,
  };
  return { from: () => chain } as unknown as ReturnType<typeof createAdminClient>;
}

describe("organizerNeedsTermsAcceptance", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aceito quando a versão no banco é a vigente", async () => {
    await expect(
      organizerNeedsTermsAcceptance(
        fakeAdmin({ data: { terms_version: ORGANIZER_TERMS_VERSION }, error: null }),
        "user-1",
      ),
    ).resolves.toBe("aceito");
  });

  it("pendente quando a versão é antiga ou não há perfil", async () => {
    await expect(
      organizerNeedsTermsAcceptance(
        fakeAdmin({ data: { terms_version: "2026-01-01" }, error: null }),
        "user-1",
      ),
    ).resolves.toBe("pendente");
    await expect(
      organizerNeedsTermsAcceptance(fakeAdmin({ data: null, error: null }), "user-1"),
    ).resolves.toBe("pendente");
  });

  it("desconhecido em erro do banco (não força o aviso)", async () => {
    await expect(
      organizerNeedsTermsAcceptance(
        fakeAdmin({ data: null, error: { code: "57014" } }),
        "user-1",
      ),
    ).resolves.toBe("desconhecido");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[organizador]"),
      expect.objectContaining({ code: "57014" }),
    );
  });

  it("desconhecido quando a leitura passa de ~3 s", async () => {
    vi.useFakeTimers();
    const pending = organizerNeedsTermsAcceptance(
      fakeAdmin({ data: { terms_version: ORGANIZER_TERMS_VERSION }, error: null }, 10_000),
      "user-1",
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toBe("desconhecido");
  });
});
