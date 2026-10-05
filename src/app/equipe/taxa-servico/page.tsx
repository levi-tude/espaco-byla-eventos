import { Download, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FeeSituationBadge } from "@/components/equipe/FeeSituationBadge";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { controlClasses, labelClasses } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { getFinanceAccess } from "@/lib/auth/finance-admin";
import { feeSituation, type OverviewEvent, todayKey } from "@/lib/domain/fee-payout";
import { formatMoney } from "@/lib/domain/service-fee";
import { loadServiceFeeOverview } from "@/lib/finance/load";
import {
  feePeriodLabel,
  feePeriodQuery,
  feePeriodShortcuts,
  parseFeePeriod,
} from "@/lib/finance/period";
import { feeSituationDetail, formatDayKey, formatDiscount } from "@/lib/finance/situation";

const linkClass =
  "font-semibold text-byla-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

function financeHref(event: OverviewEvent) {
  return `/equipe/eventos/${event.eventId}#financeiro`;
}

export default async function TaxaServicoPage({ searchParams }: PageProps<"/equipe/taxa-servico">) {
  const access = await getFinanceAccess();
  if (!access) notFound();

  const query = await searchParams;
  const today = todayKey();
  const period = parseFeePeriod(query.de, query.ate, today);
  const overview = await loadServiceFeeOverview(access.userId, period);
  const shortcuts = feePeriodShortcuts(today);
  const csvHref = `/equipe/taxa-servico/planilha?${feePeriodQuery(period)}`;

  const rows = (overview?.events ?? []).map((event) => ({
    event,
    situation: feeSituation({
      dueDate: event.dueDate,
      balanceCents: event.balanceCents,
      lastPayout: event.lastPayout,
      today,
    }),
  }));

  const cards = overview
    ? [
        {
          label: "A pagar",
          value: formatMoney(overview.toPayCents),
          hint: "Eventos já terminados, de qualquer período.",
        },
        {
          label: "Pago no período",
          value: formatMoney(overview.paidInPeriodCents),
          hint: "Pela data do PIX.",
        },
        {
          label: "Descontos pendentes",
          value:
            overview.pendingDiscountCents < 0
              ? formatDiscount(overview.pendingDiscountCents)
              : formatMoney(0),
          hint: "Saem do próximo repasse.",
        },
      ]
    : [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <BackLink href="/equipe">Eventos</BackLink>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-foreground">Taxa de serviço</h1>
          <p className="mt-1 text-base text-byla-muted">
            Repasses ao desenvolvedor por evento · {feePeriodLabel(period)}
          </p>
        </div>
        <a className={buttonClasses({ variant: "secondary", className: "w-full sm:w-auto" })} href={csvHref}>
          <Download aria-hidden className="h-5 w-5" />
          Baixar planilha
        </a>
      </div>

      {access.isDeveloper ? (
        <Notice className="mt-6" live={false} tone="info">
          Conta do desenvolvedor: somente leitura. Só um Admin do Espaço marca repasses como pagos.
        </Notice>
      ) : null}

      <section aria-labelledby="periodo-titulo" className="mt-6 rounded-2xl border border-byla-border bg-byla-surface p-4">
        <h2 className="text-base font-semibold" id="periodo-titulo">
          Período (pela data da última sessão)
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {shortcuts.map((shortcut) => {
            const active =
              shortcut.fromMonth === period.fromMonth && shortcut.toMonth === period.toMonth;
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
                  href={`/equipe/taxa-servico?${feePeriodQuery(shortcut)}`}
                >
                  {shortcut.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <form action="/equipe/taxa-servico" className="mt-4 grid gap-3 sm:flex sm:items-end" method="get">
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
        <p className="mt-2 text-sm text-byla-muted">Até 24 meses por vez.</p>
      </section>

      {!overview ? (
        <Notice className="mt-6" tone="danger">
          Não foi possível carregar a taxa de serviço. Atualize a página.
        </Notice>
      ) : (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            {cards.map((card) => (
              <div className="rounded-xl border border-byla-border bg-byla-surface p-4" key={card.label}>
                <dt className="text-sm text-byla-muted">{card.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{card.value}</dd>
                <dd className="mt-1 text-sm text-byla-muted">{card.hint}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="eventos-taxa-titulo" className="mt-8">
            <h2 className="text-xl font-semibold text-foreground" id="eventos-taxa-titulo">
              Eventos
            </h2>
            {rows.length === 0 ? (
              <EmptyState
                className="mt-3"
                icon={ReceiptText}
                title="Nenhum evento com taxa de serviço neste período."
              />
            ) : (
              <>
                <ul className="mt-3 grid gap-3 md:hidden">
                  {rows.map(({ event, situation }) => {
                    const detail = feeSituationDetail(situation);
                    return (
                      <li
                        className="grid gap-2 rounded-2xl border border-byla-border bg-byla-surface p-4"
                        key={event.eventId}
                      >
                        <p className="break-words font-semibold">{event.name}</p>
                        <p className="text-sm text-byla-muted">
                          Última sessão: {formatDayKey(event.lastSessionAt) || "—"} · Taxa devida:{" "}
                          {formatMoney(event.feeDueCents)}
                        </p>
                        <div>
                          <FeeSituationBadge situation={situation} />
                          {detail ? <p className="mt-1 text-sm text-byla-muted">{detail}</p> : null}
                        </div>
                        <Link className={linkClass} href={financeHref(event)}>
                          Ver financeiro
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-byla-border md:block">
                  <table className="w-full text-left text-base">
                    <thead className="bg-byla-surface text-sm text-byla-muted">
                      <tr>
                        <th className="px-4 py-3 font-medium" scope="col">Evento</th>
                        <th className="px-4 py-3 font-medium" scope="col">Última sessão</th>
                        <th className="px-4 py-3 text-right font-medium" scope="col">Taxa devida</th>
                        <th className="px-4 py-3 font-medium" scope="col">Situação</th>
                        <th className="px-4 py-3 font-medium" scope="col">
                          <span className="sr-only">Ação</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ event, situation }) => {
                        const detail = feeSituationDetail(situation);
                        return (
                          <tr className="border-t border-byla-border align-top" key={event.eventId}>
                            <td className="max-w-72 break-words px-4 py-3 font-medium">{event.name}</td>
                            <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                              {formatDayKey(event.lastSessionAt) || "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                              {formatMoney(event.feeDueCents)}
                            </td>
                            <td className="px-4 py-3">
                              <FeeSituationBadge situation={situation} />
                              {detail ? <p className="mt-1 text-sm text-byla-muted">{detail}</p> : null}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right">
                              <Link className={linkClass} href={financeHref(event)}>
                                Ver financeiro
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
