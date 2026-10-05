import { formatMoney, SERVICE_FEE_LABEL } from "@/lib/domain/service-fee";

type Totals = {
  ticketsCents: number;
  feeCents: number;
  totalCents: number;
};

const rowClass = "flex items-baseline justify-between gap-3";

/** Total do pedido antes de pagar; com taxa, separa ingressos e taxa (valores do banco). */
export function OrderTotal({ ticketsCents, feeCents, totalCents }: Totals) {
  if (feeCents <= 0) {
    return (
      <p className="mt-3 flex items-baseline justify-between gap-3 rounded-xl border border-byla-border bg-byla-surface px-4 py-3 text-base text-foreground">
        Total
        <strong className="text-xl">{formatMoney(totalCents)}</strong>
      </p>
    );
  }
  return (
    <dl className="mt-3 grid gap-2 rounded-xl border border-byla-border bg-byla-surface px-4 py-3 text-base text-foreground">
      <div className={rowClass}>
        <dt>Ingressos</dt>
        <dd className="tabular-nums">{formatMoney(ticketsCents)}</dd>
      </div>
      <div className={rowClass}>
        <dt>{SERVICE_FEE_LABEL}</dt>
        <dd className="tabular-nums">{formatMoney(feeCents)}</dd>
      </div>
      <div className={`${rowClass} border-t border-byla-border pt-2`}>
        <dt className="font-medium">Total</dt>
        <dd>
          <strong className="text-xl tabular-nums">{formatMoney(totalCents)}</strong>
        </dd>
      </div>
    </dl>
  );
}

export type PaidOrderItem = {
  name: string;
  quantity: number;
  lineTotalCents: number;
};

/** Resumo discreto do pedido pago: itens, taxa (se houver) e total pago. */
export function PaidOrderSummary({
  items,
  feeCents,
  totalCents,
}: {
  items: readonly PaidOrderItem[];
  feeCents: number;
  totalCents: number;
}) {
  return (
    <section
      aria-labelledby="resumo-pedido-titulo"
      className="mx-auto mt-10 max-w-2xl rounded-2xl border border-byla-border bg-byla-surface p-5"
    >
      <h2 className="text-lg font-semibold text-foreground" id="resumo-pedido-titulo">
        Resumo do pedido
      </h2>
      <dl className="mt-3 grid gap-2 text-base">
        {items.map((item, index) => (
          <div className={rowClass} key={`${item.name}-${index}`}>
            <dt className="min-w-0 break-words text-foreground">
              {item.quantity}× {item.name}
            </dt>
            <dd className="shrink-0 tabular-nums text-byla-muted">
              {formatMoney(item.lineTotalCents)}
            </dd>
          </div>
        ))}
        {feeCents > 0 ? (
          <div className={rowClass}>
            <dt className="text-foreground">{SERVICE_FEE_LABEL}</dt>
            <dd className="shrink-0 tabular-nums text-byla-muted">{formatMoney(feeCents)}</dd>
          </div>
        ) : null}
        <div className={`${rowClass} border-t border-byla-border pt-3`}>
          <dt className="font-medium text-foreground">Total pago</dt>
          <dd className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
            {formatMoney(totalCents)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
