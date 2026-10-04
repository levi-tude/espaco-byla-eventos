"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { assertStaff } from "@/lib/auth/staff";
import { requireStaffUser } from "@/lib/auth/staff-user";
import { formatSessionLabel } from "@/lib/datetime";
import { quotaDbErrorMessage } from "@/lib/domain/quotas";
import {
  mirrorPrices,
  normalizeSessions,
  sessionErrorLabel,
  type SessionInput,
  type SessionRpcItem,
  sessionsDbErrorMessage,
  type SessionTypeInfo,
} from "@/lib/domain/session-editor";
import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";
import {
  normalizeTicketTypes,
  presetDefinition,
  TICKET_TYPE_LIMITS,
  type TicketTypeInput,
  type TicketTypeRpcItem,
  ticketTypesErrorMessage,
} from "@/lib/domain/ticket-types";
import { createPublicToken } from "@/lib/domain/tickets";
import { coverPathFromUrl, isOwnMediaUrl } from "@/lib/media/paths";
import { COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";
import { mediaObjectExists, removeMediaObjects } from "@/lib/media/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventInput = {
  name: string;
  venue: string;
  description: string;
  /**
   * Tipos à venda na ordem de exibição; a cortesia o banco garante sozinho. O preço
   * e o limite de cada tipo vêm das sessões (os daqui são ignorados).
   */
  ticketTypes: TicketTypeInput[];
  /** Sessões ativas na ordem da tela; preços por `typeIndex` (posição em `ticketTypes`). */
  sessions: SessionInput[];
  coverImageUrl?: string | null;
};

type NormalizedEventInput = {
  name: string;
  venue: string;
  description: string;
  coverImageUrl: string | null;
  ticketTypes: TicketTypeRpcItem[];
  sessions: SessionRpcItem[];
};

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Nome, categoria e pessoas de cada tipo, para validar preços e limites por sessão. */
function sessionTypeInfos(types: unknown): SessionTypeInfo[] {
  if (!Array.isArray(types) || types.length === 0) {
    throw new ActionError("Marque pelo menos um tipo de ingresso para vender.");
  }
  return types.map((raw) => {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const definition = item.preset == null ? null : presetDefinition(item.preset);
    if (definition) {
      return { name: definition.name, kind: definition.kind, peoplePerUnit: definition.peoplePerUnit };
    }
    const people = item.peoplePerUnit;
    if (
      item.preset != null ||
      typeof people !== "number" ||
      !Number.isInteger(people) ||
      people < 1 ||
      people > TICKET_TYPE_LIMITS.maxPeoplePerUnit
    ) {
      throw new ActionError("Tipo de ingresso inválido.");
    }
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "tipo novo";
    return { name, kind: "inteira", peoplePerUnit: people };
  });
}

function normalizeInput(input: EventInput): NormalizedEventInput {
  if (!input || typeof input !== "object") throw new ActionError("Dados inválidos.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const venue = typeof input.venue === "string" ? input.venue.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const coverImageUrl =
    typeof input.coverImageUrl === "string" ? input.coverImageUrl.trim() || null : null;

  if (!name || !venue) {
    throw new ActionError("Preencha nome e local do evento.");
  }

  const infos = sessionTypeInfos(input.ticketTypes);
  const sessions = normalizeSessions(input.sessions, infos);
  if (!sessions.ok) throw new ActionError(sessions.error);

  const mirror = mirrorPrices(sessions.items, infos.length);
  const missing = mirror.findIndex((price) => price === null);
  if (missing >= 0) {
    throw new ActionError(`Informe o preço de “${infos[missing].name}” em pelo menos uma sessão.`);
  }
  const ticketTypes = normalizeTicketTypes(
    input.ticketTypes.map((type, index) => ({ ...type, priceCents: mirror[index], maxUnits: null })),
  );
  if (!ticketTypes.ok) throw new ActionError(ticketTypes.error);

  if (coverImageUrl && !isHttpsUrl(coverImageUrl)) {
    throw new ActionError("Informe uma URL válida para a capa.");
  }

  return {
    name,
    venue,
    description,
    coverImageUrl,
    ticketTypes: ticketTypes.items,
    sessions: sessions.items,
  };
}

function sessionLabels(sessions: SessionRpcItem[]): string[] {
  return sessions.map((session, index) => sessionErrorLabel(index, sessions.length, session.starts_at));
}

/** Rótulo das sessões atuais do evento, para explicar uma remoção recusada. */
async function currentSessionLabels(eventId: string): Promise<Map<string, string>> {
  const { data } = await createAdminClient()
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

function saveErrorMessage(message: string, labels: string[], removed?: Map<string, string>): string {
  return (
    sessionsDbErrorMessage(message, labels, removed) ??
    quotaDbErrorMessage(message) ??
    ticketTypesErrorMessage(message) ??
    "Não foi possível salvar o evento."
  );
}

async function uniqueSlug(name: string) {
  const supabase = await createServerClient();
  const base = slugify(name);
  const { data, error } = await supabase
    .from("events")
    .select("slug")
    .like("slug", `${base}%`);

  if (error) {
    throw new ActionError("Não foi possível definir o endereço do evento.");
  }

  return resolveUniqueSlug(base, data.map(({ slug }) => slug));
}

async function getEventSlug(id: string): Promise<string> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("events")
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  if (error || !data?.slug) {
    throw new ActionError("Evento não encontrado.");
  }

  return data.slug;
}

function revalidateEventSurfaces(id: string, slug: string) {
  revalidatePath("/");
  revalidatePath("/equipe");
  revalidatePath(`/equipe/eventos/${id}`);
  revalidatePath(`/eventos/${slug}`);
}

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!;
}

/** Capa do nosso armazenamento precisa ser de `covers/` e existir de fato. */
async function assertCoverUploaded(coverImageUrl: string | null | undefined) {
  if (!coverImageUrl || !isOwnMediaUrl(supabaseUrl(), coverImageUrl)) return;
  const path = coverPathFromUrl(supabaseUrl(), coverImageUrl);
  if (!path || !(await mediaObjectExists(path))) {
    throw new ActionError(COVER_NOT_FOUND_MESSAGE);
  }
}

export async function createEvent(
  input: EventInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction(() => createEventOrThrow(input), "Não foi possível criar o evento.");
}

export async function updateEvent(id: string, input: EventInput): Promise<ActionResult> {
  return runAction(() => updateEventOrThrow(id, input), "Não foi possível salvar o evento.");
}

export async function setSalesOpen(id: string, open: boolean): Promise<ActionResult> {
  return runAction(() => setSalesOpenOrThrow(id, open), "Não foi possível alterar a venda.");
}

export async function setSessionSalesOpen(
  sessionId: string,
  open: boolean,
): Promise<ActionResult> {
  return runAction(
    () => setSessionSalesOpenOrThrow(sessionId, open),
    "Não foi possível alterar a venda da sessão.",
  );
}

export async function issueCourtesy(
  input: CourtesyInput,
): Promise<ActionResult<{ publicToken: string }>> {
  return runAction(
    () => issueCourtesyOrThrow(input),
    "Não foi possível emitir o ingresso de cortesia.",
  );
}

export async function cancelTicket(eventId: string, ticketId: string): Promise<ActionResult> {
  return runAction(
    () => cancelTicketOrThrow(eventId, ticketId),
    "Não foi possível cancelar o ingresso.",
  );
}

async function createEventOrThrow(input: EventInput): Promise<{ id: string }> {
  const { userId } = await requireStaffUser();
  const normalized = normalizeInput(input);
  await assertCoverUploaded(normalized.coverImageUrl);
  const supabase = await createServerClient();
  const slug = await uniqueSlug(normalized.name);
  const first = [...normalized.sessions].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
  )[0];

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      name: normalized.name,
      slug,
      starts_at: first.starts_at,
      venue: normalized.venue,
      description: normalized.description,
      capacity: first.capacity,
      inteira_quota: first.inteira_quota,
      meia_quota: first.meia_quota,
      cover_image_url: normalized.coverImageUrl,
      sales_open: true,
    })
    .select("id")
    .single();

  if (eventError) {
    throw new ActionError("Não foi possível criar o evento.");
  }

  // Tipos e sessões só são gravados pela função do banco (service_role), que também
  // cria a cortesia; evento, tipos e sessões mudam juntos.
  const { error: saveError } = await createAdminClient().rpc("save_event_with_sessions", {
    p_event_id: event.id,
    p_name: normalized.name,
    p_venue: normalized.venue,
    p_description: normalized.description,
    p_cover_image_url: normalized.coverImageUrl,
    p_ticket_types: normalized.ticketTypes,
    p_sessions: normalized.sessions,
    p_staff_user_id: userId,
  });

  if (saveError) {
    await supabase.from("events").delete().eq("id", event.id);
    throw new ActionError(saveErrorMessage(saveError.message, sessionLabels(normalized.sessions)));
  }

  revalidateEventSurfaces(event.id, slug);
  return { id: event.id };
}

async function updateEventOrThrow(id: string, input: EventInput): Promise<undefined> {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new ActionError("Evento não encontrado.");
  }
  const { userId } = await requireStaffUser();
  const normalized = normalizeInput(input);
  await assertCoverUploaded(normalized.coverImageUrl);
  const admin = createAdminClient();
  const { data: previous } = await admin
    .from("events")
    .select("cover_image_url")
    .eq("id", id)
    .maybeSingle();
  const { error: eventError } = await admin.rpc("save_event_with_sessions", {
    p_event_id: id,
    p_name: normalized.name,
    p_venue: normalized.venue,
    p_description: normalized.description,
    p_cover_image_url: normalized.coverImageUrl,
    p_ticket_types: normalized.ticketTypes,
    p_sessions: normalized.sessions,
    p_staff_user_id: userId,
  });

  if (eventError) {
    const removed = eventError.message.includes("SESSAO_COM_VENDAS")
      ? await currentSessionLabels(id)
      : undefined;
    throw new ActionError(
      saveErrorMessage(eventError.message, sessionLabels(normalized.sessions), removed),
    );
  }

  const previousCoverPath = coverPathFromUrl(supabaseUrl(), previous?.cover_image_url);
  if (previousCoverPath && previous?.cover_image_url !== normalized.coverImageUrl) {
    await removeMediaObjects([previousCoverPath]);
  }

  const slug = await getEventSlug(id);
  revalidateEventSurfaces(id, slug);
}

async function setSalesOpenOrThrow(id: string, open: boolean): Promise<undefined> {
  await assertStaff();
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("events")
    .update({ sales_open: open, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new ActionError(
      open ? "Não foi possível abrir a venda." : "Não foi possível fechar a venda.",
    );
  }

  const slug = await getEventSlug(id);
  revalidateEventSurfaces(id, slug);
}

async function setSessionSalesOpenOrThrow(sessionId: string, open: boolean): Promise<undefined> {
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId) || typeof open !== "boolean") {
    throw new ActionError("Sessão inválida.");
  }
  const { userId } = await requireStaffUser();
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_session_sales_open", {
    p_session_id: sessionId,
    p_open: open,
    p_staff_user_id: userId,
  });
  if (error) {
    if (error.message.includes("SESSAO_INDISPONIVEL")) {
      throw new ActionError("Esta sessão não está mais disponível. Recarregue a página.");
    }
    throw new ActionError(
      open ? "Não foi possível reabrir as vendas da sessão." : "Não foi possível encerrar as vendas da sessão.",
    );
  }

  const { data: session } = await admin
    .from("event_sessions")
    .select("event_id, events(slug)")
    .eq("id", sessionId)
    .maybeSingle();
  const event = Array.isArray(session?.events) ? session.events[0] : session?.events;
  if (session?.event_id && event?.slug) revalidateEventSurfaces(session.event_id, event.slug);
}

export type CourtesyInput = {
  eventId: string;
  name: string;
  email: string;
  /** Obrigatória em evento de várias sessões; em sessão única o banco usa a única. */
  sessionId?: string | null;
};

async function issueCourtesyOrThrow(
  input: CourtesyInput,
): Promise<{ publicToken: string }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (typeof input.eventId !== "string" || !UUID_PATTERN.test(input.eventId) || !name || !email.includes("@")) {
    throw new ActionError("Preencha nome e e-mail válidos.");
  }
  const sessionId = input.sessionId ?? null;
  if (sessionId !== null && (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId))) {
    throw new ActionError("Escolha a sessão da cortesia.");
  }

  await assertStaff();
  const slug = await getEventSlug(input.eventId);
  const publicToken = createPublicToken();
  const admin = createAdminClient();
  const { error } = await admin.rpc("issue_courtesy_ticket", {
    p_event_id: input.eventId,
    p_buyer_name: name,
    p_buyer_email: email,
    p_public_token: publicToken,
    ...(sessionId ? { p_session_id: sessionId } : {}),
  });

  if (error) {
    if (error.message.includes("Capacidade esgotada")) {
      throw new ActionError(
        sessionId ? "Capacidade esgotada nesta sessão." : "Capacidade esgotada para este evento.",
      );
    }
    if (error.message.includes("SESSAO_INDISPONIVEL")) {
      throw new ActionError(
        sessionId
          ? "Esta sessão não está disponível para cortesia."
          : "Escolha a sessão da cortesia.",
      );
    }
    throw new ActionError("Não foi possível emitir o ingresso de cortesia.");
  }

  revalidateEventSurfaces(input.eventId, slug);
  return { publicToken };
}

async function cancelTicketOrThrow(eventId: string, ticketId: string): Promise<undefined> {
  if (
    typeof eventId !== "string" ||
    typeof ticketId !== "string" ||
    !UUID_PATTERN.test(eventId) ||
    !UUID_PATTERN.test(ticketId)
  ) {
    throw new ActionError("Ingresso inválido.");
  }

  const { userId } = await requireStaffUser();
  const { data, error } = await createAdminClient().rpc("cancel_courtesy_ticket", {
    p_event_id: eventId,
    p_ticket_id: ticketId,
    p_staff_user_id: userId,
  });

  if (error) throw new ActionError("Não foi possível cancelar o ingresso.");
  if (data !== "cancelled") {
    throw new ActionError(
      "Só cortesias sem check-in podem ser canceladas. Ingresso pago se resolve com “Estornar pedido”.",
    );
  }

  const slug = await getEventSlug(eventId);
  revalidateEventSurfaces(eventId, slug);
}
