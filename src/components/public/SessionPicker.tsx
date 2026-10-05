import { Check } from "lucide-react";
import Link from "next/link";

import { FeeNote } from "@/components/public/FeeNote";
import { cx } from "@/components/ui/cx";
import { formatSessionDay, formatSessionTime, sessionDayKey } from "@/lib/datetime";
import { formatMoney, type ServiceFeePolicy } from "@/lib/domain/service-fee";
import {
  type SessionSaleSummary,
  sessionAvailabilityBadge,
  sessionIsBuyable,
  sessionName,
} from "@/lib/domain/sessions";

function groupByDay(sessions: readonly SessionSaleSummary[]) {
  const groups = new Map<string, SessionSaleSummary[]>();
  for (const session of sessions) {
    const key = sessionDayKey(session.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups.values()];
}

function timeRange(session: SessionSaleSummary) {
  const start = formatSessionTime(session.startsAt);
  const end = session.endsAt ? formatSessionTime(session.endsAt) : "";
  return end ? `${start} – ${end}` : start;
}

/** Escolha da sessão na página do evento: botões grandes agrupados por dia. */
export function SessionPicker({
  slug,
  sessions,
  selectedId,
  feePolicy,
}: {
  slug: string;
  sessions: readonly SessionSaleSummary[];
  selectedId: string | null;
  feePolicy: ServiceFeePolicy;
}) {
  return (
    <section aria-labelledby="sessoes-titulo" className="mt-3 grid scroll-mt-6 gap-4" id="sessoes">
      <h3 className="text-base font-semibold text-foreground" id="sessoes-titulo">
        Escolha a sessão
      </h3>
      {groupByDay(sessions).map((group) => (
        <div className="grid gap-2" key={sessionDayKey(group[0].startsAt)}>
          <p className="text-sm font-medium text-byla-muted">{formatSessionDay(group[0].startsAt)}</p>
          <ul className="grid gap-2">
            {group.map((session) => {
              const badge = sessionAvailabilityBadge(session);
              const buyable = sessionIsBuyable(session);
              const selected = session.id === selectedId;
              const name = sessionName(session.name);
              const content = (
                <>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        "block text-lg font-semibold tabular-nums",
                        badge.kind === "sold_out" && "line-through",
                      )}
                    >
                      {timeRange(session)}
                    </span>
                    {name ? <span className="block break-words text-base">{name}</span> : null}
                    {badge.label ? (
                      <span
                        className={cx(
                          "block text-sm font-semibold",
                          badge.kind === "low" ? "text-byla-accent-text" : "text-byla-muted",
                        )}
                      >
                        {badge.label}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    {buyable && session.minPriceCents !== null ? (
                      <>
                        <span className="block text-sm text-byla-muted">
                          a partir de{" "}
                          <span className="font-semibold text-foreground">
                            {formatMoney(session.minPriceCents)}
                          </span>
                        </span>
                        <FeeNote
                          className="text-xs"
                          priceCents={session.minPriceCents}
                          policy={feePolicy}
                        />
                      </>
                    ) : null}
                    {selected ? (
                      <Check aria-hidden className="ml-auto mt-1 h-5 w-5 text-byla-link" />
                    ) : null}
                  </span>
                </>
              );
              const baseClass =
                "flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left no-underline transition";
              return (
                <li key={session.id}>
                  {buyable ? (
                    <Link
                      aria-current={selected ? "true" : undefined}
                      className={cx(
                        baseClass,
                        "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue",
                        selected
                          ? "border-byla-link bg-byla-link/10 ring-1 ring-byla-link"
                          : "border-byla-border hover:border-byla-link/60",
                      )}
                      href={`/eventos/${slug}?sessao=${session.id}#sessoes`}
                      replace
                      scroll={false}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      aria-disabled="true"
                      className={cx(baseClass, "border-byla-border text-byla-muted")}
                    >
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
