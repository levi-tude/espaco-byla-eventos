"use client";

import { useEffect, useRef, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";

import type { CropArea } from "@/lib/media/resize";
import { COVER_ASPECT } from "@/lib/media/rules";

type CoverCropDialogProps = {
  src: string;
  onCancel: () => void;
  onConfirm: (area: CropArea) => void;
};

const MAX_ZOOM = 3;

export function CoverCropDialog({ src, onCancel, onConfirm }: CoverCropDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      aria-labelledby="cover-crop-title"
      className="m-auto w-[calc(100%-1rem)] max-w-3xl rounded-2xl border border-byla-border bg-byla-surface p-0 text-foreground backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialogRef}
    >
      <div className="grid gap-4 p-4 sm:p-6">
        <div>
          <h2 className="font-semibold" id="cover-crop-title">
            Enquadrar capa
          </h2>
          <p className="mt-1 text-sm text-byla-muted">
            Arraste a foto para posicionar e use o zoom para aproximar. A capa aparece neste
            formato em todo o site.
          </p>
        </div>

        <div className="relative h-64 w-full overflow-hidden rounded-lg bg-black sm:h-96">
          <Cropper
            aspect={COVER_ASPECT}
            crop={crop}
            image={src}
            maxZoom={MAX_ZOOM}
            minZoom={1}
            onCropChange={setCrop}
            onCropComplete={(_area, pixels) => setArea(pixels)}
            onZoomChange={setZoom}
            showGrid
            zoom={zoom}
          />
        </div>

        <label className="grid gap-1 text-sm font-medium">
          Zoom
          <input
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            className="h-11 w-full accent-byla-blue"
            max={MAX_ZOOM}
            min={1}
            onChange={(event) => setZoom(Number(event.target.value))}
            step={0.01}
            type="range"
            value={zoom}
          />
        </label>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-11 rounded-lg border border-byla-border px-4 text-sm font-medium"
            onClick={onCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="min-h-11 rounded-lg bg-byla-blue px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            disabled={!area}
            onClick={() => area && onConfirm(area)}
            type="button"
          >
            Usar esta capa
          </button>
        </div>
      </div>
    </dialog>
  );
}
