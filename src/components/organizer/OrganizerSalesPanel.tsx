"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  setOrganizerEventSales,
  setOrganizerSessionSales,
} from "@/app/organizador/eventos/actions";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Tone } from "@/components/ui/tone";
import type { ActionResult } from "@/lib/action-result";
import { formatMoney } from "@/lib/domain/service-fee";

export type OrganizerSalesTypeRow = {
  ticketTypeId: string;
  name: string;
  /** Unidades vendidas (pago / check-in). */
  unitsSold: number;
  /** Pessoas (ingressos) geradas por essas unidades. */
  peopleSold: number;
  peoplePerUnit: number;
  revenueCents: number;
  maxUnits: number | null;
};

export type OrganizerSalesSession = {
  id: string;
  label: string;
  cancelled: boolean;
  /** Já passou do horário em que a venda fecha sozinha (início + 5 min). */
  closed: boolean;
  salesOpen: boolean;
  selling: boolean;
  soldOut: boolean;
  /** Pessoas com ingresso (inclui cortesias); `null` = não foi possível contar. */
  sold: number | null;
  /** Lugares livres; `null` = não foi possível contar. */
  remaining: number | null;
  /** Reservas aguardando pagamento. */
  held: number | null;
  revenueCents: number;
  types: OrganizerSalesTypeRow[];
};

export type OrganizerSalesTotals = {
  sold: number | null;
  remaining: number | null;
  held: number | null;
  revenueCents: number;
  types: OrganizerSalesTypeRow[];
};

type Props = {
  eventId: string;
  approved: boolean;
  eventSalesOpen: boolean;
  totals: OrganizerSalesTotals;
  sessions: OrganizerSalesSession[];
};

function sessionBadge(session: OrganizerSalesSession, eventSalesOpen: boolean): { label: string; tone: Tone } {
  if (session.cancelled) return { label: "Cancelada", tone: "danger" };
  if (session.closed) return { label: "Encerrada", tone: "neutral" };
  if (!eventSalesOpen || !session.salesOpen) return { label: "Pausada", tone: "warning" };
  if (session.soldOut) return { label: "Esgotada", tone: "danger" };
  return session.selling ? { label: "À venda", tone: "success" } : { label: "Fechada", tone: "neutral" };
}

function SalesButton({
  open,
  confirmText,
  ariaLabel,
  run,
}: {
  open: boolean;
  confirmText: string;
  ariaLabel?: string;
  run: (open: boolean) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (open && !window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await run(!open);
        if (!result.ok) return setError(result.error);
        router.refresh();
      } catch {
        setError("Não foi possível alterar as vendas.");
      }
    });
  }

  return (
    <>
      <Button
        aria-label={ariaLabel}
        className="sm:w-auto"
        fullWidth
        loading={isPending}
        loadingLabel={open ? "Pausando..." : "Reabrindo..."}
        onClick={toggle}
        variant="secondary"
      >
        {open ? "Pausar vendas" : "Reabrir vendas"}
      </Button>
      {error ? (
        <Notice className="basis-full" tone="danger">
          {error}
        </Notice>
      ) : null}
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-byla-border bg-byla-surface p-4">
      <dt className="text-sm text-byla-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
      {hint ? <dd className="mt-1 text-sm text-byla-muted">{hint}</dd> : null}
    </div>
  );
}

function TypeBreakdown({ types }: { types: OrganizerSalesTypeRow[] }) {
  if (!types.length) {
    return <p className="text-sm text-byla-muted">Ainda não há ingressos pagos neste recorte.</p>;
  }
  return (
    <ul className="mt-2 grid gap-2">
      {types.map((type) => (
        <li
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-base"
          key={type.ticketTypeId}
        >
          <span className="min-w-0 font-medium text-foreground">
            {type.name}
            {type.peoplePerUnit > 1 ? (
              <span className="font-normal text-byla-muted">
                {" "}
                · {type.peoplePerUnit} pessoas por unidade
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-byla-muted tabular-nums">
            {type.unitsSold} {type.unitsSold === 1 ? "un." : "un."}
            {" · "}
            {type.peopleSold} {type.peopleSold === 1 ? "pessoa" : "pessoas"}
            {type.maxUnits !== null ? ` · limite ${type.maxUnits}` : ""}
            {" · "}
            {formatMoney(type.revenueCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Panorama de vendas: totais do evento, por sessão e por tipo. */
export function OrganizerSalesPanel({
  eventId,
  approved,
  eventSalesOpen,
  totals,
  sessions,
}: Props) {
  if (!approved) {
    return (
      <p className="text-base text-byla-muted">
        As vendas abrem depois que a ACDH Eventos aprovar o evento.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-byla-border bg-byla-surface p-4">
        <p className="text-base text-foreground">
          {eventSalesOpen
            ? "Vendas abertas. Pausar aqui para todas as sessões de uma vez."
            : "Vendas pausadas em todas as sessões."}
        </p>
        <SalesButton
          ariaLabel={eventSalesOpen ? "Pausar vendas de todas as sessões" : "Reabrir vendas do evento"}
          confirmText="Pausar as vendas de todas as sessões? Você pode reabrir depois."
          open={eventSalesOpen}
          run={(open) => setOrganizerEventSales(eventId, open)}
        />
      </div>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-foreground">Resumo do evento</h3>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            hint="inclui cortesias"
            label="Vendidos"
            value={totals.sold ?? "—"}
          />
          <StatCard label="Disponíveis" value={totals.remaining ?? "—"} />
          <StatCard
            hint="compras aguardando pagamento"
            label="Reservados agora"
            value={totals.held ?? "—"}
          />
          <StatCard
            hint="ingressos pagos (sem taxa de serviço)"
            label="Arrecadado"
            value={formatMoney(totals.revenueCents)}
          />
        </dl>
        <div className="rounded-xl border border-byla-border bg-byla-surface p-4">
          <h4 className="text-sm font-semibold text-foreground">Por tipo de ingresso</h4>
          <TypeBreakdown types={totals.types} />
        </div>
      </section>

      <ul className="grid gap-3">
        {sessions.map((session) => {
          const badge = sessionBadge(session, eventSalesOpen);
          const canToggle = eventSalesOpen && !session.cancelled && !session.closed;
          return (
            <li
              className="grid gap-3 rounded-xl border border-byla-border bg-byla-surface p-4"
              key={session.id}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-foreground">{session.label}</h3>
                <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-sm text-byla-muted">Vendidos</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-foreground">
                    {session.sold ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-byla-muted">Disponíveis</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-foreground">
                    {session.cancelled ? 0 : (session.remaining ?? "—")}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-byla-muted">Reservados</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-foreground">
                    {session.held ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-byla-muted">Arrecadado</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-foreground">
                    {formatMoney(session.revenueCents)}
                  </dd>
                </div>
              </dl>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Tipos nesta sessão</h4>
                <TypeBreakdown types={session.types} />
              </div>
              {canToggle ? (
                <div className="flex flex-wrap items-center gap-3">
                  <SalesButton
                    ariaLabel={`${session.salesOpen ? "Pausar" : "Reabrir"} vendas: ${session.label}`}
                    confirmText="Pausar as vendas desta sessão? Você pode reabrir depois."
                    open={session.salesOpen}
                    run={(open) => setOrganizerSessionSales(session.id, open)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-byla-muted">
        Vendidos inclui cortesias. Casadinha e pacote família contam como unidades; cada unidade
        gera vários ingressos (pessoas). A venda de cada sessão fecha sozinha 5 minutos depois do
        início.
      </p>
    </div>
  );
}
