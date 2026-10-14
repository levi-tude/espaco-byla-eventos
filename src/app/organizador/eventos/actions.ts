"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { EVENT_NOT_FOUND_MESSAGE, requireEventAccess, requireOrganizer } from "@/lib/auth/actor";
import { formatSessionLabel } from "@/lib/datetime";
import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";
import {
  type EventInput,
  normalizeEventInput,
  saveErrorMessage,
  sessionLabels,
  UUID_PATTERN,
} from "@/lib/events/event-input";
import { assertCoverNotShared, assertCoverUploaded, removeReplacedCover } from "@/lib/media/cover-check";
import { isGalleryPathForEvent } from "@/lib/media/paths";
import { removeMediaObjects } from "@/lib/media/storage";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { notifyTeam, notifyTeamEventSubmitted, organizerNoticeLink } from "@/lib/organizer/notify";
import { parseChangeWhat, parseReason } from "@/lib/organizer/validation";
import { consumeRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** `topic`: assunto com que a caixa abriu ("Local"); o texto dele não conta como descrição. */
export type EventChangeRequestInput = { topic?: string; what: string; reason: string };

/** O banco recusa slug maior que 200; o endereço fica curto e legível. */
const SLUG_BASE_MAX = 80;
const SESSION_UNAVAILABLE_MESSAGE = "Esta sessão não está mais disponível. Recarregue a página.";
const CHANGE_WHAT_MESSAGE = "Descreva a mudança (de 5 a 500 caracteres).";
const CHANGE_BEFORE_APPROVAL_MESSAGE = "Antes da aprovação, você mesmo edita o evento no formulário e salva.";
const SAVE_FALLBACK_MESSAGE = "Não foi possível salvar o evento.";
const DELETE_FALLBACK_MESSAGE = "Não foi possível excluir o evento.";
const CONFIRM_NAME_MESSAGE = "Digite o nome do evento para confirmar.";
const CONFIRM_NAME_MAX = 200;

type DeleteMode = "apagado" | "excluido";

export async function createOrganizerEvent(input: EventInput): Promise<ActionResult<{ id: string }>> {
  return runAction(() => createOrganizerEventOrThrow(input), "Não foi possível criar o evento.");
}

export async function updateOrganizerEvent(id: string, input: EventInput): Promise<ActionResult> {
  return runAction(() => updateOrganizerEventOrThrow(id, input), SAVE_FALLBACK_MESSAGE);
}

export async function submitEventForApproval(id: string): Promise<ActionResult> {
  return runAction(() => submitEventForApprovalOrThrow(id), "Não foi possível enviar o evento.");
}

export async function withdrawEventSubmission(id: string): Promise<ActionResult> {
  return runAction(() => withdrawEventSubmissionOrThrow(id), "Não foi possível voltar para rascunho.");
}

export async function setOrganizerEventSales(id: string, open: boolean): Promise<ActionResult> {
  return runAction(() => setOrganizerEventSalesOrThrow(id, open), "Não foi possível alterar as vendas.");
}

export async function setOrganizerSessionSales(sessionId: string, open: boolean): Promise<ActionResult> {
  return runAction(
    () => setOrganizerSessionSalesOrThrow(sessionId, open),
    "Não foi possível alterar as vendas da sessão.",
  );
}

export async function requestEventChange(id: string, input: EventChangeRequestInput): Promise<ActionResult> {
  return runAction(() => requestEventChangeOrThrow(id, input), "Não foi possível enviar o pedido.");
}

/**
 * "Excluir evento" (sem vendas). Sem nenhum pedido, apaga de vez (e os arquivos);
 * com pedidos expirados/cancelados, só some das telas. Deu certo: volta para Meus eventos.
 */
export async function deleteOwnEvent(
  eventId: string,
  confirmName: string,
): Promise<ActionResult<{ mode: DeleteMode }>> {
  const result = await runAction(() => deleteOwnEventOrThrow(eventId, confirmName), DELETE_FALLBACK_MESSAGE);
  if (result.ok) redirect("/organizador");
  return result;
}

/** "Pedir exclusão" (evento com vendas): as vendas pausam e o Espaço Byla decide. */
export async function requestEventDeletion(eventId: string, reason: string): Promise<ActionResult> {
  return runAction(() => requestEventDeletionOrThrow(eventId, reason), "Não foi possível enviar o pedido.");
}

function assertEventId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
}

/** Organizador logado e dono do evento (a equipe usa as próprias telas). */
async function requireOwnEvent(id: string): Promise<{ userId: string }> {
  const { userId } = await requireOrganizer();
  const { access } = await requireEventAccess(id);
  if (access !== "dono") throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
  return { userId };
}

async function assertSaveLimit(admin: Admin, userId: string) {
  if (!(await consumeRateLimit(admin, RATE_LIMITS.organizerSavePerUser, userId))) {
    throw new ActionError(RATE_LIMIT_MESSAGE);
  }
}

/** Erros ORG_* viram a mensagem combinada; o resto, a mensagem genérica da ação. */
function dbError(error: { code?: string; message: string }, fallback: string, area: string): ActionError {
  const message = organizerErrorMessage(error.message);
  if (!message) console.error(`[organizador] Falha em ${area}.`, error.code ?? "sem-codigo");
  return new ActionError(message ?? fallback);
}

/**
 * Slugs existentes lidos com a chave do servidor: a RLS esconde eventos de outros
 * organizadores, e a busca pelo cliente do usuário daria colisão.
 */
async function uniqueSlug(admin: Admin, name: string): Promise<string> {
  const base = slugify(name).slice(0, SLUG_BASE_MAX).replace(/-+$/, "") || "evento";
  const { data, error } = await admin.from("events").select("slug").like("slug", `${base}%`);
  if (error) throw new ActionError("Não foi possível definir o endereço do evento.");
  return resolveUniqueSlug(base, (data ?? []).map(({ slug }) => slug));
}

type EventRow = { slug: string; name: string; cover_image_url: string | null };

async function loadEvent(admin: Admin, id: string): Promise<EventRow | null> {
  const { data } = await admin
    .from("events")
    .select("slug, name, cover_image_url")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

async function currentSessionLabels(admin: Admin, eventId: string): Promise<Map<string, string>> {
  const { data } = await admin
    .from("event_sessions")
    .select("id, name, starts_at, ends_at")
    .eq("event_id", eventId)
    .is("archived_at", null);
  return new Map(
    (data ?? []).map((session) => [
      session.id,
      formatSessionLabel(session.name, session.starts_at, session.ends_at),
    ]),
  );
}

function revalidateOrganizerSurfaces(id: string) {
  revalidatePath("/organizador");
  revalidatePath(`/organizador/eventos/${id}`);
  revalidatePath("/equipe");
  revalidatePath(`/equipe/eventos/${id}`);
  revalidatePath("/equipe/aprovacoes");
}

function revalidatePublicSurfaces(slug: string | null | undefined) {
  revalidatePath("/");
  if (slug) revalidatePath(`/eventos/${slug}`);
}

async function createOrganizerEventOrThrow(input: EventInput): Promise<{ id: string }> {
  const { userId } = await requireOrganizer();
  const admin = createAdminClient();
  await assertSaveLimit(admin, userId);
  const normalized = normalizeEventInput(input);
  await assertCoverUploaded(normalized.coverImageUrl);
  await assertCoverNotShared(admin, normalized.coverImageUrl);
  const slug = await uniqueSlug(admin, normalized.name);

  // Nasce rascunho e com vendas fechadas: quem decide é a função do banco.
  const { data, error } = await admin.rpc("create_organizer_event", {
    p_actor: userId,
    p_slug: slug,
    p_name: normalized.name,
    p_venue: normalized.venue,
    p_description: normalized.description,
    p_cover_image_url: normalized.coverImageUrl,
    p_ticket_types: normalized.ticketTypes,
    p_sessions: normalized.sessions,
  });
  if (error || typeof data !== "string") {
    if (error && !organizerErrorMessage(error.message)) {
      console.error("[organizador] Falha ao criar o evento.", error.code ?? "sem-codigo");
    }
    throw new ActionError(saveErrorMessage(error?.message ?? "", sessionLabels(normalized.sessions)));
  }

  revalidateOrganizerSurfaces(data);
  return { id: data };
}

async function updateOrganizerEventOrThrow(id: string, input: EventInput): Promise<undefined> {
  assertEventId(id);
  const { userId } = await requireOwnEvent(id);
  const admin = createAdminClient();
  await assertSaveLimit(admin, userId);
  const normalized = normalizeEventInput(input);
  await assertCoverUploaded(normalized.coverImageUrl);
  await assertCoverNotShared(admin, normalized.coverImageUrl, id);
  const previous = await loadEvent(admin, id);

  const { error } = await admin.rpc("save_event_with_sessions", {
    p_event_id: id,
    p_name: normalized.name,
    p_venue: normalized.venue,
    p_description: normalized.description,
    p_cover_image_url: normalized.coverImageUrl,
    p_ticket_types: normalized.ticketTypes,
    p_sessions: normalized.sessions,
    p_staff_user_id: userId,
  });
  if (error) {
    const removed = error.message.includes("SESSAO_COM_VENDAS")
      ? await currentSessionLabels(admin, id)
      : undefined;
    const message = saveErrorMessage(error.message, sessionLabels(normalized.sessions), removed);
    if (message === SAVE_FALLBACK_MESSAGE) {
      console.error("[organizador] Falha ao salvar o evento.", error.code ?? "sem-codigo");
    }
    throw new ActionError(message);
  }

  await removeReplacedCover(admin, id, previous?.cover_image_url, normalized.coverImageUrl);

  revalidateOrganizerSurfaces(id);
  revalidatePublicSurfaces(previous?.slug);
}

/** Enviar e voltar para rascunho dividem o mesmo limite por conta. */
async function assertSubmitLimit(admin: Admin, userId: string) {
  if (!(await consumeRateLimit(admin, RATE_LIMITS.organizerSubmitPerUser, userId))) {
    throw new ActionError(RATE_LIMIT_MESSAGE);
  }
}

async function submitEventForApprovalOrThrow(id: string): Promise<undefined> {
  assertEventId(id);
  const { userId } = await requireOwnEvent(id);
  const admin = createAdminClient();
  await assertSubmitLimit(admin, userId);
  const { error } = await admin.rpc("submit_event_for_approval", { p_actor: userId, p_event_id: id });
  if (error) throw dbError(error, "Não foi possível enviar o evento.", "enviar para aprovação");

  const event = await loadEvent(admin, id);
  await notifyTeamEventSubmitted(admin, id, event?.name);
  revalidateOrganizerSurfaces(id);
}

async function withdrawEventSubmissionOrThrow(id: string): Promise<undefined> {
  assertEventId(id);
  const { userId } = await requireOwnEvent(id);
  const admin = createAdminClient();
  await assertSubmitLimit(admin, userId);
  const { error } = await admin.rpc("withdraw_event_submission", {
    p_actor: userId,
    p_event_id: id,
  });
  if (error) throw dbError(error, "Não foi possível voltar para rascunho.", "voltar para rascunho");
  revalidateOrganizerSurfaces(id);
}

async function setOrganizerEventSalesOrThrow(id: string, open: boolean): Promise<undefined> {
  assertEventId(id);
  if (typeof open !== "boolean") throw new ActionError("Valor inválido.");
  const { userId } = await requireOwnEvent(id);
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_event_sales_open", {
    p_actor: userId,
    p_event_id: id,
    p_open: open,
  });
  if (error) {
    throw dbError(
      error,
      open ? "Não foi possível reabrir as vendas." : "Não foi possível pausar as vendas.",
      "vendas do evento",
    );
  }

  revalidateOrganizerSurfaces(id);
  revalidatePublicSurfaces((await loadEvent(admin, id))?.slug);
}

async function setOrganizerSessionSalesOrThrow(sessionId: string, open: boolean): Promise<undefined> {
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId) || typeof open !== "boolean") {
    throw new ActionError("Sessão inválida.");
  }
  await requireOrganizer();
  const admin = createAdminClient();
  // O evento da sessão vem do banco, nunca do navegador.
  const { data: session } = await admin
    .from("event_sessions")
    .select("event_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.event_id) throw new ActionError(EVENT_NOT_FOUND_MESSAGE);
  const { userId } = await requireOwnEvent(session.event_id);

  const { error } = await admin.rpc("set_session_sales_open", {
    p_session_id: sessionId,
    p_open: open,
    p_staff_user_id: userId,
  });
  if (error) {
    if (error.message.includes("SESSAO_INDISPONIVEL")) throw new ActionError(SESSION_UNAVAILABLE_MESSAGE);
    throw dbError(
      error,
      open ? "Não foi possível reabrir as vendas da sessão." : "Não foi possível pausar as vendas da sessão.",
      "vendas da sessão",
    );
  }

  revalidateOrganizerSurfaces(session.event_id);
  revalidatePublicSurfaces((await loadEvent(admin, session.event_id))?.slug);
}

async function requestEventChangeOrThrow(id: string, input: EventChangeRequestInput): Promise<undefined> {
  assertEventId(id);
  const { userId } = await requireOwnEvent(id);
  const body = input && typeof input === "object" ? input : null;
  const what = parseChangeWhat(body?.what, body?.topic);
  if (!what.ok) throw new ActionError(CHANGE_WHAT_MESSAGE);
  const reason = parseReason(body?.reason);
  if (!reason.ok) throw new ActionError(reason.error);

  const admin = createAdminClient();
  const { error } = await admin.rpc("request_event_change", {
    p_actor: userId,
    p_event_id: id,
    p_what: what.value,
    p_reason: reason.value,
  });
  if (error) {
    if (error.message.includes("ORG_ESTADO:nao_aprovado")) {
      throw new ActionError(CHANGE_BEFORE_APPROVAL_MESSAGE);
    }
    throw dbError(error, "Não foi possível enviar o pedido.", "pedir mudança");
  }

  const event = await loadEvent(admin, id);
  await notifyTeam("equipe_pedido_organizador", {
    eventName: event?.name,
    requestKind: "mudanca",
    note: reason.value,
    link: organizerNoticeLink("/equipe/aprovacoes"),
  });
  revalidateOrganizerSurfaces(id);
}

/** Fotos da galeria do evento; `null` se não deu para ler (aí nenhum arquivo é apagado). */
async function galleryPaths(admin: Admin, eventId: string): Promise<string[] | null> {
  const { data, error } = await admin.from("event_images").select("storage_path").eq("event_id", eventId);
  if (error || !Array.isArray(data)) return null;
  return data.map(({ storage_path }) => storage_path).filter((path) => isGalleryPathForEvent(path, eventId));
}

async function deleteOwnEventOrThrow(id: string, confirmName: unknown): Promise<{ mode: DeleteMode }> {
  assertEventId(id);
  const { userId } = await requireOwnEvent(id);
  const name = typeof confirmName === "string" ? confirmName.trim() : "";
  if (!name || name.length > CONFIRM_NAME_MAX) throw new ActionError(CONFIRM_NAME_MESSAGE);
  const admin = createAdminClient();

  // Lidos antes: depois de apagado, o evento e as fotos já não existem no banco.
  const [event, photos] = await Promise.all([loadEvent(admin, id), galleryPaths(admin, id)]);

  const { data, error } = await admin.rpc("delete_own_event", {
    p_actor: userId,
    p_event_id: id,
    p_confirm_name: name,
  });
  if (error) throw dbError(error, DELETE_FALLBACK_MESSAGE, "excluir evento");
  if (data !== "apagado" && data !== "excluido") {
    console.error("[organizador] Resposta inesperada ao excluir o evento.");
    throw new ActionError(DELETE_FALLBACK_MESSAGE);
  }

  if (data === "apagado") {
    if (photos) await removeMediaObjects(photos);
    else console.error("[organizador] Fotos do evento apagado não foram lidas; arquivos mantidos.");
    await removeReplacedCover(admin, id, event?.cover_image_url, null);
  }

  revalidateOrganizerSurfaces(id);
  revalidatePublicSurfaces(event?.slug);
  return { mode: data };
}

async function requestEventDeletionOrThrow(id: string, reason: unknown): Promise<undefined> {
  assertEventId(id);
  const { userId } = await requireOwnEvent(id);
  const parsed = parseReason(reason);
  if (!parsed.ok) throw new ActionError(parsed.error);

  const admin = createAdminClient();
  const { error } = await admin.rpc("request_event_deletion", {
    p_actor: userId,
    p_event_id: id,
    p_reason: parsed.value,
  });
  if (error) throw dbError(error, "Não foi possível enviar o pedido.", "pedir exclusão");

  const event = await loadEvent(admin, id);
  await notifyTeam("equipe_pedido_organizador", {
    eventName: event?.name,
    requestKind: "exclusao",
    note: parsed.value,
    link: organizerNoticeLink("/equipe/aprovacoes"),
  });
  revalidateOrganizerSurfaces(id);
  revalidatePublicSurfaces(event?.slug);
}
