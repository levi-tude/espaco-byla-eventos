"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { assertStaff } from "@/lib/auth/staff";
import { parseEventInputValue } from "@/lib/datetime";
import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";
import {
  normalizeTicketTypes,
  type TicketTypeInput,
  type TicketTypeRpcItem,
  ticketTypesErrorMessage,
} from "@/lib/domain/ticket-types";
import { quotaDbErrorMessage, quotasError } from "@/lib/domain/quotas";
import { createPublicToken } from "@/lib/domain/tickets";
import { limitedTypesFromRpcItems, typeLimitsError } from "@/lib/domain/type-limits";
import { coverPathFromUrl, isOwnMediaUrl } from "@/lib/media/paths";
import { COVER_NOT_FOUND_MESSAGE } from "@/lib/media/rules";
import { mediaObjectExists, removeMediaObjects } from "@/lib/media/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export type EventInput = {
  name: string;
  startsAt: string;
  venue: string;
  description: string;
  capacity: number;
  /** Cotas opcionais em ingressos (`null` = sem quantidade separada). */
  inteiraQuota: number | null;
  meiaQuota: number | null;
  /** Tipos à venda na ordem de exibição; a cortesia o banco garante sozinho. */
  ticketTypes: TicketTypeInput[];
  coverImageUrl?: string | null;
};

type NormalizedEventInput = Omit<EventInput, "ticketTypes"> & {
  ticketTypes: TicketTypeRpcItem[];
};

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeInput(input: EventInput): NormalizedEventInput {
  const normalized = {
    ...input,
    name: input.name.trim(),
    venue: input.venue.trim(),
    description: input.description.trim(),
    coverImageUrl: input.coverImageUrl?.trim() || null,
  };

  if (!normalized.name || !normalized.venue || !normalized.startsAt) {
    throw new ActionError("Preencha nome, data e local do evento.");
  }

  if (!Number.isInteger(normalized.capacity) || normalized.capacity <= 0) {
    throw new ActionError("Informe uma capacidade válida.");
  }

  const quotas = { inteiraQuota: input.inteiraQuota, meiaQuota: input.meiaQuota };
  const quotaError = quotasError(normalized.capacity, quotas);
  if (quotaError) throw new ActionError(quotaError);

  const ticketTypes = normalizeTicketTypes(input.ticketTypes);
  if (!ticketTypes.ok) throw new ActionError(ticketTypes.error);
  const limitError = typeLimitsError(
    normalized.capacity,
    quotas,
    limitedTypesFromRpcItems(ticketTypes.items),
  );
  if (limitError) throw new ActionError(limitError);

  const startsAt = parseEventInputValue(normalized.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new ActionError("Informe uma data e hora válidas.");
  }

  if (normalized.coverImageUrl && !isHttpUrl(normalized.coverImageUrl)) {
    throw new ActionError("Informe uma URL válida para a capa.");
  }

  return {
    ...normalized,
    ...quotas,
    ticketTypes: ticketTypes.items,
    startsAt: startsAt.toISOString(),
  };
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
  await assertStaff();
  const normalized = normalizeInput(input);
  await assertCoverUploaded(normalized.coverImageUrl);
  const supabase = await createServerClient();
  const slug = await uniqueSlug(normalized.name);

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      name: normalized.name,
      slug,
      starts_at: normalized.startsAt,
      venue: normalized.venue,
      description: normalized.description,
      capacity: normalized.capacity,
      inteira_quota: normalized.inteiraQuota,
      meia_quota: normalized.meiaQuota,
      cover_image_url: normalized.coverImageUrl,
      sales_open: true,
    })
    .select("id")
    .single();

  if (eventError) {
    throw new ActionError("Não foi possível criar o evento.");
  }

  // Tipos só são gravados pela função do banco (service_role), que também cria a cortesia.
  const { error: ticketTypesError } = await createAdminClient().rpc(
    "save_event_ticket_types",
    { p_event_id: event.id, p_types: normalized.ticketTypes },
  );

  if (ticketTypesError) {
    await supabase.from("events").delete().eq("id", event.id);
    throw new ActionError(
      ticketTypesErrorMessage(ticketTypesError.message) ??
        "Não foi possível criar os tipos de ingresso.",
    );
  }

  revalidateEventSurfaces(event.id, slug);
  return { id: event.id };
}

async function updateEventOrThrow(id: string, input: EventInput): Promise<undefined> {
  const normalized = normalizeInput(input);
  await assertStaff();
  await assertCoverUploaded(normalized.coverImageUrl);
  const admin = createAdminClient();
  const { data: previous } = await admin
    .from("events")
    .select("cover_image_url")
    .eq("id", id)
    .maybeSingle();
  const { error: eventError } = await admin.rpc("update_event_with_capacity", {
    p_event_id: id,
    p_name: normalized.name,
    p_starts_at: normalized.startsAt,
    p_venue: normalized.venue,
    p_description: normalized.description,
    p_capacity: normalized.capacity,
    p_cover_image_url: normalized.coverImageUrl ?? null,
    p_ticket_types: normalized.ticketTypes,
    p_inteira_quota: normalized.inteiraQuota,
    p_meia_quota: normalized.meiaQuota,
  });

  if (eventError) {
    if (eventError.message.includes("capacidade não pode ser menor")) {
      throw new ActionError(
        "A capacidade não pode ser menor que os ingressos já reservados.",
      );
    }
    throw new ActionError(
      quotaDbErrorMessage(eventError.message) ??
        ticketTypesErrorMessage(eventError.message) ??
        "Não foi possível salvar o evento.",
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

export type CourtesyInput = {
  eventId: string;
  name: string;
  email: string;
};

async function issueCourtesyOrThrow(
  input: CourtesyInput,
): Promise<{ publicToken: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!input.eventId || !name || !email.includes("@")) {
    throw new ActionError("Preencha nome e e-mail válidos.");
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
  });

  if (error) {
    if (error.message.includes("Capacidade esgotada")) {
      throw new ActionError("Capacidade esgotada para este evento.");
    }
    throw new ActionError("Não foi possível emitir o ingresso de cortesia.");
  }

  revalidateEventSurfaces(input.eventId, slug);
  return { publicToken };
}

async function cancelTicketOrThrow(eventId: string, ticketId: string): Promise<undefined> {
  if (!eventId || !ticketId) throw new ActionError("Ingresso inválido.");

  await assertStaff();
  const supabase = await createServerClient();
  const { data: ticket, error } = await supabase
    .from("tickets")
    .update({
      status: "cancelado",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .eq("kind", "cortesia")
    .eq("status", "pago")
    .select("id")
    .maybeSingle();

  if (error) throw new ActionError("Não foi possível cancelar o ingresso.");
  if (!ticket) {
    throw new ActionError(
      "Só cortesias sem check-in podem ser canceladas. Ingresso pago se resolve com “Estornar pedido”.",
    );
  }

  const slug = await getEventSlug(eventId);
  revalidateEventSurfaces(eventId, slug);
}
