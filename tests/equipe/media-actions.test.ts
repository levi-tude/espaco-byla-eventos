import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createAdminClient: vi.fn(),
  createUploadToken: vi.fn(),
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/media/storage", () => ({
  createUploadToken: mocks.createUploadToken,
  mediaObjectExists: mocks.mediaObjectExists,
  removeMediaObjects: mocks.removeMediaObjects,
}));

import {
  addEventImage,
  removeEventImage,
  requestImageUpload,
} from "@/app/equipe/eventos/media-actions";
import {
  GALLERY_FULL_MESSAGE,
  INVALID_IMAGE_TYPE_MESSAGE,
} from "@/lib/media/rules";

const eventId = "00000000-0000-4000-8000-000000000001";
const otherEventId = "00000000-0000-4000-8000-000000000002";
const imageId = "00000000-0000-4000-8000-000000000003";
const galleryPath = `events/${eventId}/11111111-1111-4111-8111-111111111111.webp`;

type Result = { data?: unknown; count?: number | null; error?: unknown };

function table(result: Result) {
  const settled = {
    data: result.data ?? null,
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => settled),
    single: vi.fn(async () => settled),
    then: (resolve: (value: typeof settled) => unknown) => resolve(settled),
  };
  return chain;
}

function useTables(tables: Record<string, ReturnType<typeof table>>) {
  mocks.createAdminClient.mockReturnValue({ from: (name: string) => tables[name] });
  return tables;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.createUploadToken.mockResolvedValue("token-de-envio");
  mocks.mediaObjectExists.mockResolvedValue(true);
});

describe("ações de fotos sem login de equipe", () => {
  const actions = {
    requestImageUpload: () => requestImageUpload("gallery", "image/webp", eventId),
    addEventImage: () => addEventImage(eventId, galleryPath),
    removeEventImage: () => removeEventImage(eventId, imageId),
  };

  it.each(Object.entries(actions))("%s é recusada antes de tocar no banco", async (_n, action) => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await action()).toEqual({ ok: false, error: "Acesso restrito à equipe." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});

describe("requestImageUpload", () => {
  it("recusa tipo de arquivo não permitido", async () => {
    expect(await requestImageUpload("cover", "image/gif")).toEqual({
      ok: false,
      error: INVALID_IMAGE_TYPE_MESSAGE,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("capa recebe caminho aleatório em covers/", async () => {
    const result = await requestImageUpload("cover", "image/webp");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toMatch(/^covers\/[0-9a-f-]{36}\.webp$/);
    expect(result.data.token).toBe("token-de-envio");
  });

  it("galeria recusa evento inválido", async () => {
    expect(await requestImageUpload("gallery", "image/webp", "../x")).toEqual({
      ok: false,
      error: "Evento inválido.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("galeria cheia não recebe autorização de envio", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 10 }),
    });
    expect(await requestImageUpload("gallery", "image/jpeg", eventId)).toEqual({
      ok: false,
      error: GALLERY_FULL_MESSAGE,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("galeria com espaço recebe caminho dentro da pasta do evento", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 3 }),
    });
    const result = await requestImageUpload("gallery", "image/jpeg", eventId);
    expect(result.ok && result.data.path.startsWith(`events/${eventId}/`)).toBe(true);
    expect(result.ok && result.data.path.endsWith(".jpg")).toBe(true);
  });
});

describe("addEventImage", () => {
  it("recusa foto de outro evento sem tocar no banco", async () => {
    expect(await addEventImage(otherEventId, galleryPath)).toEqual({
      ok: false,
      error: "Foto inválida.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("recusa quando o arquivo não chegou ao armazenamento", async () => {
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { id: imageId } }),
    });
    mocks.mediaObjectExists.mockResolvedValue(false);
    const result = await addEventImage(eventId, galleryPath);
    expect(result.ok).toBe(false);
    expect(tables.event_images.insert).not.toHaveBeenCalled();
  });

  it("11ª foto: banco recusa, arquivo é apagado", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({
        error: { code: "23514", message: "Limite de 10 fotos por evento atingido." },
      }),
    });
    expect(await addEventImage(eventId, galleryPath)).toEqual({
      ok: false,
      error: GALLERY_FULL_MESSAGE,
    });
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([galleryPath]);
  });

  it("foto repetida não apaga o arquivo que já está em uso", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ error: { code: "23505", message: "duplicate key" } }),
    });
    const result = await addEventImage(eventId, galleryPath);
    expect(result).toEqual({ ok: false, error: "Esta foto já foi adicionada." });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });

  it("registra a foto e devolve a URL pública", async () => {
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { id: imageId } }),
    });
    expect(await addEventImage(eventId, galleryPath)).toEqual({
      ok: true,
      data: {
        id: imageId,
        url: `https://proj.supabase.co/storage/v1/object/public/event-media/${galleryPath}`,
      },
    });
    expect(tables.event_images.insert).toHaveBeenCalledWith({
      event_id: eventId,
      storage_path: galleryPath,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });
});

describe("removeEventImage", () => {
  it("apaga o registro e o arquivo", async () => {
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { storage_path: galleryPath } }),
    });
    expect(await removeEventImage(eventId, imageId)).toEqual({ ok: true, data: undefined });
    expect(tables.event_images.delete).toHaveBeenCalled();
    expect(mocks.removeMediaObjects).toHaveBeenCalledWith([galleryPath]);
  });

  it("foto inexistente devolve mensagem clara", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: null }),
    });
    expect(await removeEventImage(eventId, imageId)).toEqual({
      ok: false,
      error: "Foto não encontrada.",
    });
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});
