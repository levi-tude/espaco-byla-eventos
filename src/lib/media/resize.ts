export const MAX_IMAGE_DIMENSION = 1920;
const QUALITY = 0.85;

export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** Só no navegador. Safari não gera WebP pelo canvas, então cai para JPEG. */
export async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponível.");
    context.drawImage(bitmap, 0, 0, width, height);

    const webp = await canvasToBlob(canvas, "image/webp");
    if (webp?.type === "image/webp") return webp;

    const jpeg = await canvasToBlob(canvas, "image/jpeg");
    if (!jpeg) throw new Error("Não foi possível gerar a imagem.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}
