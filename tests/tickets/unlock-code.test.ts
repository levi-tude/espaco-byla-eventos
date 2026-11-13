import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  unlockCodeHashCandidates,
  unlockedTypeIds,
} from "@/lib/tickets/unlock-code";
import { legacyUnlockCodeHash } from "@/lib/tickets/unlock-code-crypto";

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

describe("unlock-code", () => {
  beforeEach(() => {
    vi.stubEnv("UNLOCK_CODE_SECRET", SECRET);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-do-service-role-bem-longa");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normaliza e gera HMAC com segredo (não é o SHA-256 puro)", () => {
    expect(normalizeUnlockCode("  abcdef  ")).toBe("abcdef");
    expect(normalizeUnlockCode("ab")).toBeNull();
    const hash = hashUnlockCode("bolsista2026");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(sha256("bolsista2026"));
    vi.stubEnv("UNLOCK_CODE_SECRET", `${SECRET}-outro`);
    expect(hashUnlockCode("bolsista2026")).not.toBe(hash);
  });

  it("sem segredo (ou curto demais) não gera hash nem cookie — falha fechada", () => {
    vi.stubEnv("UNLOCK_CODE_SECRET", "curto");
    expect(hashUnlockCode("bolsista2026")).toBeNull();
    expect(
      buildUnlockCookieValue("00000000-0000-4000-8000-0000000000aa", sha256("x")),
    ).toBeNull();
    // Só o formato antigo continua reconhecível.
    expect(unlockCodeHashCandidates("bolsista2026")).toEqual([sha256("bolsista2026")]);
  });

  it("aceita o hash novo e o antigo (SHA-256) até o código ser salvo de novo", () => {
    const candidates = unlockCodeHashCandidates("bolsista2026");
    expect(candidates).toEqual([hashUnlockCode("bolsista2026"), legacyUnlockCodeHash("bolsista2026")]);
    expect(legacyUnlockCodeHash("bolsista2026")).toBe(sha256("bolsista2026"));
  });

  it("cookie assinado só vale com o segredo próprio e dentro do prazo", () => {
    const eventId = "00000000-0000-4000-8000-0000000000aa";
    const codeHash = hashUnlockCode("bolsista2026")!;
    const value = buildUnlockCookieValue(eventId, codeHash, 1_700_000_000_000);
    expect(value).toBeTruthy();
    expect(parseUnlockCookieValue(value!, 1_700_000_000_000)).toEqual({
      eventId,
      codeHash,
      exp: expect.any(Number),
    });
    expect(parseUnlockCookieValue(value!, 1_700_000_000_000 + 3 * 60 * 60 * 1000)).toBeNull();
    expect(parseUnlockCookieValue(`${value}x`, 1_700_000_000_000)).toBeNull();
    // Trocar a chave do service_role não afeta; trocar o segredo invalida.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "outra-chave-do-service-role-longa");
    expect(parseUnlockCookieValue(value!, 1_700_000_000_000)).not.toBeNull();
    vi.stubEnv("UNLOCK_CODE_SECRET", `${SECRET}-rotacionado`);
    expect(parseUnlockCookieValue(value!, 1_700_000_000_000)).toBeNull();
  });

  it("lista só os tipos com o mesmo hash", () => {
    const hash = hashUnlockCode("segredo")!;
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
