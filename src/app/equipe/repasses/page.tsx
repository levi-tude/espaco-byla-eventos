import { Download, HandCoins } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ManualFeeButton } from "@/components/equipe/ManualFeeButton";
import { OrganizerAdjustmentButton } from "@/components/equipe/OrganizerAdjustmentButton";
import { OrganizerPayoutButton } from "@/components/equipe/OrganizerPayoutDialog";
import { PayoutSituationBadge } from "@/components/equipe/PayoutSituationBadge";
import { RefundReceivedButton } from "@/components/equipe/RefundReceivedButton";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { controlClasses, labelClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { todayKey } from "@/lib/domain/fee-payout";
import { formatMoney } from "@/lib/domain/service-fee";
import {
  feePeriodLabel,
  feePeriodQuery,
  feePeriodShortcuts,
  parseFeePeriod,
  PAYOUT_PERIOD_MAX_MONTHS,
} from "@/lib/finance/period";
import { formatDayKey } from "@/lib/finance/situation";
import { overviewSituation, type PayoutsOverview } from "@/lib/organizer/finance";
import { loadPayoutsOverview } from "@/lib/organizer/load-finance";
import { payoutItemLabel } from "@/lib/organizer/payout-csv";

const linkClass =
  "font-semibold text-byla-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

const KIND_LABEL: Record<PayoutsOverview["payouts"][number]["kind"], string> = {
  repasse: "Repasse",
  compensacao: "Acerto sem PIX",
  ajuste: "Ajuste",
  devolucao: "Devolução recebida",
};

export default async function RepassesPage({ searchParams }: PageProps<"/equipe/repasses">) {
  const access = await getFinanceAccess();
  if (!access) notFound();

  const query = await searchParams;
  const today = todayKey();
  const period = parseFeePeriod(query.de, query.ate, today, PAYOUT_PERIOD_MAX_MONTHS);
  const overview = await loadPayoutsOverview(access.userId, period);
  const shortcuts = feePeriodShortcuts(today);
  const csvHref = `/equipe/repasses/planilha?${feePeriodQuery(period)}`;
  const canWrite = !access.isDeveloper;
  const calendarOutdated =
    overview !== null && (overview.calendarUntil === null || overview.calendarUntil <= Number(today.slice(0, 4)));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <BackLink href="/equipe">Eventos</BackLink>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-foreground">Repasses</h1>
          <p className="mt-1 text-base text-byla-muted">
            Pagamentos aos organizadores · lançamentos de {feePeriodLabel(period)}
          </p>
        </div>
        <a className={buttonClasses({ variant: "secondary", className: "w-full sm:w-auto" })} href={csvHref}>
          <Download aria-hidden className="h-5 w-5" />
          Baixar planilha
        </a>
      </div>

      {access.isDeveloper ? (
        <Notice className="mt-6" live={false} tone="info">
          Conta do desenvolvedor: somente leitura. Só um Admin do Espaço registra repasses.
        </Notice>
      ) : null}

      {!overview ? (
        <Notice className="mt-6" tone="danger">
          Não foi possível carregar os repasses. Atualize a página.
        </Notice>
      ) : (
        <>
          {calendarOutdated ? (
            <Notice className="mt-6" live={false} tone="warning">
              O calendário de feriados usado no prazo dos repasses termina em {overview.calendarUntil ?? "—"}. Peça a
              atualização ao desenvolvedor.
            </Notice>
          ) : null}

          <section aria-labelledby="eventos-repasse-titulo" className="mt-6">
            <h2 className="text-xl font-semibold text-foreground" id="eventos-repasse-titulo">
              Eventos de organizadores
            </h2>
            {overview.events.length === 0 ? (
              <EmptyState className="mt-3" icon={HandCoins} title="Nenhum evento de organizador com vendas." />
            ) : (
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {overview.events.map((event) => {
                  const situation = overviewSituation(event, overview.today);
                  const canPay =
                    canWrite && (situation.kind === "a_pagar" || situation.kind === "atrasado") && event.balanceCents > 0;
                  const ended = situation.kind !== "andamento";
                  return (
                    <li
                      className="grid content-start gap-3 rounded-2xl border border-byla-border bg-byla-surface p-4"
                      key={event.eventId}
                    >
                      <div>
                        <p className="break-words font-semibold">{event.eventName}</p>
                        <p className="break-words text-sm text-byla-muted">
                          Produção: {event.organizerPublicName}
                          {event.organizerStatus === "suspenso" ? " · conta suspensa" : ""}
                        </p>
                      </div>
                      <PayoutSituationBadge situation={situation} />
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-base">
                        <dt className="text-byla-muted">Parte do organizador</dt>
                        <dd className="text-right tabular-nums">{formatMoney(event.shareCents)}</dd>
                        <dt className="text-byla-muted">Já repassado</dt>
                        <dd className="text-right tabular-nums">{formatMoney(event.paidOutCents)}</dd>
                        <dt className="font-medium">{event.balanceCents < 0 ? "A devolver ou descontar" : "A pagar"}</dt>
                        <dd className="text-right font-semibold tabular-nums">
                          {formatMoney(Math.abs(event.balanceCents))}
                        </dd>
                      </dl>
                      {event.pendingFeeOrders > 0 && ended ? (
                        <p className="text-sm text-byla-muted">
                          Falta a tarifa do banco de {event.pendingFeeOrders}{" "}
                          {event.pendingFeeOrders === 1 ? "pedido" : "pedidos"}. Isso não muda a parte do
                          organizador.
                        </p>
                      ) : null}
                      {event.pixChangePending ? (
                        <Notice live={false} tone="warning">
                          Troca de chave PIX aguardando decisão: decida em Organizadores antes de pagar.
                        </Notice>
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {canPay && !event.pixChangePending ? (
                          <OrganizerPayoutButton eventId={event.eventId} eventName={event.eventName} today={today} />
                        ) : null}
                        {canWrite && ended && event.pendingFeeOrders > 0 ? (
                          <ManualFeeButton eventId={event.eventId} />
                        ) : null}
                        {canWrite && ended ? <OrganizerAdjustmentButton eventId={event.eventId} /> : null}
                      </div>
                      <Link className={linkClass} href={`/equipe/eventos/${event.eventId}#organizador`}>
                        Ver evento
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {overview.organizersOwing.length ? (
            <section aria-labelledby="devolucoes-titulo" className="mt-8">
              <h2 className="text-xl font-semibold text-foreground" id="devolucoes-titulo">
                Devoluções a receber
              </h2>
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {overview.organizersOwing.map((owing) => {
                  const overdue = owing.returnDueDate !== null && overview.today > owing.returnDueDate;
                  return (
                    <li
                      className="grid content-start gap-2 rounded-2xl border border-byla-border bg-byla-surface p-4"
                      key={owing.organizerId}
                    >
                      <p className="break-words font-semibold">{owing.publicName}</p>
                      <p className="text-base">
                        Deve <strong className="tabular-nums">{formatMoney(owing.owedCents)}</strong>
                        {owing.returnDueDate
                          ? overdue
                            ? ` · atrasada desde ${formatDayKey(owing.returnDueDate)}`
                            : ` · devolver até ${formatDayKey(owing.returnDueDate)}`
                          : " · será descontado do próximo repasse"}
                      </p>
                      {canWrite ? (
                        <RefundReceivedButton
                          organizerId={owing.organizerId}
                          organizerName={owing.publicName}
                          owedCents={owing.owedCents}
                          today={today}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="periodo-titulo" className="mt-8 rounded-2xl border border-byla-border bg-byla-surface p-4">
            <h2 className="text-base font-semibold" id="periodo-titulo">
              Período dos lançamentos (pela data do registro ou do PIX)
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {shortcuts.map((shortcut) => {
                const active = shortcut.fromMonth === period.fromMonth && shortcut.toMonth === period.toMonth;
                return (
                  <li key={shortcut.label}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "inline-flex min-h-11 items-center rounded-lg border px-3 text-base font-medium no-underline transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue",
                        active
                          ? "border-byla-action bg-byla-action text-white"
                          : "border-byla-border text-foreground hover:bg-byla-overlay",
                      )}
                      href={`/equipe/repasses?${feePeriodQuery(shortcut)}`}
                    >
                      {shortcut.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <form action="/equipe/repasses" className="mt-4 grid gap-3 sm:flex sm:items-end" method="get">
              <div className="flex flex-col gap-1.5">
                <label className={labelClasses} htmlFor="periodo-de">
                  De
                </label>
                <input
                  className={cx(controlClasses, "min-h-12")}
                  defaultValue={period.fromMonth}
                  id="periodo-de"
                  name="de"
                  required
                  type="month"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClasses} htmlFor="periodo-ate">
                  Até
                </label>
                <input
                  className={cx(controlClasses, "min-h-12")}
                  defaultValue={period.toMonth}
                  id="periodo-ate"
                  name="ate"
                  required
                  type="month"
                />
              </div>
              <button className={buttonClasses({ variant: "secondary" })} type="submit">
                Ver período
              </button>
            </form>
            <p className="mt-2 text-sm text-byla-muted">Até 12 meses por vez.</p>
          </section>

          <section aria-labelledby="lancamentos-titulo" className="mt-8">
            <h2 className="text-xl font-semibold text-foreground" id="lancamentos-titulo">
              Lançamentos
            </h2>
            {overview.payouts.length === 0 ? (
              <p className="mt-3 text-base text-byla-muted">Nenhum lançamento neste período.</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {overview.payouts.map((payout) => (
                  <li className="grid gap-1 rounded-2xl border border-byla-border bg-byla-surface p-4" key={payout.payoutId}>
                    <p className="flex flex-wrap justify-between gap-x-3">
                      <span className="font-semibold">
                        {KIND_LABEL[payout.kind]} · {payout.organizerPublicName}
                      </span>
                      <span className="tabular-nums">{formatMoney(Math.abs(payout.amountCents))}</span>
                    </p>
                    <p className="text-sm text-byla-muted">
                      {payout.pixDate ? `PIX de ${formatDayKey(payout.pixDate)} · ` : ""}
                      registrado por {payout.createdByName}
                    </p>
                    <ul className="text-sm">
                      {payout.items.map((item) => (
                        <li className="flex flex-wrap justify-between gap-x-3" key={item.eventId}>
                          <span className="min-w-0 break-words">{item.eventName}</span>
                          <span className="text-byla-muted">{payoutItemLabel(payout.kind, item.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                    {payout.note || payout.reason ? (
                      <p className="break-words text-sm text-byla-muted">{payout.reason ?? payout.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
