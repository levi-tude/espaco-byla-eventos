import { NextResponse } from "next/server";

import { isOwnMediaUrl } from "@/lib/media/paths";
import { fetchCover, renderShareImage } from "@/lib/media/share-image";
import { SHARE_IMAGE } from "@/lib/share-metadata";
import { createServerClient } from "@/lib/supabase/server";

const SLUG_RE = /^[a-z0-9-]{1,200}$/;

function fallback(request: Request) {
  return NextResponse.redirect(new URL(SHARE_IMAGE.url, request.url), 302);
}

/** Imagem de prévia do link do evento (WhatsApp, Instagram etc.). */
export async function GET(request: Request, { params }: RouteContext<"/eventos/[slug]/previa">) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return fallback(request);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return fallback(request);

  try {
    const supabase = await createServerClient();
    const { data: event } = await supabase
      .from("events")
      .select("cover_image_url")
      .eq("slug", slug)
      .maybeSingle();

    const cover = event?.cover_image_url;
    if (!cover || !isOwnMediaUrl(supabaseUrl, cover)) return fallback(request);

    const source = await fetchCover(cover);
    if (!source) return fallback(request);

    const image = await renderShareImage(source);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("[previa] Falha ao gerar a prévia do evento:", error);
    return fallback(request);
  }
}
