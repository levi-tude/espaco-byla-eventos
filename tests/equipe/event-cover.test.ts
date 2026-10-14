import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  previousCover: { value: null as string | null },
  otherCoverUsers: { value: { data: [] as unknown, error: null as unknown } },
  coverQueries: [] as [string, unknown[]][][],
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: mocks.rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-0000000000ff" } }, error: null }),
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        like: () => chain,
        maybeSingle: async () => ({ data: { slug: "show" }, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: () => {
      const calls: [string, unknown[]][] = [];
      mocks.coverQueries.push(calls);
      const record =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push([method, args]);
          return chain;
        };
      const chain = {
        select: record("select"),
        eq: record("eq"),
        neq: record("neq"),
        like: record("like"),
        limit: record("limit"),
        maybeSingle: async () => ({
          data: { cover_image_url: mocks.previousCover.value },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(mocks.otherCoverUsers.value).then(resolve, reject),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/media/storage", () => ({
  mediaObjectExists: mocks.mediaObjectExists,
  removeMediaObjects: mocks.removeMediaObjects,
}));

import { createEvent, updateEvent } from "@/app/equipe/eventos/actions";
import { COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";

const eventId = "00000000-0000-4000-8000-000000000001";
const base = "https://proj.supabase.co/storage/v1/object/public/event-media";
const ownCover = `${base}/covers/11111111-1111-4111-8111-111111111111.webp`;
const newOwnCover = `${base}/covers/22222222-2222-4222-8222-222222222222.webp`;
const input = {
  name: "Show",
  venue: "Espaço Byla",
  description: "",
  ticketTypes: [{ preset: "inteira" as const, priceCents: 5000, maxUnits: null }],
  sessions: [
    {
      id: null,
      name: "",
      startsAt: "2026-12-01T20:00",
      endsAt: "",
      capacity: 100,
      inteiraQuota: null,
      meiaQuota: null,
      prices: [{ typeIndex: 0, priceCents: 5000, maxUnits: null, onSale: true }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.adminRpc.mockResolvedValue({ error: null });
  mocks.mediaObjectExists.mockResolvedValue(true);
  mocks.previousCover.value = null;
  mocks.otherCoverUsers.value = { data: [], error: null };
  mocks.coverQueries = [];
});

describe("capa do evento", () => {
  it.each(["javascript:alert(1)", "http://imagens.example/capa.jpg"])(
    "recusa link que não é https (%s)",
    async (coverImageUrl) => {
      expect(await createEvent({ ...input, coverImageUrl })).toEqual({
        ok: false,
        error: "Informe uma URL válida para a capa.",
      });
    },
  );

  it("recusa capa do nosso armazenamento que não existe", async () => {
    mocks.mediaObjectExists.mockResolvedValue(false);
    expect(await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover })).toEqual({
      ok: false,
      error: COVER_NOT_FOUND_MESSAGE,
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("recusa foto da galeria usada como capa", async () => {
    const galleryUrl = `${base}/events/${eventId}/11111111-1111-4111-8111-111111111111.webp`;
    expect(await updateEvent(eventId, { ...input, coverImageUrl: galleryUrl })).toEqual({
      ok: false,
      error: COVER_NOT_FOUND_MESSAGE,
    });
  });

  it("trocar capa enviada apaga o arquivo antigo", async () => {
    mocks.previousCover.value = ownCover;
    expect(await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([
      "covers/11111111-1111-4111-8111-111111111111.webp",
    ]);
    const usage = mocks.coverQueries.find((calls) => calls.some(([method]) => method === "like"));
    expect(usage).toContainEqual([
      "like",
      ["cover_image_url", "%covers/11111111-1111-4111-8111-111111111111.webp%"],
    ]);
    expect(usage).toContainEqual(["neq", ["id", eventId]]);
  });

  it("capa antiga ainda usada por outro evento não é apagada", async () => {
    mocks.previousCover.value = ownCover;
    mocks.otherCoverUsers.value = { data: [{ id: "00000000-0000-4000-8000-000000000002" }], error: null };
    expect(await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("falha ao conferir a capa antiga: mantém o arquivo", async () => {
    mocks.previousCover.value = ownCover;
    mocks.otherCoverUsers.value = { data: null, error: { message: "falhou" } };
    expect(await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("remover capa enviada apaga o arquivo", async () => {
    mocks.previousCover.value = ownCover;
    await updateEvent(eventId, { ...input, coverImageUrl: "" });
    expect(mocks.removeMediaObjects).toHaveBeenCalledTimes(1);
  });

  it("manter a mesma capa não apaga nada", async () => {
    mocks.previousCover.value = ownCover;
    await updateEvent(eventId, { ...input, coverImageUrl: ownCover });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("capa antiga por link externo nunca é apagada", async () => {
    mocks.previousCover.value = "https://exemplo.com/capa.jpg";
    await updateEvent(eventId, { ...input, coverImageUrl: newOwnCover });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});
