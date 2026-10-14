import "server-only";

import { ActionError } from "@/lib/action-result";
import { coverPathFromUrl, isOwnMediaUrl } from "@/lib/media/paths";
import { COVER_IN_USE_MESSAGE, COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";
import { mediaObjectExists, removeMediaObjects } from "@/lib/media/storage";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

/** Capa do nosso armazenamento precisa ser de `covers/` e existir de fato. */
export async function assertCoverUploaded(coverImageUrl: string | null | undefined) {
  if (!coverImageUrl || !isOwnMediaUrl(supabaseUrl(), coverImageUrl)) return;
  const path = coverPathFromUrl(supabaseUrl(), coverImageUrl);
  if (!path || !(await mediaObjectExists(path))) {
    throw new ActionError(COVER_NOT_FOUND_MESSAGE);
  }
}

/**
 * Outro evento (inclusive apagado) aponta para o mesmo arquivo de capa?
 * `null` quando a consulta falha: quem chama decide o lado seguro.
 */
async function coverUsedElsewhere(admin: Admin, path: string, eventId?: string): Promise<boolean | null> {
  let query = admin.from("events").select("id").like("cover_image_url", `%${path}%`);
  if (eventId) query = query.neq("id", eventId);
  const { data, error } = await query.limit(1);
  if (error || !Array.isArray(data)) return null;
  return data.length > 0;
}

/** Organizador não pode reaproveitar o arquivo de capa de outro evento (depois o apagaria). */
export async function assertCoverNotShared(
  admin: Admin,
  coverImageUrl: string | null | undefined,
  eventId?: string,
) {
  const path = coverPathFromUrl(supabaseUrl(), coverImageUrl);
  if (!path) return;
  if ((await coverUsedElsewhere(admin, path, eventId)) !== false) {
    throw new ActionError(COVER_IN_USE_MESSAGE);
  }
}

/** Apaga a capa trocada só se for nossa e nenhum outro evento ainda a usar. */
export async function removeReplacedCover(
  admin: Admin,
  eventId: string,
  previousUrl: string | null | undefined,
  nextUrl: string | null | undefined,
) {
  const path = coverPathFromUrl(supabaseUrl(), previousUrl);
  if (!path || previousUrl === nextUrl) return;
  if ((await coverUsedElsewhere(admin, path, eventId)) !== false) return;
  await removeMediaObjects([path]);
}
