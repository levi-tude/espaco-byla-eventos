import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import type { createServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** A linha "Produção" é enfeite: nunca segura a página nem o e-mail do ingresso. */
export const PRODUCER_LOOKUP_TIMEOUT_MS = 2000;

type RpcResult = { data: unknown; error: { code?: string } | null };

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name || null;
}

/** Qualquer falha (erro, exceção ou demora) vira `null`: sem a linha "Produção". */
async function safeRpc(call: () => PromiseLike<RpcResult>, label: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), PRODUCER_LOOKUP_TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve().then(call), timeout]);
    if (result === "timeout") {
      console.error(`[producao] ${label}: sem resposta a tempo.`);
      return null;
    }
    if (result.error) {
      console.error(`[producao] ${label}: falha.`, result.error.code ?? "sem-codigo");
      return null;
    }
    return result.data;
  } catch {
    console.error(`[producao] ${label}: falha.`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Nome público do organizador para a página do evento (o banco só responde para evento visível). */
export async function loadPublicEventProducer(
  supabase: ServerClient,
  eventId: string,
): Promise<string | null> {
  const data = await safeRpc(
    () => supabase.rpc("public_event_producer", { p_event_id: eventId }),
    "página do evento",
  );
  return cleanName(data);
}

/** Nome público do organizador para o e-mail do ingresso; evento do próprio Espaço = `null`. */
export async function loadEventProducerName(
  admin: SupabaseAdmin,
  eventId: string,
): Promise<string | null> {
  const data = await safeRpc(
    () => admin.rpc("event_producer_names", { p_event_ids: [eventId] }),
    "e-mail do ingresso",
  );
  if (!Array.isArray(data)) return null;
  const row = data.find(
    (item): item is { event_id: string; public_name: unknown } =>
      typeof item === "object" && item !== null && item.event_id === eventId,
  );
  return cleanName(row?.public_name);
}
