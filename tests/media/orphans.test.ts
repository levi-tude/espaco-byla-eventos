import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listMediaObjects: vi.fn(), removeMediaObjects: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/storage", () => ({
  listMediaObjects: mocks.listMediaObjects,
  removeMediaObjects: mocks.removeMediaObjects,
}));

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { sweepOrphanCovers } from "@/lib/media/orphans";

const supabaseUrl = "https://proj.supabase.co";
const base = `${supabaseUrl}/storage/v1/object/public/event-media/`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cover = (n: number, ext = "webp") => `covers/${uuid(n)}.${ext}`;
const old = "2026-10-01T10:00:00Z";
const recent = "2026-10-15T11:00:00Z";

function adminWith(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    not: () => chain,
    range: async () => result,
  };
  return { from: vi.fn(() => chain) } as unknown as SupabaseAdmin;
}

describe("sweepOrphanCovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
    mocks.removeMediaObjects.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("apaga só capas antigas que nenhum evento usa (inclusive apagados) e ignora nomes estranhos", async () => {
    const admin = adminWith({
      data: [{ cover_image_url: `${base}${cover(1)}` }, { cover_image_url: "https://externo.example/capa.jpg" }],
      error: null,
    });
    mocks.listMediaObjects.mockResolvedValue([
      { path: cover(1), createdAt: old },
      { path: cover(2, "jpg"), createdAt: old },
      { path: cover(3), createdAt: recent },
      { path: "covers/nao-e-uuid.webp", createdAt: old },
      { path: cover(4, "gif"), createdAt: old },
      { path: cover(5), createdAt: null },
    ]);
    expect(await sweepOrphanCovers(admin)).toEqual({ checked: 4, deleted: 1 });
    expect(mocks.listMediaObjects).toHaveBeenCalledWith("covers", { limit: 500, offset: 0 });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([cover(2, "jpg")]);
  });

  it("capa salva com outro endereço do banco continua em uso", async () => {
    const admin = adminWith({
      data: [{ cover_image_url: `https://outro.example/storage/v1/object/public/event-media/${cover(1)}?v=2` }],
      error: null,
    });
    mocks.listMediaObjects.mockResolvedValue([
      { path: cover(1), createdAt: old },
      { path: cover(2), createdAt: old },
    ]);
    expect(await sweepOrphanCovers(admin)).toEqual({ checked: 2, deleted: 1 });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([cover(2)]);
  });

  it("capa com endereço que não dá para entender: não apaga nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = adminWith({ data: [{ cover_image_url: `${base}covers/estranho.webp` }], error: null });
    mocks.listMediaObjects.mockResolvedValue([{ path: cover(2), createdAt: old }]);
    expect(await sweepOrphanCovers(admin)).toEqual({ checked: 0, deleted: 0 });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("apaga no máximo o limite por rodada", async () => {
    const admin = adminWith({ data: [], error: null });
    mocks.listMediaObjects.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({ path: cover(i + 10), createdAt: old })),
    );
    expect((await sweepOrphanCovers(admin)).deleted).toBe(100);
    expect(mocks.removeMediaObjects.mock.calls[0][0]).toHaveLength(100);
  });

  it.each([
    ["erro na leitura", { data: null, error: { code: "57014" } }],
    ["leitura possivelmente cortada", { data: Array.from({ length: 1000 }, () => ({ cover_image_url: null })), error: null }],
  ])("%s dos eventos: não apaga nada", async (_caso, result) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sweepOrphanCovers(adminWith(result))).toEqual({ checked: 0, deleted: 0 });
    expect(mocks.listMediaObjects).not.toHaveBeenCalled();
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("falha ao listar o bucket nunca lança", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listMediaObjects.mockRejectedValue(new Error("fora"));
    await expect(sweepOrphanCovers(adminWith({ data: [], error: null }))).resolves.toEqual({
      checked: 0,
      deleted: 0,
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});
