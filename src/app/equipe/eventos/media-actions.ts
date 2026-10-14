"use server";

import { revalidatePath } from "next/cache";

import { ActionError, type ActionResult, runAction } from "@/lib/action-result";
import { requireActor, requireEventAccess } from "@/lib/auth/actor";
import {
  buildCoverPath,
  buildGalleryPath,
  isGalleryPathForEvent,
  publicMediaUrl,
} from "@/lib/media/paths";
import {
  GALLERY_FULL_MESSAGE,
  INVALID_IMAGE_TYPE_MESSAGE,
  isImageContentType,
  isUuid,
  MAX_GALLERY_IMAGES,
} from "@/lib/media/rules";
import {
  createUploadToken,
  mediaObjectExists,
  removeMediaObjects,
} from "@/lib/media/storage";
import { consumeRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type UploadTarget = "cover" | "gallery";
export type UploadTicket = { path: string; token: string };

type Admin = ReturnType<typeof createAdminClient>;

export async function requestImageUpload(
  target: UploadTarget,
  contentType: string,
  eventId?: string,
): Promise<ActionResult<UploadTicket>> {
  return runAction(
    () => requestImageUploadOrThrow(target, contentType, eventId),
    "Não foi possível preparar o envio da foto.",
  );
}

export async function addEventImage(
  eventId: string,
  path: string,
): Promise<ActionResult<{ id: string; url: string }>> {
  return runAction(
    () => addEventImageOrThrow(eventId, path),
    "Não foi possível adicionar a foto.",
  );
}

export async function removeEventImage(
  eventId: string,
  imageId: string,
): Promise<ActionResult> {
  return runAction(
    () => removeEventImageOrThrow(eventId, imageId),
    "Não foi possível remover a foto.",
  );
}

async function requireEventSlug(admin: Admin, eventId: string): Promise<string> {
  const { data, error } = await admin
    .from("events")
    .select("slug")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ActionError("Evento não encontrado.");
  return data.slug;
}

async function galleryCount(admin: Admin, eventId: string): Promise<number> {
  const { count, error } = await admin
    .from("event_images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function revalidateGallery(eventId: string, slug: string) {
  revalidatePath(`/equipe/eventos/${eventId}`);
  revalidatePath(`/organizador/eventos/${eventId}`);
  revalidatePath(`/eventos/${slug}`);
}

async function requestImageUploadOrThrow(
  target: UploadTarget,
  contentType: string,
  eventId?: string,
): Promise<UploadTicket> {
  if (target === "cover") {
    // A capa ainda não tem evento (evento novo): basta estar logado na equipe ou como organizador.
    const actor = await requireActor();
    if (!isImageContentType(contentType)) throw new ActionError(INVALID_IMAGE_TYPE_MESSAGE);
    if (
      actor.kind === "organizador" &&
      !(await consumeRateLimit(createAdminClient(), RATE_LIMITS.organizerUploadPerUser, actor.userId))
    ) {
      throw new ActionError(RATE_LIMIT_MESSAGE);
    }
    const path = buildCoverPath(contentType);
    return { path, token: await createUploadToken(path) };
  }

  if (target !== "gallery" || !isUuid(eventId)) throw new ActionError("Evento inválido.");
  const { actor } = await requireEventAccess(eventId);
  if (!isImageContentType(contentType)) throw new ActionError(INVALID_IMAGE_TYPE_MESSAGE);
  const admin = createAdminClient();
  // O limite de 10 fotos conta registros, não arquivos enviados: sem isto, envios órfãos lotam o bucket.
  if (
    actor.kind === "organizador" &&
    !(await consumeRateLimit(admin, RATE_LIMITS.organizerUploadPerUser, actor.userId))
  ) {
    throw new ActionError(RATE_LIMIT_MESSAGE);
  }
  await requireEventSlug(admin, eventId);
  if ((await galleryCount(admin, eventId)) >= MAX_GALLERY_IMAGES) {
    throw new ActionError(GALLERY_FULL_MESSAGE);
  }
  const path = buildGalleryPath(eventId, contentType);
  return { path, token: await createUploadToken(path) };
}

async function addEventImageOrThrow(
  eventId: string,
  path: string,
): Promise<{ id: string; url: string }> {
  if (!isUuid(eventId) || typeof path !== "string" || !isGalleryPathForEvent(path, eventId)) {
    throw new ActionError("Foto inválida.");
  }
  await requireEventAccess(eventId);

  const admin = createAdminClient();
  const slug = await requireEventSlug(admin, eventId);
  if (!(await mediaObjectExists(path))) {
    throw new ActionError("A foto não chegou ao servidor. Tente de novo.");
  }

  const { data, error } = await admin
    .from("event_images")
    .insert({ event_id: eventId, storage_path: path })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") throw new ActionError("Esta foto já foi adicionada.");
    await removeMediaObjects([path]);
    if (error.message.includes("Limite de 10 fotos")) throw new ActionError(GALLERY_FULL_MESSAGE);
    throw new Error(error.message);
  }

  revalidateGallery(eventId, slug);
  return {
    id: data.id,
    url: publicMediaUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, path),
  };
}

async function removeEventImageOrThrow(eventId: string, imageId: string): Promise<undefined> {
  if (!isUuid(eventId) || !isUuid(imageId)) throw new ActionError("Foto inválida.");
  await requireEventAccess(eventId);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_images")
    .delete()
    .eq("id", imageId)
    .eq("event_id", eventId)
    .select("storage_path")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ActionError("Foto não encontrada.");

  await removeMediaObjects([data.storage_path]);
  revalidateGallery(eventId, await requireEventSlug(admin, eventId));
}
