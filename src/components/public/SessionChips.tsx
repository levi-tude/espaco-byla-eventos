import Link from "next/link";

import { cx } from "@/components/ui/cx";
import { formatSessionChip } from "@/lib/datetime";
import { type SessionSaleSummary, sessionName } from "@/lib/domain/sessions";

const NAME_MAX = 18;

function shortName(name: string | null) {
  const trimmed = sessionName(name);
  if (!trimmed) return null;
  return trimmed.length > NAME_MAX ? `${trimmed.slice(0, NAME_MAX - 1).trimEnd()}…` : trimmed;
}

/**
 * Sessões do evento em chips (home): até 3 no celular e 5 no computador, mais
 * "+N" para a página do evento. Esgotada: horário riscado e "Esgotada" escrito.
 */
export function SessionChips({
  slug,
  eventName,
  sessions,
  large = false,
  className,
}: {
  slug: string;
  eventName: string;
  sessions: readonly SessionSaleSummary[];
  large?: boolean;
  className?: string;
}) {
  const mobileMax = 3;
  const desktopMax = 5;
  const chipClass = cx(
    "flex min-h-11 min-w-11 flex-col justify-center rounded-xl border px-3 py-1.5 text-left no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue",
    large ? "text-base" : "text-sm",
  );
  const moreMobile = sessions.length - mobileMax;
  const moreDesktop = sessions.length - desktopMax;

  return (
    <ul aria-label={`Sessões de ${eventName}`} className={cx("flex flex-wrap gap-2", className)}>
      {sessions.slice(0, desktopMax).map((session, index) => {
        const [day, time] = formatSessionChip(session.startsAt).split(" · ");
        const name = shortName(session.name);
        return (
          <li className={index >= mobileMax ? "hidden lg:block" : undefined} key={session.id}>
            <Link
              aria-label={`${name ? `${name}, ` : ""}${day} às ${time}${session.soldOut ? ", esgotada" : ""}`}
              className={cx(
                chipClass,
                session.soldOut
                  ? "border-byla-border text-byla-muted"
                  : "border-byla-link/50 text-foreground hover:border-byla-link hover:bg-byla-link/10",
              )}
              href={`/eventos/${slug}?sessao=${session.id}`}
            >
              <span className="font-medium">{day}</span>
              <span className={cx("font-semibold tabular-nums", session.soldOut && "line-through")}>
                {time}
              </span>
              {name ? <span className="text-byla-muted">{name}</span> : null}
              {session.soldOut ? <span className="font-semibold">Esgotada</span> : null}
            </Link>
          </li>
        );
      })}
      {moreMobile > 0 ? (
        <li className="lg:hidden">
          <Link
            aria-label={`Mais ${moreMobile} ${moreMobile === 1 ? "sessão" : "sessões"} de ${eventName}`}
            className={cx(chipClass, "items-center border-byla-border font-semibold text-foreground hover:border-byla-link")}
            href={`/eventos/${slug}#sessoes`}
          >
            +{moreMobile}
          </Link>
        </li>
      ) : null}
      {moreDesktop > 0 ? (
        <li className="hidden lg:block">
          <Link
            aria-label={`Mais ${moreDesktop} ${moreDesktop === 1 ? "sessão" : "sessões"} de ${eventName}`}
            className={cx(chipClass, "items-center border-byla-border font-semibold text-foreground hover:border-byla-link")}
            href={`/eventos/${slug}#sessoes`}
          >
            +{moreDesktop}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
