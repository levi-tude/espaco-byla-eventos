import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cache } from "react";

import type { Database } from "@/types/database";

export const ORGANIZER_AREA_UNAVAILABLE_MESSAGE = "Esta área está indisponível no momento.";

/** O rodapé de toda página pergunta: banco lento não pode segurar o site. */
const SWITCH_TIMEOUT_MS = 1_500;
const FAILURE_LOG = "[organizador] Falha ao ler a chave da área; tratando como desligada.";

/**
 * Chave geral da área de organizadores (`organizer_settings.enabled`), lida com a
 * chave pública: só diz ligada ou desligada. Qualquer falha ou demora conta como desligada.
 * Uma consulta por requisição, mesmo com rodapé e página perguntando.
 */
export const organizerAreaEnabled = cache(async (): Promise<boolean> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, SWITCH_TIMEOUT_MS);
    });
    const result = await Promise.race([
      client.rpc("organizer_area_enabled").abortSignal(controller.signal),
      timedOut,
    ]);
    if (result === "timeout") {
      console.error("[organizador] A chave da área demorou demais; tratando como desligada.");
      return false;
    }
    if (result.error) {
      console.error(FAILURE_LOG);
      return false;
    }
    return result.data === true;
  } catch {
    console.error(FAILURE_LOG);
    return false;
  } finally {
    clearTimeout(timer);
  }
});
