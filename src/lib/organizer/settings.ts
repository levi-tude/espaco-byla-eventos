import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cache } from "react";

import type { Database } from "@/types/database";

export const ORGANIZER_AREA_UNAVAILABLE_MESSAGE = "Esta área está indisponível no momento.";

/**
 * Chave geral da área de organizadores (`organizer_settings.enabled`), lida com a
 * chave pública: só diz ligada ou desligada. Qualquer falha conta como desligada.
 * Uma consulta por requisição, mesmo com rodapé e página perguntando.
 */
export const organizerAreaEnabled = cache(async (): Promise<boolean> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  try {
    const client = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc("organizer_area_enabled");
    if (error) {
      console.error("[organizador] Falha ao ler a chave da área; tratando como desligada.");
      return false;
    }
    return data === true;
  } catch {
    console.error("[organizador] Falha ao ler a chave da área; tratando como desligada.");
    return false;
  }
});
