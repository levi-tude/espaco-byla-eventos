import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  adminRpc: vi.fn(),
  createAdminClient: vi.fn(),
  createUploadToken: vi.fn(),
  mediaObjectExists: vi.fn(),
  removeMediaObjects: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }),
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
import { RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";

const userId = "00000000-0000-4000-8000-0000000000aa";
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

let currentTables: Record<string, ReturnType<typeof table>> = {};

function useTables(tables: Record<string, ReturnType<typeof table>>) {
  currentTables = tables;
  return tables;
}

type Who = "anonimo" | "equipe" | "organizador";

/** Quem está logado e o que `actor_event_access` responde para o evento. */
function loggedAs(who: Who, access: "equipe" | "dono" | null = who === "equipe" ? "equipe" : "dono") {
  mocks.getUser.mockResolvedValue({
    data: { user: who === "anonimo" ? null : { id: userId } },
    error: null,
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: (name === "is_staff" && who === "equipe") || (name === "is_organizer" && who === "organizador"),
    error: null,
  }));
  mocks.adminRpc.mockImplementation(async (name: string) => {
    if (name === "staff_finance_role") return { data: "secretaria", error: null };
    if (name === "actor_event_access") return { data: access, error: null };
    if (name === "consume_rate_limit") return { data: true, error: null };
    return { data: null, error: { message: "inesperado" } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  currentTables = {};
  mocks.createAdminClient.mockImplementation(() => ({
    from: (name: string) => currentTables[name],
    rpc: mocks.adminRpc,
  }));
  loggedAs("equipe");
  mocks.createUploadToken.mockResolvedValue("token-de-envio");
  mocks.mediaObjectExists.mockResolvedValue(true);
});

describe("ações de fotos sem login", () => {
  const actions = {
    requestCover: () => requestImageUpload("cover", "image/webp"),
    requestImageUpload: () => requestImageUpload("gallery", "image/webp", eventId),
    addEventImage: () => addEventImage(eventId, galleryPath),
    removeEventImage: () => removeEventImage(eventId, imageId),
  };

  it.each(Object.entries(actions))("%s é recusada antes de tocar no banco", async (_n, action) => {
    loggedAs("anonimo");
    expect(await action()).toEqual({ ok: false, error: "Acesso não permitido." });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
  });
});

describe("organizador", () => {
  it("pede envio de capa e conta no limite por conta", async () => {
    loggedAs("organizador");
    const result = await requestImageUpload("cover", "image/webp");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toMatch(/^covers\/[0-9a-f-]{36}\.webp$/);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({ p_bucket: "org-upload:user", p_limit: 60, p_window_seconds: 3600 }),
    );
  });

  it("capa acima do limite não recebe autorização de envio", async () => {
    loggedAs("organizador");
    const base = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "consume_rate_limit" ? { data: false, error: null } : base(name, args),
    );
    expect(await requestImageUpload("cover", "image/webp")).toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("limite indisponível: falha fechada", async () => {
    loggedAs("organizador");
    const base = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "consume_rate_limit" ? { data: null, error: { message: "falhou" } } : base(name, args),
    );
    expect((await requestImageUpload("cover", "image/webp")).ok).toBe(false);
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("equipe pede capa sem passar pelo limite do organizador", async () => {
    expect((await requestImageUpload("cover", "image/webp")).ok).toBe(true);
    expect(mocks.adminRpc).not.toHaveBeenCalledWith("consume_rate_limit", expect.anything());
  });

  it("galeria do próprio evento: pede envio e revalida a tela do organizador", async () => {
    loggedAs("organizador", "dono");
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { id: imageId }, count: 1 }),
    });
    expect((await requestImageUpload("gallery", "image/webp", eventId)).ok).toBe(true);
    expect((await addEventImage(eventId, galleryPath)).ok).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/organizador/eventos/${eventId}`);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({ p_bucket: "org-upload:user", p_limit: 60, p_window_seconds: 3600 }),
    );
  });

  it("galeria acima do limite não recebe autorização de envio", async () => {
    loggedAs("organizador", "dono");
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 1 }),
    });
    const base = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "consume_rate_limit" ? { data: false, error: null } : base(name, args),
    );
    expect(await requestImageUpload("gallery", "image/webp", eventId)).toEqual({
      ok: false,
      error: RATE_LIMIT_MESSAGE,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("galeria com limite indisponível: falha fechada", async () => {
    loggedAs("organizador", "dono");
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 1 }),
    });
    const base = mocks.adminRpc.getMockImplementation()!;
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "consume_rate_limit" ? { data: null, error: { message: "falhou" } } : base(name, args),
    );
    expect((await requestImageUpload("gallery", "image/webp", eventId)).ok).toBe(false);
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
  });

  it("equipe pede envio na galeria sem passar pelo limite do organizador", async () => {
    useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ count: 1 }),
    });
    expect((await requestImageUpload("gallery", "image/webp", eventId)).ok).toBe(true);
    expect(mocks.adminRpc).not.toHaveBeenCalledWith("consume_rate_limit", expect.anything());
  });

  const otherOwner = {
    requestImageUpload: () => requestImageUpload("gallery", "image/webp", eventId),
    addEventImage: () => addEventImage(eventId, galleryPath),
    removeEventImage: () => removeEventImage(eventId, imageId),
  };

  it.each(Object.entries(otherOwner))("%s em evento de outro dono: Evento não encontrado", async (_n, action) => {
    loggedAs("organizador", null);
    const tables = useTables({
      events: table({ data: { slug: "show" } }),
      event_images: table({ data: { id: imageId, storage_path: galleryPath }, count: 0 }),
    });
    expect(await action()).toEqual({ ok: false, error: "Evento não encontrado." });
    expect(mocks.adminRpc).toHaveBeenCalledWith("actor_event_access", {
      p_actor_user_id: userId,
      p_event_id: eventId,
    });
    expect(mocks.createUploadToken).not.toHaveBeenCalled();
    expect(mocks.removeMediaObjects).not.toHaveBeenCalled();
    expect(tables.event_images.insert).not.toHaveBeenCalled();
    expect(tables.event_images.delete).not.toHaveBeenCalled();
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
