"use client";

import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";

import { CoverCropDialog } from "@/components/equipe/CoverCropDialog";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { controlClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { isOwnMediaUrl, publicMediaUrl } from "@/lib/media/paths";
import type { CropArea } from "@/lib/media/resize";
import { IMAGE_ACCEPT, INVALID_IMAGE_TYPE_MESSAGE, isImageContentType } from "@/lib/media/rules";
import { uploadImage } from "@/lib/media/upload-client";

type CoverFieldProps = {
  defaultValue: string | null;
  onBusyChange: (busy: boolean) => void;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const tabClass =
  "min-h-11 flex-1 rounded-lg border border-byla-border px-4 text-base font-medium text-byla-muted transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue aria-pressed:border-byla-link aria-pressed:bg-byla-overlay aria-pressed:text-foreground sm:flex-none";
const secondaryButtonClass = buttonClasses({ variant: "secondary" });

export function CoverField({ defaultValue, onBusyChange }: CoverFieldProps) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [mode, setMode] = useState<"upload" | "link">(
    defaultValue && !isOwnMediaUrl(supabaseUrl, defaultValue) ? "link" : "upload",
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; src: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    if (!isImageContentType(file.type)) return setError(INVALID_IMAGE_TYPE_MESSAGE);
    setError(null);
    setPending({ file, src: URL.createObjectURL(file) });
  }

  function closeCrop() {
    if (pending) URL.revokeObjectURL(pending.src);
    setPending(null);
  }

  async function handleCrop(area: CropArea) {
    if (!pending) return;
    const { file } = pending;
    closeCrop();
    setUploading(true);
    onBusyChange(true);
    const result = await uploadImage(file, "cover", { crop: area });
    setUploading(false);
    onBusyChange(false);
    if (!result.ok) return setError(result.error);
    setUrl(publicMediaUrl(supabaseUrl, result.path));
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-base font-semibold">Capa do evento (opcional)</legend>

      <div className="flex flex-wrap gap-2">
        <button
          aria-pressed={mode === "upload"}
          className={tabClass}
          onClick={() => setMode("upload")}
          type="button"
        >
          Enviar imagem
        </button>
        <button
          aria-pressed={mode === "link"}
          className={tabClass}
          onClick={() => setMode("link")}
          type="button"
        >
          Colar link
        </button>
      </div>

      {mode === "link" ? (
        <input
          aria-label="Link da capa"
          autoCapitalize="none"
          className={cx(controlClasses, "min-h-12")}
          inputMode="url"
          name="coverImageUrl"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
          type="url"
          value={url}
        />
      ) : (
        <>
          <input name="coverImageUrl" type="hidden" value={url} />
          <input
            accept={IMAGE_ACCEPT}
            aria-label="Arquivo da capa"
            className="sr-only"
            onChange={(event) => handleFile(event.target.files?.[0])}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
          {url ? (
            <div className="grid gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Prévia da capa"
                className="aspect-video w-full max-w-md rounded-lg border border-byla-border bg-byla-overlay object-cover"
                src={url}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className={secondaryButtonClass}
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  type="button"
                >
                  Trocar
                </button>
                <button
                  className={secondaryButtonClass}
                  disabled={uploading}
                  onClick={() => setUrl("")}
                  type="button"
                >
                  Remover
                </button>
              </div>
            </div>
          ) : (
            <button
              className="flex w-full max-w-md items-center justify-center gap-2 rounded-lg border border-dashed border-byla-border px-4 py-8 text-base font-medium text-byla-muted transition hover:border-byla-link/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:opacity-50"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              <ImagePlus aria-hidden className="h-5 w-5" />
              Escolher imagem
            </button>
          )}
          {uploading ? (
            <p className="text-sm text-byla-muted" role="status">
              Enviando…
            </p>
          ) : null}
        </>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <p className="text-sm text-byla-muted">
        JPG, PNG ou WebP, no formato deitado (16:9). Você enquadra a foto antes de enviar. A
        capa vale ao salvar o evento.
      </p>

      {pending ? (
        <CoverCropDialog
          key={pending.src}
          onCancel={closeCrop}
          onConfirm={handleCrop}
          src={pending.src}
        />
      ) : null}
    </fieldset>
  );
}
