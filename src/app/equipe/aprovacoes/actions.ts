"use server";

import { revalidatePath } from "next/cache";

import { ActionError, runAction, type ActionResult } from "@/lib/action-result";
import { EVENT_NOT_FOUND_MESSAGE, requireTeamAdmin } from "@/lib/auth/actor";
import { requireStaffUser } from "@/lib/auth/staff-user";
import type { OrganizerRequestKind } from "@/lib/email/organizer-notice-template";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { notifyOrganizer, organizerNoticeLink } from "@/lib/organizer/notify";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_PATH = "/equipe/aprovacoes";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MIN = 5;
const NOTE_MAX = 500;

const REQUEST_NOT_FOUND = "Pedido não encontrado.";
const NOTE_MESSAGE = `Escreva o motivo da recusa (de ${NOTE_MIN} a ${NOTE_MAX} caracteres).`;
const DECISION_ERROR = "Não foi possível registrar a decisão. Tente de novo.";
const REQUEST_ERROR = "Não foi possível responder o pedido. Tente de novo.";
const LOOKUP_ERROR = "Não foi possível concluir. Tente de novo.";

export type ApprovalDecision = "aprovar" | "recusar";

type AdminClient = ReturnType<typeof createAdminClient>;
type EventRef = { id: string; slug: string; name: string; organizerId: string | null };
type PendingRequest = { eventId: string; eventName: string; kind: OrganizerRequestKind };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Só o código do erro vai para o registro (nunca motivo, nome ou e-mail). */
function logRpcError(rpc: string, error: { code?: string }) {
  console.error(`[aprovacoes] Falha em ${rpc}.`, error.code ?? "sem-codigo");
}

function cleanNote(note: unknown): string {
  const clean = typeof note === "string" ? note.trim() : "";
  if (clean.length < NOTE_MIN || clean.length > NOTE_MAX) throw new ActionError(NOTE_MESSAGE);
  return clean;
}

async function loadEventRef(admin: AdminClient, eventId: string): Promise<EventRef | null> {
  const { data, error } = await admin
    .from("events")
    .select("id, slug, name, organizer_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    logRpcError("events", error);
    return null;
  }
  return data ? { id: data.id, slug: data.slug, name: data.name, organizerId: data.organizer_id } : null;
}

/**
 * O pedido pendente (para o aviso ao organizador). A tabela só é lida pelas funções do
 * banco; quem decide se a resposta vale é a própria função de resposta. Se a leitura
 * falha, nada é respondido: o organizador ficaria sem o aviso.
 */
async function loadPendingRequest(admin: AdminClient, staffId: string, requestId: string): Promise<PendingRequest | null> {
  const { data, error } = await admin.rpc("list_ops_requests", { p_staff: staffId, p_status: "pendente" });
  if (error) {
    logRpcError("list_ops_requests", error);
    throw new ActionError(LOOKUP_ERROR);
  }
  const found = (data ?? []).find((row) => row.id === requestId);
  if (!found || (found.kind !== "estorno" && found.kind !== "mudanca" && found.kind !== "exclusao")) return null;
  return { eventId: found.event_id, eventName: found.event_name, kind: found.kind };
}

function translate(message: string, fallback: string): string {
  return organizerErrorMessage(message, { area: "admin" }) ?? fallback;
}

/** Avisa o organizador e atualiza as telas depois de responder um pedido. */
async function afterRequestAnswered(
  admin: AdminClient,
  request: PendingRequest | null,
  outcome: "atendido" | "recusado",
  note?: string,
) {
  revalidatePath(PAGE_PATH);
  if (!request) {
    console.warn("[aprovacoes] Pedido respondido sem dados para o aviso ao organizador.");
    return;
  }
  revalidatePath(`/equipe/eventos/${request.eventId}`);
  revalidatePath(`/organizador/eventos/${request.eventId}`);
  const event = await loadEventRef(admin, request.eventId);
  if (request.kind === "exclusao" && outcome === "atendido") {
    revalidatePath("/");
    revalidatePath("/equipe");
    revalidatePath("/organizador");
    if (event) revalidatePath(`/eventos/${event.slug}`);
  }
  if (!event?.organizerId) return;
  await notifyOrganizer(event.organizerId, "org_pedido_respondido", {
    eventName: request.eventName,
    requestKind: request.kind,
    outcome,
    ...(note ? { note } : {}),
    link: organizerNoticeLink(`/organizador/eventos/${request.eventId}`),
  });
}

export async function decideEventApproval(
  eventId: string,
  input: { decision: ApprovalDecision; publish: boolean; note: string },
): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireTeamAdmin();
    if (!isUuid(eventId)) throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
    if (typeof input !== "object" || input === null || typeof input.publish !== "boolean") {
      throw new ActionError("Confira os dados e tente de novo.");
    }
    if (input.decision !== "aprovar" && input.decision !== "recusar") {
      throw new ActionError("Confira os dados e tente de novo.");
    }
    const approve = input.decision === "aprovar";
    const note = approve ? null : cleanNote(input.note);

    const admin = createAdminClient();
    const event = await loadEventRef(admin, eventId);
    if (!event?.organizerId) throw new ActionError(EVENT_NOT_FOUND_MESSAGE);

    const { error } = await admin.rpc("decide_event_approval", {
      p_admin: userId,
      p_event_id: eventId,
      p_decision: input.decision,
      p_publish: approve && input.publish,
      p_note: note,
    });
    if (error) {
      logRpcError("decide_event_approval", error);
      throw new ActionError(translate(error.message, DECISION_ERROR));
    }

    const paths = [
      "/",
      `/eventos/${event.slug}`,
      PAGE_PATH,
      "/equipe",
      `/equipe/eventos/${eventId}`,
      "/organizador",
      `/organizador/eventos/${eventId}`,
    ];
    paths.forEach((path) => revalidatePath(path));
    await notifyOrganizer(event.organizerId, approve ? "org_evento_aprovado" : "org_evento_recusado", {
      eventName: event.name,
      ...(note ? { note } : {}),
      link: organizerNoticeLink(`/organizador/eventos/${eventId}`),
    });
    return undefined;
  }, DECISION_ERROR);
}

export async function finishEventChange(requestId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireTeamAdmin();
    if (!isUuid(requestId)) throw new ActionError(REQUEST_NOT_FOUND);

    const admin = createAdminClient();
    const request = await loadPendingRequest(admin, userId, requestId);
    const { error } = await admin.rpc("finish_event_change", { p_admin: userId, p_request_id: requestId });
    if (error) {
      logRpcError("finish_event_change", error);
      throw new ActionError(translate(error.message, REQUEST_ERROR));
    }

    await afterRequestAnswered(admin, request, "atendido");
    return undefined;
  }, REQUEST_ERROR);
}

export async function finishEventDeletion(requestId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireTeamAdmin();
    if (!isUuid(requestId)) throw new ActionError(REQUEST_NOT_FOUND);

    const admin = createAdminClient();
    const request = await loadPendingRequest(admin, userId, requestId);
    const { error } = await admin.rpc("finish_event_deletion", { p_admin: userId, p_request_id: requestId });
    if (error) {
      logRpcError("finish_event_deletion", error);
      throw new ActionError(translate(error.message, REQUEST_ERROR));
    }

    await afterRequestAnswered(admin, request, "atendido");
    return undefined;
  }, REQUEST_ERROR);
}

/** Qualquer conta da equipe recusa estorno; mudança e exclusão o banco só aceita do Admin. */
export async function declineOpsRequest(requestId: string, note: string): Promise<ActionResult> {
  return runAction(async () => {
    const { userId } = await requireStaffUser();
    if (!isUuid(requestId)) throw new ActionError(REQUEST_NOT_FOUND);
    const clean = cleanNote(note);

    const admin = createAdminClient();
    const request = await loadPendingRequest(admin, userId, requestId);
    const { error } = await admin.rpc("decline_ops_request", {
      p_staff: userId,
      p_request_id: requestId,
      p_note: clean,
    });
    if (error) {
      logRpcError("decline_ops_request", error);
      throw new ActionError(translate(error.message, REQUEST_ERROR));
    }

    await afterRequestAnswered(admin, request, "recusado", clean);
    return undefined;
  }, REQUEST_ERROR);
}
