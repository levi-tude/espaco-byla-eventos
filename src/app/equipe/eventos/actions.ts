"use server";

import { revalidatePath } from "next/cache";

import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";
import { createPublicToken } from "@/lib/domain/tickets";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export type EventInput = {
  name: string;
  startsAt: string;
  venue: string;
  description: string;
  capacity: number;
  fullPriceCents: number;
  halfPriceCents: number;
  coverImageUrl?: string | null;
};

function normalizeInput(input: EventInput): EventInput {
  const normalized = {
    ...input,
    name: input.name.trim(),
    venue: input.venue.trim(),
    description: input.description.trim(),
    coverImageUrl: input.coverImageUrl?.trim() || null,
  };

  if (!normalized.name || !normalized.venue || !normalized.startsAt) {
    throw new Error("Preencha nome, data e local do evento.");
  }

  if (!Number.isInteger(normalized.capacity) || normalized.capacity <= 0) {
    throw new Error("Informe uma capacidade válida.");
  }

  if (
    !Number.isInteger(normalized.fullPriceCents) ||
    normalized.fullPriceCents < 0 ||
    !Number.isInteger(normalized.halfPriceCents) ||
    normalized.halfPriceCents < 0
  ) {
    throw new Error("Informe preços válidos.");
  }

  const startsAt = new Date(normalized.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Informe uma data e hora válidas.");
  }

  if (normalized.coverImageUrl) {
    try {
      new URL(normalized.coverImageUrl);
    } catch {
      throw new Error("Informe uma URL válida para a capa.");
    }
  }

  return { ...normalized, startsAt: startsAt.toISOString() };
}

async function uniqueSlug(name: string) {
  const supabase = await createServerClient();
  const base = slugify(name);
  const { data, error } = await supabase
    .from("events")
    .select("slug")
    .like("slug", `${base}%`);

  if (error) {
    throw new Error("Não foi possível definir o endereço do evento.");
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
    throw new Error("Evento não encontrado.");
  }

  return data.slug;
}

function revalidateEventSurfaces(id: string, slug: string) {
  revalidatePath("/");
  revalidatePath("/equipe");
  revalidatePath(`/equipe/eventos/${id}`);
  revalidatePath(`/eventos/${slug}`);
}

async function assertStaff(): Promise<void> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("is_staff");
  if (error || !data) throw new Error("Acesso restrito à equipe.");
}

export async function createEvent(input: EventInput): Promise<{ id: string }> {
  const normalized = normalizeInput(input);
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
      cover_image_url: normalized.coverImageUrl,
    })
    .select("id")
    .single();

  if (eventError) {
    throw new Error("Não foi possível criar o evento.");
  }

  const { error: ticketTypesError } = await supabase.from("ticket_types").insert([
    {
      event_id: event.id,
      kind: "inteira",
      price_cents: normalized.fullPriceCents,
    },
    {
      event_id: event.id,
      kind: "meia",
      price_cents: normalized.halfPriceCents,
    },
    {
      event_id: event.id,
      kind: "cortesia",
      price_cents: 0,
      active: true,
    },
  ]);

  if (ticketTypesError) {
    await supabase.from("events").delete().eq("id", event.id);
    throw new Error("Não foi possível criar os tipos de ingresso.");
  }

  revalidateEventSurfaces(event.id, slug);
  return { id: event.id };
}

export async function updateEvent(
  id: string,
  input: EventInput,
): Promise<void> {
  const normalized = normalizeInput(input);
  await assertStaff();
  const admin = createAdminClient();
  const { error: eventError } = await admin.rpc("update_event_with_capacity", {
    p_event_id: id,
    p_name: normalized.name,
    p_starts_at: normalized.startsAt,
    p_venue: normalized.venue,
    p_description: normalized.description,
    p_capacity: normalized.capacity,
    p_cover_image_url: normalized.coverImageUrl ?? null,
    p_full_price_cents: normalized.fullPriceCents,
    p_half_price_cents: normalized.halfPriceCents,
  });

  if (eventError) {
    if (eventError.message.includes("capacidade não pode ser menor")) {
      throw new Error(
        "A capacidade não pode ser menor que os ingressos já reservados.",
      );
    }
    throw new Error("Não foi possível salvar o evento.");
  }

  const slug = await getEventSlug(id);
  revalidateEventSurfaces(id, slug);
}

export async function setSalesOpen(id: string, open: boolean): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("events")
    .update({ sales_open: open, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(
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

export async function issueCourtesy(input: CourtesyInput): Promise<void> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!input.eventId || !name || !email.includes("@")) {
    throw new Error("Preencha nome e e-mail válidos.");
  }

  await assertStaff();
  const slug = await getEventSlug(input.eventId);
  const admin = createAdminClient();
  const { error } = await admin.rpc("issue_courtesy_ticket", {
    p_event_id: input.eventId,
    p_buyer_name: name,
    p_buyer_email: email,
    p_public_token: createPublicToken(),
  });

  if (error) {
    if (error.message.includes("Capacidade esgotada")) {
      throw new Error("Capacidade esgotada para este evento.");
    }
    throw new Error("Não foi possível emitir o ingresso de cortesia.");
  }

  revalidateEventSurfaces(input.eventId, slug);
}

export async function cancelTicket(
  eventId: string,
  ticketId: string,
): Promise<void> {
  if (!eventId || !ticketId) throw new Error("Ingresso inválido.");

  const supabase = await createServerClient();
  const { data: ticket, error } = await supabase
    .from("tickets")
    .update({
      status: "cancelado",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .eq("status", "pago")
    .select("id")
    .maybeSingle();

  if (error) throw new Error("Não foi possível cancelar o ingresso.");
  if (!ticket) {
    throw new Error("Somente ingressos pagos e sem check-in podem ser cancelados.");
  }

  const slug = await getEventSlug(eventId);
  revalidateEventSurfaces(eventId, slug);
}
