import { cx } from "@/components/ui/cx";
import { formatCents, type MeiaSummary } from "@/lib/domain/meia-check";

function Item({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "danger" | "success" }) {
  return (
    <div className="min-w-0 rounded-lg border border-byla-border bg-byla-surface px-2 py-1.5 text-center">
      <p
        className={cx(
          "text-2xl font-bold tabular-nums leading-none",
          tone === "warning" && "text-byla-warning",
          tone === "danger" && "text-byla-danger",
          tone === "success" && "text-byla-success",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-byla-muted">{label}</p>
    </div>
  );
}

/** Resumo da conferência de meia (sessão ou evento): lidas, ok, diferença, recusadas, sem registro. */
export function MeiaCheckSummary({
  summary,
  title = "Conferência de meia",
  className,
}: {
  summary: MeiaSummary;
  title?: string;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cx("grid gap-2", className)}>
      <p className="text-base font-semibold text-foreground">
        {title}
        {summary.pagouDiferenca > 0 ? (
          <span className="font-normal text-byla-muted">
            {" "}
            · diferença recebida: <span className="font-semibold text-foreground">{formatCents(summary.diferencaTotalCents)}</span>
          </span>
        ) : null}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Item label="Lidas" value={summary.lidas} />
        <Item label="Comprovante ok" tone="success" value={summary.comprovanteOk} />
        <Item label="Pagaram diferença" tone="success" value={summary.pagouDiferenca} />
        <Item label="Recusadas" tone={summary.recusadas ? "danger" : undefined} value={summary.recusadas} />
        <Item label="Não registradas" tone={summary.naoRegistradas ? "warning" : undefined} value={summary.naoRegistradas} />
      </div>
    </section>
  );
}
