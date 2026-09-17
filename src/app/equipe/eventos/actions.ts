"use server";

import { revalidatePath } from "next/cache";

import { resolveUniqueSlug, slugify } from "@/lib/domain/slug";
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
