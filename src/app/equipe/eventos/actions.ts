"use server";

import { revalidatePath } from "next/cache";

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

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "evento"
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
    throw new Error("Não foi possível definir o endereço do evento.");
  }

  const existing = new Set(data.map(({ slug }) => slug));
  if (!existing.has(base)) return base;

  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
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

  revalidatePath("/");
  revalidatePath("/equipe");
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

  revalidatePath("/");
  revalidatePath(`/eventos`);
  revalidatePath("/equipe");
  revalidatePath(`/equipe/eventos/${id}`);
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

  revalidatePath("/");
  revalidatePath("/equipe");
  revalidatePath(`/equipe/eventos/${id}`);
}
