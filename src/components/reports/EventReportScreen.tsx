import type { ReactNode } from "react";
import Link from "next/link";

import { ArrivalChart, DailyChart, DonutChart, StackedBar } from "@/components/reports/Charts";
import { PrintButton } from "@/components/reports/PrintButton";
import { BackLink } from "@/components/ui/BackLink";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/Notice";
import type { ReportView } from "@/lib/reports/model";

const cardClass = "rounded-2xl border border-byla-border bg-byla-surface p-4";

const FULL_REFUND = [
  {
    title: "Cliente",
    text: "Recebe 100% de volta, o ingresso e a taxa de serviço. O estorno é sempre do pedido inteiro.",
  },
  {
    title: "Organizador",
    text: "Deixa de receber o valor dos ingressos daquele pedido. A tarifa do provedor não sai da parte dele.",
  },
  {
    title: "ACDH",
    text: "Deixa de receber a taxa de serviço daquele pedido. Se o banco não devolver a tarifa, ela continua na conta da ACDH.",
  },
  {
    title: "Prazo e regras",
    text: "Dá para pedir pelo painel até 180 dias depois do pagamento. Não estorna se algum ingresso já entrou. Depois do repasse, o valor desconta do próximo. Se em 30 dias não houver repasse que cubra, o organizador devolve em até 10 dias.",
  },
];

const SIMPLE_REFUND = [
  {
    title: "Cliente",
    text: "Recebe o pedido inteiro de volta: ingressos e taxa de serviço.",
  },
  {
    title: "A sua parte",
    text: "Sai só o valor dos ingressos daquele pedido. A taxa de serviço não sai da sua parte.",
  },
  {
    title: "Repasse",
    text: "O repasse é por PIX em até 5 dias úteis depois do evento.",
  },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={cx(cardClass, "break-inside-avoid")}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-byla-accent-text">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-byla-muted">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EventReportScreen({
  eventName,
  whenLabel,
  view,
  updatedLabel,
  sessionLinks,
  csvHref,
  printHref,
  backHref,
  backLabel,
  printMode = false,
}: {
  eventName: string;
  whenLabel: string;
  view: ReportView;
  updatedLabel: string;
  sessionLinks: { href: string; label: string; current: boolean }[];
  csvHref: string;
  printHref: string;
  backHref: string;
  backLabel: string;
  printMode?: boolean;
}) {
  const splitTotal = view.split
    ? view.split.organizerCents + view.split.netCents + view.split.providerCents
    : 0;
  const splitOk = Boolean(view.split && view.split.organizerCents >= 0 && view.split.netCents >= 0 && view.split.providerCents >= 0 && splitTotal > 0);

  return (
    <main className="report-print mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6 sm:pt-4">
      <div className="no-print">
        <BackLink href={backHref}>{backLabel}</BackLink>
      </div>
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-byla-muted">Eventos / Relatório</p>
          <h1 className="font-display text-4xl tracking-wide text-foreground sm:text-5xl">{eventName}</h1>
          {whenLabel ? <p className="mt-1 text-base text-byla-muted">{whenLabel}</p> : null}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cx(
                "inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium",
                view.stateKind === "ao_vivo" && "bg-byla-success-bg text-byla-success",
                view.stateKind === "provisorio" && "bg-byla-warning-bg text-byla-warning",
                view.stateKind === "encerrado" && "bg-byla-neutral-bg text-byla-neutral",
              )}
            >
              <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
              {view.stateLabel}
              {updatedLabel ? ` · atualizado ${updatedLabel}` : ""}
            </span>
            <span className="text-byla-muted">{view.stateDetail}</span>
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {printMode ? <PrintButton label="Salvar PDF" /> : <ButtonLink href={printHref} variant="secondary">PDF</ButtonLink>}
          <ButtonLink href={csvHref} variant="secondary">
            CSV
          </ButtonLink>
        </div>
      </header>

      {sessionLinks.length > 1 ? (
        <nav aria-label="Sessão do relatório" className="no-print mt-5 flex flex-wrap gap-2">
          {sessionLinks.map((link) => (
            <Link
              aria-current={link.current ? "page" : undefined}
              className={cx(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                link.current
                  ? "border-byla-yellow bg-byla-yellow text-black"
                  : "border-byla-border text-foreground hover:bg-byla-overlay",
              )}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {view.scopedNote ? <p className="mt-3 text-sm text-byla-muted">{view.scopedNote}</p> : null}
      {view.financeCloses === false ? (
        <Notice className="mt-4" tone="warning">
          Os valores do financeiro não fecharam entre si. Atualize a página. Se continuar, a equipe confere o pedido.
        </Notice>
      ) : null}
      {printMode ? (
        <p className="no-print mt-4 text-sm text-byla-muted">
          Para salvar o PDF, use o botão PDF ou a impressão do navegador.
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {view.cards.map((card) => (
          <article className={cardClass} key={card.label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-byla-muted">{card.label}</p>
            <p
              className={cx(
                "mt-2 text-3xl font-semibold tabular-nums",
                card.accent === "good" && "text-byla-success",
                card.accent === "money" && "text-foreground",
              )}
            >
              {card.value}
            </p>
            {card.hint ? <p className="mt-1 text-sm text-byla-muted">{card.hint}</p> : null}
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-4">
        <Section hint="A barra é quem ocupa lugar. Capacitação fica de fora." title="Lotação por sessão">
          <ul className="grid gap-5">
            {view.sessions.map((session) => (
              <li key={session.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold">{session.title}{session.cancelled ? " · cancelada" : ""}</p>
                  <p className="tabular-nums text-byla-muted">
                    {session.occupied} / {session.capacity} lugares · {session.percent}%
                  </p>
                </div>
                <div className="mt-2">
                  <StackedBar segments={session.segments} />
                </div>
                <p className="mt-2 text-sm text-byla-muted">
                  {session.free} {session.free === 1 ? "lugar livre" : "lugares livres"}
                  {session.training > 0 ? ` · capacitação fora da lotação: ${session.training}` : ""}
                  {session.moneyLabel ? ` · ${session.moneyLabel}` : ""}
                  {session.pendingLabel ? ` · ${session.pendingLabel}` : ""}
                </p>
                {session.segments.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {session.segments.map((segment) => (
                      <li className="flex items-center gap-2" key={segment.key}>
                        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        {segment.label} {segment.people}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-byla-muted">Nenhum ingresso válido nesta sessão.</p>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section hint={view.dailyNote} title="Vendas ao longo do tempo">
            <DailyChart money={view.dailyIsMoney} rows={view.daily} />
          </Section>
          <Section hint={view.typeNote ?? "Pessoas. Casadinha conta cada pessoa, não a unidade."} title="Por tipo">
            {view.types.length ? (
              <DonutChart
                caption="pessoas"
                center={String(view.typeTotal)}
                parts={view.types.map((type) => ({ label: type.label, value: type.people, color: type.color }))}
              />
            ) : (
              <p className="text-sm text-byla-muted">Ainda não há ingressos válidos.</p>
            )}
          </Section>
        </div>

        {view.showSplit && view.split ? (
          <Section hint={view.split.note} title="Para onde vai o dinheiro">
            {splitOk && view.split ? (
              <div className="flex h-4 overflow-hidden rounded-full">
                <div style={{ width: `${(view.split.organizerCents / splitTotal) * 100}%`, background: "#4080FC" }} />
                <div style={{ width: `${(view.split.netCents / splitTotal) * 100}%`, background: "#4ADE80" }} />
                <div style={{ width: `${(view.split.providerCents / splitTotal) * 100}%`, background: "#F87171" }} />
              </div>
            ) : null}
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-byla-muted">Organizador</dt>
                <dd className="text-xl font-semibold tabular-nums">{view.split.organizer}</dd>
                <dd className="text-sm text-byla-muted">ingressos, sem desconto de taxa</dd>
              </div>
              <div>
                <dt className="text-sm text-byla-muted">Taxa líquida ACDH</dt>
                <dd className="text-xl font-semibold tabular-nums text-byla-success">{view.split.net}</dd>
                <dd className="text-sm text-byla-muted">taxa bruta menos a tarifa</dd>
              </div>
              <div>
                <dt className="text-sm text-byla-muted">Tarifa do provedor</dt>
                <dd className="text-xl font-semibold tabular-nums">{view.split.provider}</dd>
                <dd className="text-sm text-byla-muted">sai da taxa, não da parte do organizador</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-byla-muted">O cliente pagou {view.split.client}.</p>
          </Section>
        ) : null}

        {view.simpleLines.length ? (
          <Section hint={view.simpleNote ?? undefined} title="Seu financeiro">
            <dl>
              {view.simpleLines.map((line) => (
                <div className="flex items-baseline justify-between gap-3 border-b border-byla-border py-2 last:border-0" key={line.label}>
                  <dt className={line.emphasis ? "font-semibold" : "text-byla-muted"}>{line.label}</dt>
                  <dd className={cx("tabular-nums", line.emphasis && "text-lg font-semibold text-byla-success")}>{line.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {view.payments ? (
            <Section hint="Não há cupom nem canal de venda neste sistema." title="Como pagaram">
              {view.payments.length ? (
                <DonutChart
                  caption="pedidos"
                  center={String(view.paymentTotal)}
                  parts={view.payments.map((row) => ({ label: row.label, value: row.count, color: row.color }))}
                />
              ) : (
                <p className="text-sm text-byla-muted">Ainda não há pedidos pagos.</p>
              )}
            </Section>
          ) : null}
          <Section hint={view.noShowLabel} title="Portaria">
            <p className="text-3xl font-semibold tabular-nums">
              {view.doorPresent}
              <span className="text-lg font-normal text-byla-muted"> / {view.doorExpected}</span>
            </p>
            <p className="mt-1 text-sm text-byla-muted">{view.doorPercent}% dos ingressos válidos já entraram</p>
            {view.arrival.length ? (
              <ul className="mt-4 grid gap-4">
                {view.arrival.map((block) => (
                  <li key={block.title}>
                    <p className="mb-2 text-sm font-medium">Chegada · {block.title}</p>
                    <ArrivalChart buckets={block.buckets} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-byla-muted">Ainda não há entradas registradas.</p>
            )}
          </Section>
          <Section hint={`${view.meiaSold} meias válidas`} title="Meia-entrada">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-byla-muted">Comprovante ok</dt>
                <dd className="text-2xl font-semibold tabular-nums">{view.meiaOk}</dd>
              </div>
              <div>
                <dt className="text-byla-muted">Diferença paga</dt>
                <dd className="text-2xl font-semibold tabular-nums">{view.meiaDiff}</dd>
              </div>
              <div>
                <dt className="text-byla-muted">Recusadas</dt>
                <dd className="text-2xl font-semibold tabular-nums">{view.meiaRefused}</dd>
              </div>
              <div>
                <dt className="text-byla-muted">Ainda sem conferência</dt>
                <dd className="text-2xl font-semibold tabular-nums">{view.meiaUnmarked}</dd>
              </div>
            </dl>
          </Section>
          <Section hint={view.pendingHint} title="Pendentes">
            <p className="text-3xl font-semibold tabular-nums">{view.pendingTotal}</p>
            {view.pendingMoney ? <p className="mt-1 text-sm text-byla-muted">Reservas expiradas: {view.pendingMoney}</p> : null}
          </Section>
        </div>

        <Section title="Estornos e cancelamentos">
          <dl className="grid gap-2">
            {view.refundRows.map((row) => (
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-byla-border py-2 last:border-0" key={row.label}>
                <dt className="text-byla-muted">{row.label}</dt>
                <dd className="font-medium tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
          {view.refundMode === "full" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {FULL_REFUND.map((box) => (
                <article className="rounded-xl bg-byla-overlay p-3" key={box.title}>
                  <h3 className="font-semibold">{box.title}</h3>
                  <p className="mt-1 text-sm text-byla-muted">{box.text}</p>
                </article>
              ))}
            </div>
          ) : null}
          {view.refundMode === "simple" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {SIMPLE_REFUND.map((box) => (
                <article className="rounded-xl bg-byla-overlay p-3" key={box.title}>
                  <h3 className="font-semibold">{box.title}</h3>
                  <p className="mt-1 text-sm text-byla-muted">{box.text}</p>
                </article>
              ))}
            </div>
          ) : null}
          {view.refundMode === "count" ? (
            <p className="mt-3 text-sm text-byla-muted">O estorno devolve o pedido inteiro e a vaga volta na hora.</p>
          ) : null}
        </Section>
      </div>
    </main>
  );
}
