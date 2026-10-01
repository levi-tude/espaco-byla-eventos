import { publicMediaUrl } from "@/lib/media/paths";
import type { createServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

export type GalleryImage = { id: string; url: string };

/** Fotos na ordem de envio; a RLS decide quem pode ver. */
export async function loadEventGallery(
  supabase: ServerClient,
  eventId: string,
): Promise<GalleryImage[]> {
  const { data } = await supabase
    .from("event_images")
    .select("id, storage_path")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  return (data ?? []).map(({ id, storage_path }) => ({
    id,
    url: publicMediaUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, storage_path),
  }));
}
