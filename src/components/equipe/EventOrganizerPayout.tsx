import Link from "next/link";

import { ManualFeeButton } from "@/components/equipe/ManualFeeButton";
import { OrganizerAdjustmentButton } from "@/components/equipe/OrganizerAdjustmentButton";
import { OrganizerPayoutButton } from "@/components/equipe/OrganizerPayoutDialog";
import { PayoutSituationBadge } from "@/components/equipe/PayoutSituationBadge";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import { formatMoney } from "@/lib/domain/service-fee";
import { type OrganizerEventFinance, payoutSituation } from "@/lib/organizer/finance";

type Props = {
  id: string;
  className?: string;
  eventName: string;
  /** `null` = não foi possível carregar. */
  finance: OrganizerEventFinance | null;
  canWrite: boolean;
};

const linkClass =
  "font-semibold text-byla-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

/** Bloco "Organizador" na página do evento da equipe (só Admin). */
export function EventOrganizerPayout({ id, className, eventName, finance, canWrite }: Props) {
  const titleId = `${id}-titulo`;
  if (!finance) {
    return (
      <section aria-labelledby={titleId} className={className} id={id}>
        <h2 className="text-xl font-semibold text-foreground" id={titleId}>
          Organizador
        </h2>
        <Notice className="mt-3" tone="danger">
          Não foi possível carregar o repasse do organizador. Atualize a página.
        </Notice>
      </section>
    );
  }

  const situation = payoutSituation(finance);
  const ended = situation.kind !== "andamento";
  const canPay =
    canWrite && !finance.pix.changePending && (situation.kind === "a_pagar" || situation.kind === "atrasado");
  const rows = [
    { label: "Parte do organizador", value: formatMoney(finance.shareCents) },
    { label: "Tarifa do banco (sai da taxa de serviço)", value: formatMoney(finance.bankFeeCents) },
    { label: "Já repassado", value: formatMoney(finance.paidOutCents) },
    {
      label: finance.balanceCents < 0 ? "A devolver ou descontar" : "A pagar",
      value: formatMoney(Math.abs(finance.balanceCents)),
      strong: true,
    },
  ];

  return (
    <section aria-labelledby={titleId} className={cx("grid gap-3", className)} id={id}>
      <h2 className="text-xl font-semibold text-foreground" id={titleId}>
        Organizador
      </h2>
      <PayoutSituationBadge situation={situation} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-base">
        {rows.map((row) => (
          <div className="contents" key={row.label}>
            <dt className={row.strong ? "font-medium" : "text-byla-muted"}>{row.label}</dt>
            <dd className={cx("text-right tabular-nums", row.strong && "font-semibold")}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {finance.pix.changePending ? (
        <Notice live={false} tone="warning">
          Troca de chave PIX aguardando decisão: decida em Organizadores antes de pagar.
        </Notice>
      ) : finance.team?.pixChangedRecently ? (
        <Notice live={false} tone="warning">
          A chave PIX do organizador mudou há pouco. Confira o titular antes de pagar.
        </Notice>
      ) : null}
      {finance.pendingFeeOrders > 0 && ended ? (
        <p className="text-sm text-byla-muted">
          Falta a tarifa do banco de {finance.pendingFeeOrders}{" "}
          {finance.pendingFeeOrders === 1 ? "pedido" : "pedidos"}. Isso não muda a parte do organizador.
        </p>
      ) : null}
      {canWrite && ended ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {canPay ? <OrganizerPayoutButton eventId={finance.eventId} eventName={eventName} today={finance.today} /> : null}
          {finance.pendingFeeOrders > 0 ? <ManualFeeButton eventId={finance.eventId} /> : null}
          <OrganizerAdjustmentButton eventId={finance.eventId} />
        </div>
      ) : null}
      <Link className={linkClass} href="/equipe/repasses">
        Ver todos os repasses
      </Link>
    </section>
  );
}
