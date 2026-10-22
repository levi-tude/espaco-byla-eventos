import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cache } from "react";

import type { Database } from "@/types/database";

export const ORGANIZER_AREA_UNAVAILABLE_MESSAGE = "Esta área está indisponível no momento.";

/** Texto das páginas quando o banco não responde e não há resposta anterior. */
export const ORGANIZER_AREA_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Esta área está indisponível agora. Tente de novo em instantes.";

export type OrganizerAreaSwitchState = "on" | "off" | "unknown";

/**
 * O rodapé de toda página pergunta: banco lento não pode segurar o site. Depois de
 * minutos parado, a primeira consulta abre conexão nova até o banco e passa de 1,5 s.
 */
const SWITCH_TIMEOUT_MS = 2_500;
/** Ligar ou desligar a área (SQL) aparece no site em até 30 s. */
const FRESH_MS = 30_000;
/**
 * Banco sem responder: vale a última resposta de até 10 min (cobre o ping de 5 em 5 min).
 * Mais velha ou nenhuma = desconhecida. O próprio banco confere a chave em toda função de
 * organizador; aqui é só o que a tela mostra.
 */
const LAST_ANSWER_MAX_AGE_MS = 10 * 60_000;
const FAILURE_LOG = "[organizador] Falha ao ler a chave da área; tratando como desconhecida.";
const TIMEOUT_LOG = "[organizador] A chave da área demorou demais; tratando como desconhecida.";

let lastAnswer: { enabled: boolean; at: number } | null = null;
let pending: Promise<boolean | null> | null = null;

/** `null` = sem resposta (erro, demora ou resposta estranha). */
async function askDatabase(url: string, anonKey: string): Promise<boolean | null> {
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
    if (result === "timeout") return failed(TIMEOUT_LOG);
    if (result.error || typeof result.data !== "boolean") return failed(FAILURE_LOG);
    lastAnswer = { enabled: result.data, at: Date.now() };
    return result.data;
  } catch {
    return failed(FAILURE_LOG);
  } finally {
    clearTimeout(timer);
  }
}

function failed(log: string): null {
  // Só a chave ligada/desligada da área (rodapé, login). NÃO é aceite de termos.
  if (lastAnswer && Date.now() - lastAnswer.at <= LAST_ANSWER_MAX_AGE_MS) {
    console.warn("[organizador] Sem resposta do banco para a chave da área; usando a última resposta.");
  } else {
    console.error(log);
  }
  return null;
}

/** Testes e ações que precisam forçar nova leitura da chave da área. */
export function clearOrganizerAreaSwitchCache(): void {
  lastAnswer = null;
  pending = null;
}

async function readSwitchAnswer(): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (lastAnswer && Date.now() - lastAnswer.at < FRESH_MS) return lastAnswer.enabled;

  pending ??= askDatabase(url, anonKey).finally(() => {
    pending = null;
  });
  const answer = await pending;
  if (answer !== null) return answer;
  if (lastAnswer && Date.now() - lastAnswer.at <= LAST_ANSWER_MAX_AGE_MS) return lastAnswer.enabled;
  return null;
}

/**
 * Ligada / desligada / sem resposta recente. Páginas públicas usam "unknown" para
 * mostrar "tente de novo" em vez de 404 falso.
 */
export const organizerAreaSwitchState = cache(async (): Promise<OrganizerAreaSwitchState> => {
  const answer = await readSwitchAnswer();
  if (answer === true) return "on";
  if (answer === false) return "off";
  return "unknown";
});

/**
 * Chave geral da área de organizadores (`organizer_settings.enabled`), lida com a
 * chave pública: só diz ligada ou desligada. Uma consulta por instância a cada 30 s;
 * pedidos ao mesmo tempo dividem a mesma consulta.
 */
export const organizerAreaEnabled = cache(async (): Promise<boolean> => {
  return (await organizerAreaSwitchState()) === "on";
});
