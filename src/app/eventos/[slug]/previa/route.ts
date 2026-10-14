import { isOwnMediaUrl } from "@/lib/media/paths";
import { fetchCover, renderShareImage } from "@/lib/media/share-image";
import { SHARE_IMAGE } from "@/lib/share-metadata";
import { createServerClient } from "@/lib/supabase/server";

const SLUG_RE = /^[a-z0-9-]{1,200}$/;

/** Atrás do Cloud Run, `request.url` aponta para o host interno (0.0.0.0:3000). */
function fallback() {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const location = base ? new URL(SHARE_IMAGE.url, base).toString() : SHARE_IMAGE.url;
  return new Response(null, { status: 302, headers: { Location: location } });
}

/** Imagem de prévia do link do evento (WhatsApp, Instagram etc.). */
export async function GET(_request: Request, { params }: RouteContext<"/eventos/[slug]/previa">) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return fallback();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return fallback();

  try {
    const supabase = await createServerClient();
    const { data: event } = await supabase
      .from("events")
      .select("cover_image_url")
      .eq("slug", slug)
      .maybeSingle();

    const cover = event?.cover_image_url;
    if (!cover || !isOwnMediaUrl(supabaseUrl, cover)) return fallback();

    const source = await fetchCover(cover);
    if (!source) return fallback();

    const image = await renderShareImage(source);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("[previa] Falha ao gerar a prévia do evento:", error);
    return fallback();
  }
}
