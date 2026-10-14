import { CalendarCheck } from "lucide-react";
import Link from "next/link";

/** Ocupa o lugar da caixa de ingressos quando o evento já aconteceu. */
export function EventEndedNotice({ whenLabel }: { whenLabel: string }) {
  return (
    <>
      <h2
        className="flex items-center gap-2 text-lg font-semibold text-foreground"
        id="encerrado-titulo"
      >
        <CalendarCheck aria-hidden className="h-5 w-5 text-byla-accent-text" />
        Evento encerrado
      </h2>
      <p className="mt-3 text-base text-foreground">Este evento já aconteceu.</p>
      {whenLabel ? <p className="mt-1 text-base text-byla-muted">{whenLabel}</p> : null}
      <Link
        className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-byla-link no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
        href="/"
      >
        Ver próximos eventos <span aria-hidden>&nbsp;→</span>
      </Link>
    </>
  );
}
