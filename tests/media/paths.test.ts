import { describe, expect, it } from "vitest";

import {
  buildCoverPath,
  buildGalleryPath,
  coverPathFromUrl,
  isCoverPath,
  isGalleryPathForEvent,
  isOwnMediaUrl,
  publicMediaUrl,
} from "@/lib/media/paths";
import { isImageContentType, isUuid } from "@/lib/media/rules";

const supabaseUrl = "https://proj.supabase.co";
const eventId = "00000000-0000-4000-8000-000000000001";
const otherEventId = "00000000-0000-4000-8000-000000000002";
const fileId = "11111111-1111-4111-8111-111111111111";

describe("regras de mídia", () => {
  it("aceita só JPG, PNG e WebP", () => {
    expect(isImageContentType("image/webp")).toBe(true);
    expect(isImageContentType("image/jpeg")).toBe(true);
    expect(isImageContentType("image/png")).toBe(true);
    expect(isImageContentType("image/gif")).toBe(false);
    expect(isImageContentType("image/svg+xml")).toBe(false);
    expect(isImageContentType(undefined)).toBe(false);
  });

  it("reconhece UUID em minúsculas", () => {
    expect(isUuid(eventId)).toBe(true);
    expect(isUuid("../../etc")).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});

describe("caminhos de mídia", () => {
  it("monta caminho da capa com extensão pelo tipo", () => {
    expect(buildCoverPath("image/webp", fileId)).toBe(`covers/${fileId}.webp`);
    expect(buildCoverPath("image/jpeg", fileId)).toBe(`covers/${fileId}.jpg`);
    expect(isCoverPath(buildCoverPath("image/png"))).toBe(true);
  });

  it("monta caminho da galeria dentro da pasta do evento", () => {
    const path = buildGalleryPath(eventId, "image/webp", fileId);
    expect(path).toBe(`events/${eventId}/${fileId}.webp`);
    expect(isGalleryPathForEvent(path, eventId)).toBe(true);
    expect(isGalleryPathForEvent(path, otherEventId)).toBe(false);
  });

  it("recusa caminhos fora do padrão", () => {
    expect(isCoverPath(`covers/${fileId}.gif`)).toBe(false);
    expect(isCoverPath(`covers/../${fileId}.webp`)).toBe(false);
    expect(isGalleryPathForEvent(`events/${eventId}/../x.webp`, eventId)).toBe(false);
    expect(isGalleryPathForEvent(`covers/${fileId}.webp`, eventId)).toBe(false);
  });

  it("monta URL pública e identifica capa nossa", () => {
    const url = publicMediaUrl(`${supabaseUrl}/`, `covers/${fileId}.webp`);
    expect(url).toBe(`${supabaseUrl}/storage/v1/object/public/event-media/covers/${fileId}.webp`);
    expect(isOwnMediaUrl(supabaseUrl, url)).toBe(true);
    expect(coverPathFromUrl(supabaseUrl, url)).toBe(`covers/${fileId}.webp`);
  });

  it("links externos ou de galeria não contam como capa nossa", () => {
    expect(coverPathFromUrl(supabaseUrl, "https://exemplo.com/capa.jpg")).toBeNull();
    expect(coverPathFromUrl(supabaseUrl, null)).toBeNull();
    const galleryUrl = publicMediaUrl(supabaseUrl, `events/${eventId}/${fileId}.webp`);
    expect(isOwnMediaUrl(supabaseUrl, galleryUrl)).toBe(true);
    expect(coverPathFromUrl(supabaseUrl, galleryUrl)).toBeNull();
  });
});
