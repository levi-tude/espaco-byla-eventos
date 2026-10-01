export const MEDIA_BUCKET = "event-media";
export const MAX_GALLERY_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;

export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

export const IMAGE_ACCEPT = Object.keys(IMAGE_EXTENSIONS).join(",");

export const INVALID_IMAGE_TYPE_MESSAGE = "Use uma imagem JPG, PNG ou WebP.";
export const IMAGE_TOO_LARGE_MESSAGE = "A imagem ficou grande demais. Tente outra foto.";
export const GALLERY_FULL_MESSAGE = `A galeria já tem ${MAX_GALLERY_IMAGES} fotos. Remova uma para adicionar outra.`;
export const UPLOAD_FAILED_MESSAGE = "Não foi possível enviar esta foto. Tente de novo.";
export const COVER_NOT_FOUND_MESSAGE = "A capa enviada não foi encontrada. Envie a imagem de novo.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && Object.hasOwn(IMAGE_EXTENSIONS, value);
}

export function imageExtension(contentType: ImageContentType): string {
  return IMAGE_EXTENSIONS[contentType];
}
