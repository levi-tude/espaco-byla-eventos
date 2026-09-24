"use client";

import Link from "next/link";

type Props = {
  backHref: string;
  backLabel?: string;
  eventSlug?: string | null;
};

const navBtn =
  "rounded-lg border border-byla-border bg-byla-surface px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-byla-blue/60";

export function TicketPageNav({
  backHref,
  backLabel = "← Voltar",
  eventSlug,
}: Props) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-3">
      <Link className={navBtn} href={backHref}>
        {backLabel}
      </Link>
      <Link className={navBtn} href="/">
        Início
      </Link>
      {eventSlug ? (
        <Link className={navBtn} href={`/eventos/${eventSlug}`}>
          Página do evento
        </Link>
      ) : null}
    </div>
  );
}
