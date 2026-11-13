import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: vi.fn(),
  }),
}));

import {
  buildUnlockCookieValue,
  hashUnlockCode,
  normalizeUnlockCode,
  parseUnlockCookieValue,
  unlockedTypeIds,
} from "@/lib/tickets/unlock-code";

describe("unlock-code", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normaliza e hasheia o código", () => {
    expect(normalizeUnlockCode("  abcdef  ")).toBe("abcdef");
    expect(normalizeUnlockCode("ab")).toBeNull();
    expect(hashUnlockCode("bolsista2026")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cookie assinado só vale com o segredo e dentro do prazo", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-de-teste-bem-longa");
    const eventId = "00000000-0000-4000-8000-0000000000aa";
    const codeHash = hashUnlockCode("bolsista2026");
    const value = buildUnlockCookieValue(eventId, codeHash, 1_700_000_000_000);
    expect(value).toBeTruthy();
    expect(parseUnlockCookieValue(value!, 1_700_000_000_000)).toEqual({
      eventId,
      codeHash,
      exp: expect.any(Number),
    });
    expect(parseUnlockCookieValue(value!, 1_700_000_000_000 + 3 * 60 * 60 * 1000)).toBeNull();
    expect(parseUnlockCookieValue(`${value}x`, 1_700_000_000_000)).toBeNull();
  });

  it("lista só os tipos com o mesmo hash", () => {
    const hash = hashUnlockCode("segredo");
    const ids = unlockedTypeIds(
      [
        { id: "a", unlock_code_hash: hash },
        { id: "b", unlock_code_hash: null },
        { id: "c", unlock_code_hash: hashUnlockCode("outro") },
      ],
      hash,
    );
    expect([...ids]).toEqual(["a"]);
  });
});
