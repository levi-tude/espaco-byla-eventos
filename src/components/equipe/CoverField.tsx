"use client";

import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";

import { isOwnMediaUrl, publicMediaUrl } from "@/lib/media/paths";
import { IMAGE_ACCEPT } from "@/lib/media/rules";
import { uploadImage } from "@/lib/media/upload-client";

type CoverFieldProps = {
  defaultValue: string | null;
  onBusyChange: (busy: boolean) => void;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const tabClass =
  "min-h-11 rounded-lg border border-byla-border px-4 text-sm font-medium text-byla-muted transition aria-pressed:border-byla-blue aria-pressed:bg-byla-blue/10 aria-pressed:text-foreground";
const secondaryButtonClass =
  "min-h-11 rounded-lg border border-byla-border px-4 text-sm font-medium disabled:opacity-50";

export function CoverField({ defaultValue, onBusyChange }: CoverFieldProps) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [mode, setMode] = useState<"upload" | "link">(
    defaultValue && !isOwnMediaUrl(supabaseUrl, defaultValue) ? "link" : "upload",
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    onBusyChange(true);
    const result = await uploadImage(file, "cover");
    setUploading(false);
    onBusyChange(false);
    if (!result.ok) return setError(result.error);
    setUrl(publicMediaUrl(supabaseUrl, result.path));
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">Capa do evento (opcional)</legend>

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
          className="rounded-lg border border-byla-border px-3 py-2.5 text-base font-normal"
          name="coverImageUrl"
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
                className="aspect-video w-full max-w-md rounded-lg border border-byla-border object-cover"
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
              className="flex w-full max-w-md items-center justify-center gap-2 rounded-lg border border-dashed border-byla-border px-4 py-8 text-sm font-medium text-byla-muted transition hover:text-foreground disabled:opacity-50"
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

      {error ? (
        <p className="text-sm font-medium text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-byla-muted">
        JPG, PNG ou WebP. A imagem é reduzida automaticamente. A capa vale ao salvar o evento.
      </p>
    </fieldset>
  );
}
