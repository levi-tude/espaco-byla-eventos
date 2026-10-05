import { ChargebackButtons, type ChargebackOrderOption } from "@/components/equipe/ChargebackButtons";
import { FeeAdjustmentButton } from "@/components/equipe/FeeAdjustmentButton";
import { FeeSituationBadge } from "@/components/equipe/FeeSituationBadge";
import { MarkFeePaidButton } from "@/components/equipe/MarkFeePaidButton";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { eventDateFormatter } from "@/lib/datetime";
import { type EventFinanceSummary, feeSituation } from "@/lib/domain/fee-payout";
import { formatMoney } from "@/lib/domain/service-fee";
import { orderNumber } from "@/lib/domain/sessions";
import {
  feeSituationDetail,
  formatDayKey,
  formatDiscount,
  formatSigned,
} from "@/lib/finance/situation";

export type FinanceOrder = { orderId: string; buyerName: string; totalCents: number };

type Props = {
  id: string;
  className?: string;
  eventId: string;
  summary: EventFinanceSummary | null;
  /** Admin do Espaço (não a conta do desenvolvedor): pode gravar. */
  canWrite: boolean;
  /** Pedidos pagos com taxa deste evento (para contestação). */
  orders: FinanceOrder[];
  today: string;
};

const dateTimeFormatter = eventDateFormatter({ dateStyle: "short", timeStyle: "short" });
const percentFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function when(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormatter.format(date);
}

type Row = { label: string; value: string; hint?: string | null; strong?: boolean };

type HistoryItem = { key: string; createdAt: string; title: string; lines: string[] };

function historyItems(summary: EventFinanceSummary, buyers: Map<string, string>): HistoryItem[] {
  const payouts: HistoryItem[] = summary.history.map((entry) => {
    if (entry.kind === "ajuste") {
      return {
        key: `ajuste-${entry.id}`,
        createdAt: entry.createdAt,
        title: `Ajuste por ${entry.createdByName}: ${formatSigned(entry.amountCents)}`,
        lines: [`Lançado em ${when(entry.createdAt)}`, entry.reason ? `Motivo: ${entry.reason}` : ""],
      };
    }
    const share =
      entry.amountCents < 0
        ? `Desconto de ${formatDiscount(entry.amountCents)} deste evento abatido neste repasse.`
        : entry.amountCents !== entry.payoutTotalCents
          ? `Parte deste evento: ${formatMoney(entry.amountCents)} (o restante abateu descontos de outros eventos).`
          : "";
    return {
      key: `repasse-${entry.id}`,
      createdAt: entry.createdAt,
      title: `Pago por ${entry.createdByName} — ${formatMoney(entry.payoutTotalCents)}`,
      lines: [
        `PIX em ${formatDayKey(entry.pixDate) || "—"} · registrado em ${when(entry.createdAt)}`,
        share,
        entry.note ? `Nota: ${entry.note}` : "",
      ],
    };
  });

  const chargebacks: HistoryItem[] = summary.chargebacks.map((entry) => {
    const who =
      entry.source === "automatico"
        ? "recebida automaticamente"
        : `por ${entry.createdByName ?? "equipe"}`;
    const buyer = buyers.get(entry.orderId);
    return {
      key: `contestacao-${entry.id}`,
      createdAt: entry.createdAt,
      title:
        entry.kind === "contestacao"
          ? `Contestação ${entry.source === "automatico" ? who : `registrada ${who}`}`
          : `Contestação desfeita ${who}`,
      lines: [
        `Pedido ${orderNumber(entry.orderId)}${buyer ? ` · ${buyer}` : ""} · ${formatMoney(entry.amountCents)} (taxa ${formatMoney(entry.feeCents)})`,
        `Em ${when(entry.createdAt)} · motivo: ${entry.reason}`,
      ],
    };
  });

  return [...payouts, ...chargebacks]
    .map((item) => ({ ...item, lines: item.lines.filter(Boolean) }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Quadro "Financeiro do evento" (spec 10.2). Só é montado para Admin. */
export function EventFinancePanel({ id, className, eventId, summary, canWrite, orders, today }: Props) {
  const heading = (
    <h2 className="text-xl font-semibold text-foreground" id={`${id}-titulo`}>
      Financeiro do evento
    </h2>
  );

  if (!summary) {
    return (
      <section aria-labelledby={`${id}-titulo`} className={className} id={id}>
        {heading}
        <Notice className="mt-3" tone="danger">
          Não foi possível carregar o financeiro deste evento. Atualize a página.
        </Notice>
      </section>
    );
  }

  const situation = feeSituation({
    dueDate: summary.dueDate,
    balanceCents: summary.balanceCents,
    lastPayout: summary.lastPayout,
    today,
  });
  const detail = feeSituationDetail(situation);
  const contested = new Set(summary.contestedOrderIds);
  const buyers = new Map(orders.map((order) => [order.orderId, order.buyerName]));
  const chargebackOptions: ChargebackOrderOption[] = orders.map((order) => ({
    orderId: order.orderId,
    label: `${orderNumber(order.orderId)} · ${order.buyerName} · ${formatMoney(order.totalCents)}`,
    contested: contested.has(order.orderId),
  }));
  const history = historyItems(summary, buyers);

  const rows: Row[] = [
    { label: "Vendido (ingressos)", value: formatMoney(summary.ticketsCents) },
    {
      label:
        summary.rateBps > 0
          ? `Taxa de serviço (${percentFormatter.format(summary.rateBps / 100)}%)`
          : "Taxa de serviço",
      value: formatMoney(summary.feeCents),
    },
    { label: "Total pago pelos clientes", value: formatMoney(summary.paidTotalCents) },
    {
      label: "Estornado (com taxa)",
      value: summary.refundedCents > 0 ? formatDiscount(summary.refundedCents) : formatMoney(0),
      hint:
        summary.refundedOrders > 0
          ? `${plural(summary.refundedOrders, "pedido", "pedidos")} · taxa ${formatMoney(summary.refundedFeeCents)}`
          : null,
    },
    {
      label: "Contestado",
      value: summary.contestedCents > 0 ? formatDiscount(summary.contestedCents) : formatMoney(0),
      hint:
        summary.contestedOrders > 0
          ? `${plural(summary.contestedOrders, "pedido", "pedidos")} · taxa ${formatMoney(summary.contestedFeeCents)}`
          : null,
    },
    {
      label: "Valor do Espaço",
      value: formatMoney(summary.espacoCents),
      hint: "Antes das tarifas do banco de pagamento.",
      strong: true,
    },
    {
      label: "Taxa a repassar",
      value: formatMoney(summary.feeDueCents),
      hint: `Já repassado ${formatMoney(summary.paidOutCents)}.`,
      strong: true,
    },
    ...(summary.decisionOrders > 0
      ? [
          {
            label: "Aguardando decisão",
            value: `${plural(summary.decisionOrders, "pedido", "pedidos")} · ${formatMoney(summary.decisionCents)}`,
            hint: `Fora da conta até a decisão (taxa ${formatMoney(summary.decisionFeeCents)}).`,
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby={`${id}-titulo`} className={className} id={id}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {heading}
        <FeeSituationBadge situation={situation} />
      </div>
      {detail ? <p className="mt-1 text-sm text-byla-muted">{detail}</p> : null}

      <dl className="mt-3 divide-y divide-byla-border rounded-xl border border-byla-border bg-byla-surface">
        {rows.map((row) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3" key={row.label}>
            <dt className={cx("text-base", row.strong ? "font-semibold" : "text-byla-muted")}>{row.label}</dt>
            <dd
              className={cx(
                "text-right text-base tabular-nums text-foreground",
                row.strong && "font-semibold",
              )}
            >
              {row.value}
            </dd>
            {row.hint ? (
              <dd className="col-span-2 mt-0.5 text-sm text-byla-muted">{row.hint}</dd>
            ) : null}
          </div>
        ))}
      </dl>

      {canWrite ? (
        <div className="mt-4 grid gap-3">
          {situation.kind === "a_pagar" ? (
            <MarkFeePaidButton
              eventBalanceCents={summary.balanceCents}
              eventId={eventId}
              minDate={summary.lastSessionEndsAt}
              pendingDiscounts={summary.pendingDiscounts}
              suggestedPayoutCents={summary.suggestedPayoutCents}
              today={today}
            />
          ) : null}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-start">
            <FeeAdjustmentButton eventId={eventId} />
            <ChargebackButtons orders={chargebackOptions} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-byla-muted">
          Conta do desenvolvedor: somente leitura. Só um Admin do Espaço marca como pago, lança
          ajustes ou registra contestações.
        </p>
      )}

      <h3 className="mt-6 text-base font-semibold">Histórico</h3>
      {history.length ? (
        <ul className="mt-2 grid gap-2">
          {history.map((item) => (
            <li className="rounded-xl border border-byla-border bg-byla-surface p-3" key={item.key}>
              <p className="break-words font-medium">{item.title}</p>
              {item.lines.map((line) => (
                <p className="mt-0.5 break-words text-sm text-byla-muted" key={line}>
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-byla-muted">Nenhum repasse, ajuste ou contestação ainda.</p>
      )}
    </section>
  );
}
