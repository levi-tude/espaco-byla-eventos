import { requestImageUpload, type UploadTarget } from "@/app/equipe/eventos/media-actions";
import { resizeImage } from "@/lib/media/resize";
import {
  IMAGE_TOO_LARGE_MESSAGE,
  INVALID_IMAGE_TYPE_MESSAGE,
  isImageContentType,
  MAX_IMAGE_BYTES,
  MEDIA_BUCKET,
  UPLOAD_FAILED_MESSAGE,
} from "@/lib/media/rules";
import { createClient } from "@/lib/supabase/client";

export type UploadOutcome = { ok: true; path: string } | { ok: false; error: string };

/** Reduz a foto, pede autorização ao servidor e envia direto ao armazenamento. */
export async function uploadImage(
  file: File,
  target: UploadTarget,
  eventId?: string,
): Promise<UploadOutcome> {
  if (!isImageContentType(file.type)) return { ok: false, error: INVALID_IMAGE_TYPE_MESSAGE };

  try {
    const blob = await resizeImage(file);
    if (blob.size > MAX_IMAGE_BYTES) return { ok: false, error: IMAGE_TOO_LARGE_MESSAGE };

    const ticket = await requestImageUpload(target, blob.type, eventId);
    if (!ticket.ok) return ticket;

    const { error } = await createClient()
      .storage.from(MEDIA_BUCKET)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, blob, {
        contentType: blob.type,
      });
    if (error) return { ok: false, error: UPLOAD_FAILED_MESSAGE };

    return { ok: true, path: ticket.data.path };
  } catch {
    return { ok: false, error: UPLOAD_FAILED_MESSAGE };
  }
}
