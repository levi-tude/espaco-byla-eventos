import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

type Settings = typeof import("@/lib/organizer/settings");
let organizerAreaEnabled: Settings["organizerAreaEnabled"];

let signal: AbortSignal | null = null;

function answer(result: Promise<{ data: unknown; error: unknown }>) {
  mocks.rpc.mockImplementation(() => ({
    abortSignal: (given: AbortSignal) => {
      signal = given;
      return result;
    },
  }));
}

const never = () => new Promise<{ data: unknown; error: unknown }>(() => {});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  signal = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://banco.exemplo.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-publica-teste");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // A última resposta fica guardada no módulo: cada teste começa sem nenhuma.
  vi.resetModules();
  ({ organizerAreaEnabled } = await import("@/lib/organizer/settings"));
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

  it("banco lento sem resposta anterior: desligada depois de 2,5 s e a consulta é cancelada", async () => {
    answer(never());
    const pending = organizerAreaEnabled();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[organizador]"));
  });

  it("resposta dentro do prazo vale normalmente", async () => {
    answer(new Promise((resolve) => setTimeout(() => resolve({ data: true, error: null }), 2_000)));
    const pending = organizerAreaEnabled();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe(true);
    expect(signal?.aborted).toBe(false);
  });

  it("sem configuração do banco: desligada sem consultar", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(organizerAreaEnabled()).resolves.toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reaproveita a resposta por 30 s e depois pergunta de novo", async () => {
    answer(Promise.resolve({ data: true, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(29_000);
    await expect(organizerAreaEnabled()).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    answer(Promise.resolve({ data: false, error: null }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(organizerAreaEnabled()).resolves.toBe(false);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("pedidos ao mesmo tempo dividem uma consulta só", async () => {
    let resolve: (value: { data: unknown; error: unknown }) => void = () => {};
    answer(new Promise((r) => (resolve = r)));
    const both = Promise.all([organizerAreaEnabled(), organizerAreaEnabled()]);
    resolve({ data: true, error: null });
    await expect(both).resolves.toEqual([true, true]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("banco lento logo depois de uma resposta recente: mantém a última resposta", async () => {
    answer(Promise.resolve({ data: true, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    answer(never());
    const pending = organizerAreaEnabled();
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[organizador]"));
  });

  it("erro do banco logo depois de uma resposta recente também mantém a última", async () => {
    answer(Promise.resolve({ data: false, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    answer(Promise.resolve({ data: null, error: { message: "falha" } }));
    await expect(organizerAreaEnabled()).resolves.toBe(false);
  });

  it("última resposta com mais de 10 min não vale: banco lento = desligada", async () => {
    answer(Promise.resolve({ data: true, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    answer(never());
    const pending = organizerAreaEnabled();
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toBe(false);
  });

  it("depois de uma falha, a próxima resposta do banco volta a valer", async () => {
    answer(Promise.resolve({ data: true, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    answer(Promise.resolve({ data: null, error: { message: "falha" } }));
    await expect(organizerAreaEnabled()).resolves.toBe(true);

    answer(Promise.resolve({ data: false, error: null }));
    await expect(organizerAreaEnabled()).resolves.toBe(false);
  });
});
