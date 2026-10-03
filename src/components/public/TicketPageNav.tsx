"use client";

import Link from "next/link";

import { BackLink } from "@/components/ui/BackLink";

type Props = {
  backHref: string;
  backLabel?: string;
  eventSlug?: string | null;
};

const navLink =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-base text-byla-muted no-underline transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

export function TicketPageNav({
  backHref,
  backLabel = "Voltar",
  eventSlug,
}: Props) {
  return (
    <nav aria-label="Navegação do pedido" className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-1">
      <BackLink className="mr-auto" href={backHref}>
        {backLabel}
      </BackLink>
      <Link className={navLink} href="/">
        Início
      </Link>
      {eventSlug ? (
        <Link className={navLink} href={`/eventos/${eventSlug}`}>
          Página do evento
        </Link>
      ) : null}
    </nav>
  );
}
