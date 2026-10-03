"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { addEventImage, removeEventImage } from "@/app/equipe/eventos/media-actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
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
        const uploaded = await uploadImage(file, "gallery", { eventId });
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
      notes.push(
        skipped === 1
          ? `O limite é de ${MAX_GALLERY_IMAGES} fotos; 1 ficou de fora.`
          : `O limite é de ${MAX_GALLERY_IMAGES} fotos; ${skipped} ficaram de fora.`,
      );
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
    <section className="@container grid gap-4 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Fotos do evento</h3>
          <p className="text-sm text-byla-muted">
            {images.length} de {MAX_GALLERY_IMAGES}. Aparecem na página do evento na ordem de envio.
          </p>
        </div>
        <Button
          className="w-full @md:w-auto"
          disabled={remaining <= 0 || busy}
          onClick={() => fileInput.current?.click()}
          variant="secondary"
        >
          <ImagePlus aria-hidden className="h-5 w-5" />
          Adicionar fotos
        </Button>
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
      {message ? <Notice tone="danger">{message}</Notice> : null}

      {images.length ? (
        <ul className="grid grid-cols-2 gap-3 @md:grid-cols-3 @2xl:grid-cols-5">
          {images.map((image, index) => (
            <li className="grid gap-2" key={image.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`Foto ${index + 1} da galeria`}
                className="aspect-square w-full rounded-lg border border-byla-border bg-byla-overlay object-cover"
                loading="lazy"
                src={image.url}
              />
              <Button
                disabled={busy}
                loading={removingId === image.id}
                loadingLabel="Removendo..."
                onClick={() => handleRemove(image.id)}
                variant="secondary"
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-base text-byla-muted">Nenhuma foto ainda.</p>
      )}
    </section>
  );
}
