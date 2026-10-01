"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { addEventImage, removeEventImage } from "@/app/equipe/eventos/media-actions";
import { IMAGE_ACCEPT, MAX_GALLERY_IMAGES, UPLOAD_FAILED_MESSAGE } from "@/lib/media/rules";
import { uploadImage } from "@/lib/media/upload-client";

type EventGalleryManagerProps = {
  eventId: string;
  images: { id: string; url: string }[];
};

export function EventGalleryManager({ eventId, images }: EventGalleryManagerProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const remaining = MAX_GALLERY_IMAGES - images.length;
  const busy = pending > 0 || removingId !== null;

  async function handleFiles(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!chosen.length) return;

    const files = chosen.slice(0, Math.max(remaining, 0));
    const skipped = chosen.length - files.length;
    let failed = 0;
    let lastError = "";
    setMessage(null);
    setPending(files.length);

    for (const file of files) {
      try {
        const uploaded = await uploadImage(file, "gallery", eventId);
        const added = uploaded.ok ? await addEventImage(eventId, uploaded.path) : uploaded;
        if (!added.ok) {
          failed += 1;
          lastError = added.error;
        }
      } catch {
        failed += 1;
        lastError = UPLOAD_FAILED_MESSAGE;
      }
      setPending((count) => count - 1);
    }

    const notes: string[] = [];
    if (failed === 1) notes.push(lastError);
    if (failed > 1) notes.push(`${failed} fotos não foram enviadas. Tente de novo.`);
    if (skipped > 0) {
      notes.push(`O limite é de ${MAX_GALLERY_IMAGES} fotos; ${skipped} ficaram de fora.`);
    }
    setMessage(notes.join(" ") || null);
    router.refresh();
  }

  async function handleRemove(imageId: string) {
    if (!window.confirm("Remover esta foto da galeria?")) return;
    setMessage(null);
    setRemovingId(imageId);
    try {
      const result = await removeEventImage(eventId, imageId);
      if (!result.ok) setMessage(result.error);
      else router.refresh();
    } catch {
      setMessage("Não foi possível remover a foto.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="mt-8 grid gap-4 rounded-xl border border-byla-border bg-byla-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Fotos do evento</h2>
          <p className="text-sm text-byla-muted">
            {images.length} de {MAX_GALLERY_IMAGES}. Aparecem na página do evento na ordem de envio.
          </p>
        </div>
        <button
          className="flex min-h-11 items-center gap-2 rounded-lg bg-byla-blue px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          disabled={remaining <= 0 || busy}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <ImagePlus aria-hidden className="h-4 w-4" />
          Adicionar fotos
        </button>
        <input
          accept={IMAGE_ACCEPT}
          aria-label="Arquivos das fotos"
          className="sr-only"
          multiple
          onChange={(event) => handleFiles(event.target.files)}
          ref={fileInput}
          tabIndex={-1}
          type="file"
        />
      </div>

      {pending > 0 ? (
        <p className="text-sm text-byla-muted" role="status">
          Enviando {pending} {pending === 1 ? "foto" : "fotos"}…
        </p>
      ) : null}
      {message ? (
        <p className="text-sm font-medium text-red-700 dark:text-red-400" role="alert">
          {message}
        </p>
      ) : null}

      {images.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {images.map((image, index) => (
            <li className="grid gap-2" key={image.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`Foto ${index + 1} da galeria`}
                className="aspect-square w-full rounded-lg border border-byla-border object-cover"
                loading="lazy"
                src={image.url}
              />
              <button
                className="min-h-11 rounded-lg border border-byla-border px-3 text-sm font-medium disabled:opacity-50"
                disabled={busy}
                onClick={() => handleRemove(image.id)}
                type="button"
              >
                {removingId === image.id ? "Removendo..." : "Remover"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-byla-muted">Nenhuma foto ainda.</p>
      )}
    </section>
  );
}
