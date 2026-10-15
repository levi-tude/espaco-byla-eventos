import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { coverPathFromUrl, isCoverPath } from "@/lib/media/paths";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { listMediaObjects, removeMediaObjects } from "@/lib/media/storage";

/** Capa nossa em qualquer endereço (ex.: o endereço do banco mudou depois do envio). */
const COVER_IN_URL_RE =
  /\/(covers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|jpg|png))(?:[?#]|$)/;
const PAGE_SIZE = 500;
const MAX_PAGES = 10;
/** Leitura dos eventos com este tamanho pode ter sido cortada pelo limite da API: não apaga. */
const EVENTS_READ_CAP = 1000;

/**
 * Apaga capas enviadas e nunca usadas (ex.: formulário abandonado). Só apaga com a lista
 * completa de capas em uso; qualquer dúvida, não apaga nada. Nunca lança.
 */
export async function sweepOrphanCovers(
  admin: SupabaseAdmin,
  options: { maxDeletes?: number; minAgeHours?: number } = {},
): Promise<{ checked: number; deleted: number }> {
  const maxDeletes = options.maxDeletes ?? 100;
  const minAgeHours = options.minAgeHours ?? 24;
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return { checked: 0, deleted: 0 };

    const { data: events, error } = await admin
      .from("events")
      .select("cover_image_url")
      .not("cover_image_url", "is", null)
      .range(0, EVENTS_READ_CAP - 1);
    if (error || !events || events.length >= EVENTS_READ_CAP) {
      console.error("[midia] Limpeza de capas pulada: lista de eventos indisponível.", error?.code ?? "sem-codigo");
      return { checked: 0, deleted: 0 };
    }
    const inUse = new Set<string>();
    for (const { cover_image_url: url } of events) {
      if (!url) continue;
      const path = coverPathFromUrl(supabaseUrl, url) ?? COVER_IN_URL_RE.exec(url)?.[1] ?? null;
      if (path) {
        inUse.add(path);
      } else if (url.includes(`/${MEDIA_BUCKET}/`) || url.includes("covers/")) {
        console.error("[midia] Limpeza de capas pulada: capa com endereço inesperado.");
        return { checked: 0, deleted: 0 };
      }
    }

    const cutoff = Date.now() - minAgeHours * 3_600_000;
    const orphans: string[] = [];
    let checked = 0;
    for (let page = 0; page < MAX_PAGES && orphans.length < maxDeletes; page++) {
      const objects = await listMediaObjects("covers", { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      for (const object of objects) {
        if (!isCoverPath(object.path)) continue;
        checked++;
        const createdAt = object.createdAt ? Date.parse(object.createdAt) : Number.NaN;
        if (!Number.isFinite(createdAt) || createdAt > cutoff) continue;
        if (inUse.has(object.path)) continue;
        orphans.push(object.path);
        if (orphans.length >= maxDeletes) break;
      }
      if (objects.length < PAGE_SIZE) break;
    }

    await removeMediaObjects(orphans);
    return { checked, deleted: orphans.length };
  } catch (error) {
    console.error(
      "[midia] Falha na limpeza de capas.",
      error instanceof Error ? error.name : "desconhecido",
    );
    return { checked: 0, deleted: 0 };
  }
}
