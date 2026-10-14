"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { EVENT_NOT_FOUND_MESSAGE, requireOrganizer } from "@/lib/auth/actor";
import { UUID_PATTERN } from "@/lib/events/event-input";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { notifyTeam, organizerNoticeLink } from "@/lib/organizer/notify";
import { parseReason } from "@/lib/organizer/validation";
import { createAdminClient } from "@/lib/supabase/admin";

const REFUND_FALLBACK_MESSAGE = "Não foi possível enviar o pedido de estorno.";
const CANCEL_FALLBACK_MESSAGE = "Não foi possível cancelar o pedido.";
const REQUEST_NOT_FOUND_MESSAGE = "Pedido não encontrado.";
const ALREADY_ANSWERED_MESSAGE = "Este pedido já foi respondido. Atualize a página.";

/** "Pedir estorno" de um pedido pago do próprio evento; quem faz o estorno é a equipe. */
export async function requestOrderRefund(orderId: string, reason: string): Promise<ActionResult> {
  return runAction(() => requestOrderRefundOrThrow(orderId, reason), REFUND_FALLBACK_MESSAGE);
}

/** Desiste de um pedido à equipe que ainda está em análise. */
export async function cancelOpsRequest(requestId: string): Promise<ActionResult> {
  return runAction(() => cancelOpsRequestOrThrow(requestId), CANCEL_FALLBACK_MESSAGE);
}

function logDbError(area: string, error: { code?: string }) {
  console.error(`[organizador] Falha em ${area}.`, error.code ?? "sem-codigo");
}

async function requestOrderRefundOrThrow(orderId: unknown, reason: unknown): Promise<undefined> {
  const { userId } = await requireOrganizer();
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) throw new ActionError("Pedido inválido.");
  const parsed = parseReason(reason);
  if (!parsed.ok) throw new ActionError(parsed.error);

  const admin = createAdminClient();
  // O banco confere o dono pelo evento do próprio pedido, nunca por um ID do navegador.
  const { error } = await admin.rpc("request_order_refund", {
    p_actor: userId,
    p_order_id: orderId,
    p_reason: parsed.value,
  });
  if (error) {
    if (error.message.includes("ORG_DONO")) throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
    const message = organizerErrorMessage(error.message);
    if (!message) logDbError("pedir estorno", error);
    throw new ActionError(message ?? REFUND_FALLBACK_MESSAGE);
  }

  const { data: order } = await admin
    .from("orders")
    .select("event_id, events(name)")
    .eq("id", orderId)
    .maybeSingle();
  const event = Array.isArray(order?.events) ? order.events[0] : order?.events;
  const eventId = order?.event_id;

  await notifyTeam("equipe_pedido_organizador", {
    eventName: event?.name,
    requestKind: "estorno",
    note: parsed.value,
    link: organizerNoticeLink(eventId ? `/equipe/eventos/${eventId}` : "/equipe"),
  });

  revalidatePath("/equipe");
  if (eventId) {
    revalidatePath(`/organizador/eventos/${eventId}`);
    revalidatePath(`/equipe/eventos/${eventId}`);
  }
}

async function cancelOpsRequestOrThrow(requestId: unknown): Promise<undefined> {
  const { userId } = await requireOrganizer();
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
    throw new ActionError(REQUEST_NOT_FOUND_MESSAGE);
  }

  const { data, error } = await createAdminClient().rpc("cancel_ops_request", {
    p_actor: userId,
    p_request_id: requestId,
  });
  if (error) {
    const message = organizerErrorMessage(error.message);
    if (!message) logDbError("cancelar pedido à equipe", error);
    throw new ActionError(message ?? CANCEL_FALLBACK_MESSAGE);
  }
  if (data !== true) throw new ActionError(ALREADY_ANSWERED_MESSAGE);

  // O evento do pedido só a função do banco lê; atualiza as páginas de evento das duas áreas.
  revalidatePath("/organizador/eventos/[id]", "page");
  revalidatePath("/equipe/eventos/[id]", "page");
  revalidatePath("/equipe/aprovacoes");
  revalidatePath("/equipe");
}
