"use server";

import { revalidatePath } from "next/cache";

import { assertCapacityAvailable } from "@/lib/domain/capacity";
import { countsTowardCapacity } from "@/lib/domain/status";
import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";
import { createPublicToken, createTicketCode } from "@/lib/domain/tickets";
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
  const supabase = await createServerClient();

  const { error: eventError } = await supabase
    .from("events")
    .update({
      name: normalized.name,
      starts_at: normalized.startsAt,
      venue: normalized.venue,
      description: normalized.description,
      capacity: normalized.capacity,
      cover_image_url: normalized.coverImageUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (eventError) {
    throw new Error("Não foi possível salvar o evento.");
  }

  const { error: ticketTypesError } = await supabase
    .from("ticket_types")
    .upsert(
      [
        {
          event_id: id,
          kind: "inteira",
          price_cents: normalized.fullPriceCents,
          active: true,
        },
        {
          event_id: id,
          kind: "meia",
          price_cents: normalized.halfPriceCents,
          active: true,
        },
        {
          event_id: id,
          kind: "cortesia",
          price_cents: 0,
          active: true,
        },
      ],
      { onConflict: "event_id,kind" },
    );

  if (ticketTypesError) {
    throw new Error("Evento salvo, mas os preços não foram atualizados.");
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

  const supabase = await createServerClient();
  const [
    { data: event, error: eventError },
    { data: ticketType, error: typeError },
    { data: tickets, error: ticketsError },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, capacity")
      .eq("id", input.eventId)
      .maybeSingle(),
    supabase
      .from("ticket_types")
      .select("id")
      .eq("event_id", input.eventId)
      .eq("kind", "cortesia")
      .eq("active", true)
      .maybeSingle(),
    supabase.from("tickets").select("status").eq("event_id", input.eventId),
  ]);

  if (eventError || !event) throw new Error("Evento não encontrado.");
  if (typeError || !ticketType) {
    throw new Error("Cortesia indisponível para este evento.");
  }
  if (ticketsError) {
    throw new Error("Não foi possível verificar a capacidade do evento.");
  }

  const occupied = (tickets ?? []).filter(({ status }) =>
    countsTowardCapacity(status),
  ).length;
  assertCapacityAvailable(occupied, event.capacity, 1);

  const now = new Date().toISOString();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      event_id: event.id,
      buyer_name: name,
      buyer_email: email,
      total_cents: 0,
      status: "pago",
      paid_at: now,
      public_token: createPublicToken(),
      payment_provider: "cortesia_interna",
    })
    .select("id")
    .single();

  if (orderError) throw new Error("Não foi possível registrar a cortesia.");

  const { error: ticketError } = await supabase.from("tickets").insert({
    order_id: order.id,
    event_id: event.id,
    ticket_type_id: ticketType.id,
    kind: "cortesia",
    status: "pago",
    code: createTicketCode(),
    buyer_name: name,
    price_cents: 0,
  });

  if (ticketError) {
    await supabase.from("orders").delete().eq("id", order.id);
    throw new Error("Não foi possível emitir o ingresso de cortesia.");
  }

  revalidateEventSurfaces(event.id, event.slug);
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
