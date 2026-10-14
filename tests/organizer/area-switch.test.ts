import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

import { organizerAreaEnabled } from "@/lib/organizer/settings";

let signal: AbortSignal | null = null;

function answer(result: Promise<{ data: unknown; error: unknown }>) {
  mocks.rpc.mockImplementation(() => ({
    abortSignal: (given: AbortSignal) => {
      signal = given;
      return result;
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  signal = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://banco.exemplo.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-publica-teste");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("organizerAreaEnabled", () => {
  it("ligada quando o banco responde true", async () => {
    answer(Promise.resolve({ data: true, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("organizer_area_enabled");
  });

  it("erro do banco conta como desligada", async () => {
    answer(Promise.resolve({ data: null, error: { message: "falha" } }));
    await expect(organizerAreaEnabled()).resolves.toBe(false);
  });

  it("banco lento: desligada depois de 1,5 s e a consulta é cancelada", async () => {
    answer(new Promise(() => {}));
    const pending = organizerAreaEnabled();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[organizador]"));
  });

  it("resposta dentro do prazo vale normalmente", async () => {
    answer(new Promise((resolve) => setTimeout(() => resolve({ data: true, error: null }), 1_400)));
    const pending = organizerAreaEnabled();
    await vi.advanceTimersByTimeAsync(1_400);
    await expect(pending).resolves.toBe(true);
    expect(signal?.aborted).toBe(false);
  });

  it("sem configuração do banco: desligada sem consultar", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(organizerAreaEnabled()).resolves.toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
