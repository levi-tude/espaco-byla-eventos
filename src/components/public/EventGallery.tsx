"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type KeyboardEvent, type TouchEvent, useEffect, useRef, useState } from "react";

type EventGalleryProps = {
  eventName: string;
  images: { id: string; url: string }[];
};

const SWIPE_MIN_PX = 50;
const navButtonClass =
  "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80";

export function EventGallery({ eventName, images }: EventGalleryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const count = images.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (index !== null && !dialog.open) dialog.showModal();
    if (index === null && dialog.open) dialog.close();
  }, [index]);

  if (!count) return null;

  function show(next: number) {
    setIndex(((next % count) + count) % count);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (index === null) return;
    if (event.key === "ArrowRight") show(index + 1);
    if (event.key === "ArrowLeft") show(index - 1);
  }

  function handleTouchEnd(event: TouchEvent<HTMLDialogElement>) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null || index === null) return;
    const delta = event.changedTouches[0].clientX - start;
    if (Math.abs(delta) < SWIPE_MIN_PX) return;
    show(delta < 0 ? index + 1 : index - 1);
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">Fotos</h2>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((image, position) => (
          <li key={image.id}>
            <button
              aria-label={`Abrir foto ${position + 1} de ${count}`}
              className="block w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
              onClick={() => setIndex(position)}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="aspect-square w-full bg-byla-overlay object-cover transition duration-300 hover:scale-[1.03] motion-reduce:transition-none motion-reduce:hover:scale-100"
                decoding="async"
                loading="lazy"
                src={image.url}
              />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        aria-label={`Fotos de ${eventName}`}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
        onClose={() => setIndex(null)}
        onKeyDown={handleKeyDown}
        onTouchEnd={handleTouchEnd}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0].clientX;
        }}
        ref={dialogRef}
      >
        {index !== null ? (
          <div className="relative flex h-full w-full items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={`Foto ${index + 1} de ${count} de ${eventName}`}
              className="max-h-full max-w-full select-none object-contain"
              src={images[index].url}
            />
            <button
              aria-label="Fechar"
              className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
              onClick={() => setIndex(null)}
              type="button"
            >
              <X aria-hidden className="h-6 w-6" />
            </button>
            {count > 1 ? (
              <>
                <button
                  aria-label="Foto anterior"
                  className={`${navButtonClass} left-3`}
                  onClick={() => show(index - 1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden className="h-7 w-7" />
                </button>
                <button
                  aria-label="Próxima foto"
                  className={`${navButtonClass} right-3`}
                  onClick={() => show(index + 1)}
                  type="button"
                >
                  <ChevronRight aria-hidden className="h-7 w-7" />
                </button>
              </>
            ) : null}
            <p
              aria-live="polite"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm"
            >
              {index + 1} / {count}
            </p>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
