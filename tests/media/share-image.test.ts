import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cover: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: mocks.cover === null ? null : { cover_image_url: mocks.cover },
        error: null,
      }),
    };
    return { from: () => chain };
  },
}));

import { GET } from "@/app/eventos/[slug]/previa/route";
import {
  renderShareImage,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_MAX_BYTES,
  SHARE_IMAGE_WIDTH,
  shareImageVersion,
} from "@/lib/media/share-image";

const SUPABASE = "https://projeto.supabase.co";
const OWN_COVER = `${SUPABASE}/storage/v1/object/public/event-media/covers/11111111-2222-4333-8444-555555555555.webp`;

function noisyImage(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7919) % 256;
  return sharp(pixels, { raw: { width, height, channels: 3 } }).webp({ quality: 95 }).toBuffer();
}

const call = (slug: string) =>
  GET(new Request(`https://ingressos.exemplo/eventos/${slug}/previa`), {
    params: Promise.resolve({ slug }),
  });

describe("prévia do link do evento", () => {
  beforeEach(() => {
    mocks.cover = OWN_COVER;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("gera JPEG 1200×630 dentro do limite do WhatsApp, mesmo com capa pesada", async () => {
    const output = await renderShareImage(await noisyImage(1920, 1080));
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
    expect(output.length).toBeLessThanOrEqual(SHARE_IMAGE_MAX_BYTES);
    expect([meta.width, meta.height]).toEqual(
      meta.width === SHARE_IMAGE_WIDTH ? [SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT] : [960, 504],
    );
  });

  it("a versão muda quando a capa muda", () => {
    expect(shareImageVersion(OWN_COVER)).toBe("11111111-2222-4333-8444-555555555555");
    expect(shareImageVersion(OWN_COVER.replace("1111", "9999"))).not.toBe(shareImageVersion(OWN_COVER));
  });

  it("responde a imagem da capa do nosso armazenamento", async () => {
    const cover = await noisyImage(800, 450);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(cover)));
    const response = await call("show-de-sabado");
    expect(fetchSpy).toHaveBeenCalledWith(OWN_COVER, expect.objectContaining({ redirect: "error" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("usa a logo quando não há capa, o endereço é inválido ou a capa é de fora", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mocks.cover = null;
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ingressos.exemplo");
    expect((await call("sem-capa")).headers.get("location")).toBe(
      "https://ingressos.exemplo/brand/og-acdh.png",
    );
    expect((await call("../segredo")).status).toBe(302);
    mocks.cover = "https://outro-site.exemplo/imagem.jpg";
    expect((await call("capa-externa")).status).toBe(302);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("usa a logo quando baixar ou converter a capa falha", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("x", { status: 404 }));
    expect((await call("capa-sumiu")).status).toBe(302);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("não é imagem"));
    expect((await call("capa-quebrada")).status).toBe(302);
  });
});
