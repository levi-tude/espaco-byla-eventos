"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui/cx";
import {
  buildRetrospective,
  stepStory,
  storyAutoplayMs,
  type StorySlide,
} from "@/lib/reports/retrospective";
import type { ReportView } from "@/lib/reports/model";

function SlideBody({ slide }: { slide: StorySlide }) {
  const max = Math.max(...slide.bars.map((bar) => bar.value), 1);
  return (
    <div className="motion-safe:animate-[story-in_0.45s_ease]" key={slide.id}>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#ffbd38]">{slide.kicker}</p>
      <h2 className="mt-3 font-display text-4xl leading-tight tracking-wide sm:text-6xl">{slide.title}</h2>
      {slide.hero ? (
        <p className="mt-6 font-display text-5xl tabular-nums tracking-wide text-white sm:text-7xl">
          {slide.hero}
          {slide.heroLabel ? (
            <span className="mt-2 block font-sans text-base font-medium tracking-normal text-white/70">
              {slide.heroLabel}
            </span>
          ) : null}
        </p>
      ) : null}
      {slide.lines.length ? (
        <dl className="mt-8 grid gap-3">
          {slide.lines.map((line) => (
            <div className="flex items-baseline justify-between gap-4 border-b border-white/15 pb-2" key={line.label}>
              <dt className="text-white/70">{line.label}</dt>
              <dd className="text-right font-semibold tabular-nums">{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {slide.bars.length ? (
        <ul className="mt-8 grid gap-3">
          {slide.bars.map((bar) => (
            <li key={`${bar.label}-${bar.display}`}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span>{bar.label}</span>
                <span className="tabular-nums text-white/70">{bar.display}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(4, (bar.value / max) * 100)}%`, backgroundColor: bar.color }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {slide.note ? <p className="mt-8 max-w-xl text-base text-white/75">{slide.note}</p> : null}
    </div>
  );
}

function StoryPlayer({
  slides,
  onClose,
}: {
  slides: StorySlide[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const slide = slides[index] ?? slides[0];
  const autoplay = storyAutoplayMs(reduced);

  const go = useCallback(
    (direction: 1 | -1) => {
      const step = stepStory(index, slides.length, direction);
      if (step.close) onClose();
      else setIndex(step.index);
    },
    [index, onClose, slides.length],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (autoplay === null || paused) return;
    const timer = window.setTimeout(() => go(1), autoplay);
    return () => window.clearTimeout(timer);
  }, [autoplay, go, paused]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === " ") {
        event.preventDefault();
        setPaused((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!slide) return null;

  return (
    <div
      aria-label="Retrospectiva do evento"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex flex-col bg-[#070b16] text-white outline-none"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(64,128,252,0.5),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(255,189,56,0.28),transparent_42%)]"
      />
      <div className="relative z-10 flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {slides.map((item, itemIndex) => (
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/25" key={item.id}>
            <div
              className={cx(
                "h-full bg-[#ffbd38]",
                itemIndex < index && "w-full",
                itemIndex > index && "w-0",
                itemIndex === index && reduced && "w-full",
                itemIndex === index && !reduced && "motion-safe:animate-[story-bar_linear_forwards] motion-reduce:w-full",
              )}
              style={
                itemIndex === index && !reduced
                  ? { animationDuration: `${autoplay ?? 0}ms`, animationPlayState: paused ? "paused" : "running" }
                  : undefined
              }
            />
          </div>
        ))}
      </div>
      <div className="relative z-30 flex items-center justify-between px-4 py-3">
        <p className="text-sm text-white/70">
          {index + 1} de {slides.length}
          {paused ? " · pausa" : ""}
        </p>
        <button
          className="min-h-11 rounded-full px-4 text-base font-semibold text-white"
          onClick={onClose}
          type="button"
        >
          Fechar
        </button>
      </div>
      <div className="relative z-10 min-h-0 flex-1">
        <div className="h-full overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SlideBody slide={slide} />
          <p className="pointer-events-none mt-10 text-sm text-white/50">
            Toque nas laterais, use as setas ou a barra de espaço. Esc fecha.
          </p>
        </div>
        <TapZone onPause={setPaused} onTap={() => go(-1)} side="prev" />
        <TapZone onPause={setPaused} onTap={() => go(1)} side="next" />
      </div>
    </div>
  );
}

function TapZone({
  side,
  onTap,
  onPause,
}: {
  side: "prev" | "next";
  onTap: () => void;
  onPause: (paused: boolean) => void;
}) {
  const started = useRef(0);
  return (
    <button
      aria-label={side === "prev" ? "Slide anterior" : "Próximo slide"}
      className={cx("absolute inset-y-0 z-20 w-[30%]", side === "prev" ? "left-0" : "right-0")}
      onPointerCancel={() => onPause(false)}
      onPointerDown={() => {
        started.current = Date.now();
        onPause(true);
      }}
      onPointerUp={() => {
        const held = Date.now() - started.current;
        onPause(false);
        if (held < 280) onTap();
      }}
      type="button"
    />
  );
}

/** Botão na própria página do relatório. A história abre por cima, sem outro endereço. */
export function Retrospective({
  eventName,
  whenLabel,
  view,
}: {
  eventName: string;
  whenLabel: string;
  view: ReportView;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const slides = buildRetrospective({ eventName, whenLabel, view });

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center rounded-full bg-[#ffbd38] px-4 font-semibold text-black"
        onClick={() => setOpen(true)}
        type="button"
      >
        Ver retrospectiva
      </button>
      {open ? <StoryPlayer onClose={close} slides={slides} /> : null}
    </>
  );
}
