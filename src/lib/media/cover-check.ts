import "server-only";

import { ActionError } from "@/lib/action-result";
import { coverPathFromUrl, isOwnMediaUrl } from "@/lib/media/paths";
import { COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";
import { mediaObjectExists } from "@/lib/media/storage";

/** Capa do nosso armazenamento precisa ser de `covers/` e existir de fato. */
export async function assertCoverUploaded(coverImageUrl: string | null | undefined) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!coverImageUrl || !isOwnMediaUrl(supabaseUrl, coverImageUrl)) return;
  const path = coverPathFromUrl(supabaseUrl, coverImageUrl);
  if (!path || !(await mediaObjectExists(path))) {
    throw new ActionError(COVER_NOT_FOUND_MESSAGE);
  }
}
