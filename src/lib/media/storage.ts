import "server-only";

import { MEDIA_BUCKET } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";

function bucket() {
  return createAdminClient().storage.from(MEDIA_BUCKET);
}

/** Token de envio de uso único; sem upsert, não sobrescreve arquivo existente. */
export async function createUploadToken(path: string): Promise<string> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Falha ao autorizar envio: ${error?.message}`);
  return data.token;
}

export async function mediaObjectExists(path: string): Promise<boolean> {
  const { data } = await bucket().exists(path);
  return data === true;
}

/** Falha ao apagar só vai para o log: não deve desfazer a ação da equipe. */
export async function removeMediaObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await bucket().remove(paths);
  if (error) console.error("[midia] Falha ao apagar arquivo.", error.message);
}
