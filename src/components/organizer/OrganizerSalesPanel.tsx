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
};

type Props = {
  eventId: string;
  approved: boolean;
  eventSalesOpen: boolean;
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

/** Vendas por sessão: vendidos, disponíveis e "Pausar vendas" / "Reabrir vendas". */
export function OrganizerSalesPanel({ eventId, approved, eventSalesOpen, sessions }: Props) {
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
              <dl className="grid grid-cols-2 gap-3">
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
              </dl>
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
        Vendidos inclui cortesias. A venda de cada sessão fecha sozinha 5 minutos depois do início.
      </p>
    </div>
  );
}
