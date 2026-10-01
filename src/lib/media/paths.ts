import { imageExtension, type ImageContentType, MEDIA_BUCKET } from "@/lib/media/rules";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COVER_PATH_RE = new RegExp(`^covers/${UUID}\\.(webp|jpg|png)$`);
const GALLERY_PATH_RE = new RegExp(`^events/(${UUID})/${UUID}\\.(webp|jpg|png)$`);

export function buildCoverPath(
  contentType: ImageContentType,
  id: string = crypto.randomUUID(),
): string {
  return `covers/${id}.${imageExtension(contentType)}`;
}

export function buildGalleryPath(
  eventId: string,
  contentType: ImageContentType,
  id: string = crypto.randomUUID(),
): string {
  return `events/${eventId}/${id}.${imageExtension(contentType)}`;
}

export function isCoverPath(path: string): boolean {
  return COVER_PATH_RE.test(path);
}

export function isGalleryPathForEvent(path: string, eventId: string): boolean {
  return GALLERY_PATH_RE.exec(path)?.[1] === eventId;
}

export function publicMediaUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}

export function isOwnMediaUrl(supabaseUrl: string, url: string): boolean {
  return url.startsWith(publicMediaUrl(supabaseUrl, ""));
}

/** Caminho no bucket quando a capa foi enviada por nós; `null` para links externos. */
export function coverPathFromUrl(
  supabaseUrl: string,
  url: string | null | undefined,
): string | null {
  if (!url || !isOwnMediaUrl(supabaseUrl, url)) return null;
  const path = url.slice(publicMediaUrl(supabaseUrl, "").length);
  return isCoverPath(path) ? path : null;
}
