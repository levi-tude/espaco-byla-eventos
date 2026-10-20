import Link from "next/link";

export const ORGANIZER_REQUEST_PATH = "/quero-fazer-meu-evento";

/** Convite discreto no fim da página inicial (só com a área de organizadores ligada). */
export function OrganizerCallout() {
  return (
    <p className="mt-12 flex flex-wrap items-center justify-center gap-x-2 border-t border-byla-border pt-6 text-center text-base text-byla-muted">
      Realize seu evento na ACDH Eventos
      <Link
        className="inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-byla-link no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
        href={ORGANIZER_REQUEST_PATH}
      >
        Fale com a gente <span aria-hidden>&nbsp;→</span>
      </Link>
    </p>
  );
}
