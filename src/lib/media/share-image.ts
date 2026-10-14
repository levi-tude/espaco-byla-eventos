import "server-only";

import { MAX_IMAGE_BYTES } from "@/lib/media/rules";

export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
/** WhatsApp ignora prévias acima de ~300 KB. */
export const SHARE_IMAGE_MAX_BYTES = 300 * 1024;

const FETCH_TIMEOUT_MS = 5000;

/** Muda quando a capa muda, para o WhatsApp não reaproveitar a prévia antiga. */
export function shareImageVersion(coverUrl: string): string {
  const file = coverUrl.split("?")[0].split("/").pop() ?? "";
  return file.replace(/\.[a-z]+$/i, "").slice(0, 64);
}

/**
 * Recorta a capa em 1200×630 e gera um JPEG leve; desce a qualidade se passar do limite.
 * O sharp é carregado só aqui para uma falha nele não derrubar a página do evento.
 */
export async function renderShareImage(source: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const resized = sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, { fit: "cover", position: "centre" });

  for (const quality of [82, 70, 58]) {
    const output = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (output.length <= SHARE_IMAGE_MAX_BYTES) return output;
  }
  return resized.clone().resize(960, 504).jpeg({ quality: 55, mozjpeg: true }).toBuffer();
}

/** Baixa a capa do nosso bucket com tempo e tamanho limitados. */
export async function fetchCover(url: string): Promise<Buffer | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return body.length > 0 && body.length <= MAX_IMAGE_BYTES ? body : null;
}
