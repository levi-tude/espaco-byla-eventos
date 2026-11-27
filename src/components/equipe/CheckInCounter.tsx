import { cx } from "@/components/ui/cx";
import type { CheckInCounts } from "@/lib/domain/check-in";

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string | number;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-byla-border bg-byla-surface px-3 py-2 text-center">
      <p
        className={cx(
          "font-bold tabular-nums leading-none text-foreground",
          strong ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-sm font-medium uppercase tracking-wide text-byla-muted">{label}</p>
    </div>
  );
}

/**
 * Contador grande da sessão na portaria: presentes, vendidos, capacidade e meias que
 * entraram. Os números vêm do servidor; a página recarrega sozinha (AutoRefresh).
 */
export function CheckInCounter({ counts }: { counts: CheckInCounts }) {
  const percent = counts.sold > 0 ? Math.round((counts.present / counts.sold) * 100) : 0;
  return (
    <section aria-label="Contador da sessão" aria-live="polite" className="mb-4 grid gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Presentes" strong value={counts.present} />
        <Stat label="Vendidos" value={counts.sold} />
        <Stat label="Capacidade" value={counts.capacity ?? "—"} />
      </div>
      <div
        aria-hidden
        className="h-2 w-full overflow-hidden rounded-full bg-byla-border"
        title={`${percent}% dos vendidos já entraram`}
      >
        <div className="h-full rounded-full bg-byla-success-solid" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-center text-lg text-foreground">
        Meias que entraram:{" "}
        <span className="font-bold tabular-nums">{counts.meiaPresent}</span> de{" "}
        <span className="tabular-nums">{counts.meiaSold}</span>
        <span className="text-byla-muted"> · faltam {Math.max(counts.sold - counts.present, 0)} pessoas</span>
      </p>
    </section>
  );
}
