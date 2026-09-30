"use client";

import Link from "next/link";
import { useTheme } from "next-themes";

import { SiteHeader } from "@/components/brand/SiteHeader";
import { useMounted } from "@/lib/use-mounted";

type EventCard = {
  slug: string;
  name: string;
  startsLabel: string;
  venue: string;
  coverImageUrl: string | null;
};

export function HomeSingleEvent({ event }: { event: EventCard }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();

  // Antes de montar, assume escuro (padrão do produto) para evitar flash claro
  const isDark = !mounted || resolvedTheme === "dark";

  if (isDark) {
    return (
      <main className="relative flex min-h-full flex-1 flex-col">
        <SiteHeader onMedia />
        <section className="relative flex min-h-[100svh] flex-1 flex-col justify-end">
          {event.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              src={event.coverImageUrl}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-byla-navy via-[#0a0a0b] to-black" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/20" />
          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-16 pt-28">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-byla-yellow">
              Programação
            </p>
            <h1 className="mt-3 font-display text-5xl tracking-wide text-white sm:text-7xl">
              {event.name}
            </h1>
            <p className="mt-4 max-w-xl text-lg text-zinc-200">
              {event.startsLabel}
              <span className="mx-2 text-zinc-500">·</span>
              {event.venue}
            </p>
            <Link
              className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-byla-blue px-6 text-base font-semibold text-white shadow-lg shadow-byla-blue/30 transition hover:brightness-110"
              href={`/eventos/${event.slug}`}
            >
              Garantir ingresso
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-full flex-1 flex-col bg-byla-bg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(64,128,252,0.16),_transparent_55%)]" />
      <SiteHeader />
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-6 pb-16 pt-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-byla-yellow">
          Programação
        </p>
        <article className="mt-6 overflow-hidden rounded-2xl border border-byla-border bg-byla-surface shadow-sm">
          {event.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="aspect-[16/9] w-full object-cover sm:aspect-[21/9]"
              src={event.coverImageUrl}
            />
          ) : (
            <div className="aspect-[16/9] bg-gradient-to-br from-byla-navy to-byla-blue/80 sm:aspect-[21/9]" />
          )}
          <div className="p-6 sm:p-10">
            <h1 className="font-display text-5xl tracking-wide text-foreground sm:text-6xl">
              {event.name}
            </h1>
            <p className="mt-4 text-lg text-byla-muted">
              {event.startsLabel}
              <span className="mx-2">·</span>
              {event.venue}
            </p>
            <Link
              className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-byla-blue px-6 text-base font-semibold text-white shadow-lg shadow-byla-blue/25 transition hover:brightness-110"
              href={`/eventos/${event.slug}`}
            >
              Garantir ingresso
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
