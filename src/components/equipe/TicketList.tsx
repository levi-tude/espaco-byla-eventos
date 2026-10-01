"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, useTransition } from "react";

import {
  cancelTicket,
  issueCourtesy,
} from "@/app/equipe/eventos/actions";
import { eventDateFormatter } from "@/lib/datetime";
import { decisionLabel } from "@/lib/domain/status";
import type { Enums } from "@/types/database";

export type TicketListItem = {
  id: string;
  buyerName: string;
  buyerEmail: string;
  kind: Enums<"ticket_kind">;
  status: Enums<"ticket_status">;
  orderStatus: Enums<"order_status">;
  decisionReason: string | null;
  priceCents: number;
  paidAt: string | null;
  /** Pago nas últimas 24 h (calculado no servidor). */
  recentlyPaid: boolean;
  checkedInAt: string | null;
  publicToken: string;
};

type Props = {
  eventId: string;
  remaining: number;
  tickets: TicketListItem[];
};

const kindLabels: Record<Enums<"ticket_kind">, string> = {
  inteira: "Inteira",
  meia: "Meia-entrada",
  cortesia: "Cortesia",
};

const statusLabels: Record<Enums<"ticket_status">, string> = {
  nao_pago: "Não pago",
  pago: "Pago",
  cancelado: "Cancelado",
  check_in: "Check-in",
  estornado: "Estornado",
};

const statusBadgeClasses: Record<Enums<"ticket_status">, string> = {
  pago: "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-300",
  check_in:
    "border-sky-600/40 bg-sky-500/15 text-sky-800 dark:border-sky-400/40 dark:text-sky-300",
  nao_pago: "border-byla-border bg-byla-overlay text-byla-muted",
  cancelado: "border-byla-border bg-byla-overlay text-byla-muted",
  estornado: "border-byla-border bg-byla-overlay text-byla-muted line-through",
};

const decisionBadgeClass =
  "border-amber-600/40 bg-amber-500/15 text-amber-800 dark:border-amber-400/40 dark:text-amber-300";

/** Pedido aguardando decisão aparece pelo estado do pedido, não do ingresso (ainda não pago). */
function statusBadge(ticket: TicketListItem) {
  if (ticket.orderStatus === "aguardando_decisao") {
    return { label: decisionLabel(ticket.decisionReason), className: decisionBadgeClass };
  }
  return {
    label: statusLabels[ticket.status],
    className: statusBadgeClasses[ticket.status],
  };
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDate(value: string | null) {
  if (!value) return "—";

  return eventDateFormatter({
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TicketList({ eventId, remaining, tickets }: Props) {
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [lastTicketUrl, setLastTicketUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return tickets;

    return tickets.filter((ticket) =>
      ticket.buyerName.toLocaleLowerCase("pt-BR").includes(term),
    );
  }, [search, tickets]);

  const soldTickets = tickets.filter(
    ({ status }) => status === "pago" || status === "check_in",
  );
  const recentCount = tickets.filter(({ recentlyPaid }) => recentlyPaid).length;
  const totals = {
    inteira: soldTickets.filter(({ kind }) => kind === "inteira").length,
    meia: soldTickets.filter(({ kind }) => kind === "meia").length,
    cortesia: soldTickets.filter(({ kind }) => kind === "cortesia").length,
    revenueCents: soldTickets.reduce(
      (total, ticket) => total + ticket.priceCents,
      0,
    ),
  };

  function submitCourtesy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const result = await issueCourtesy({
          eventId,
          name: String(formData.get("name") ?? ""),
          email: String(formData.get("email") ?? ""),
        });
        if (!result.ok) {
          setLastTicketUrl(null);
          setMessage(result.error);
          return;
        }
        form.reset();
        setLastTicketUrl(`/pedidos/${result.data.publicToken}`);
        setMessage("Cortesia emitida com sucesso. Abra o ingresso abaixo.");
      } catch {
        setLastTicketUrl(null);
        setMessage("Não foi possível emitir.");
      }
    });
  }

  function requestCancellation(ticket: TicketListItem) {
    if (
      !window.confirm(
        `Tem certeza que deseja cancelar o ingresso de ${ticket.buyerName}?`,
      )
    ) {
      return;
    }

    setMessage("");
    startTransition(async () => {
      try {
        const result = await cancelTicket(eventId, ticket.id);
        setMessage(result.ok ? "Ingresso cancelado. A vaga foi liberada." : result.error);
      } catch {
        setMessage("Não foi possível cancelar.");
      }
    });
  }

  return (
    <section className="mt-8 space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <TotalCard label="Inteiras" value={String(totals.inteira)} />
        <TotalCard label="Meias" value={String(totals.meia)} />
        <TotalCard label="Cortesias" value={String(totals.cortesia)} />
        <TotalCard
          label="Total vendido"
          value={currency.format(totals.revenueCents / 100)}
        />
      </div>

      <form
        className="rounded-xl border border-byla-border bg-byla-surface p-6"
        onSubmit={submitCourtesy}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Emitir cortesia</h2>
            <p className="text-sm text-byla-muted">
              {remaining} {remaining === 1 ? "vaga disponível" : "vagas disponíveis"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-medium">
            Nome
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-byla-border px-3"
              disabled={isPending || remaining === 0}
              name="name"
              required
            />
          </label>
          <label className="text-sm font-medium">
            E-mail
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-byla-border px-3"
              disabled={isPending || remaining === 0}
              name="email"
              required
              type="email"
            />
          </label>
          <button
            className="self-end rounded-lg bg-byla-blue px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isPending || remaining === 0}
            type="submit"
          >
            {isPending ? "Processando..." : "Emitir cortesia"}
          </button>
        </div>
        {message ? (
          <p aria-live="polite" className="mt-3 text-sm font-medium">
            {message}
          </p>
        ) : null}
        {lastTicketUrl ? (
          <p className="mt-3">
            <Link
              className="inline-flex rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
              href={lastTicketUrl}
              target="_blank"
            >
              Abrir ingresso (QR)
            </Link>
          </p>
        ) : null}
      </form>

      <div className="rounded-xl border border-byla-border bg-byla-surface p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Lista de participantes</h2>
            <p className="mt-1 text-sm text-byla-muted">
              {tickets.length} {tickets.length === 1 ? "ingresso" : "ingressos"}
              {recentCount > 0 ? (
                <>
                  {" · "}
                  <span className="font-semibold text-amber-800 dark:text-byla-yellow">
                    {recentCount} {recentCount === 1 ? "pago" : "pagos"} nas
                    últimas 24 h
                  </span>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-byla-muted">
              A lista atualiza sozinha a cada 30 segundos.
            </p>
          </div>
          <label className="text-sm font-medium">
            Buscar por nome
            <input
              className="mt-1 block min-h-10 w-full rounded-lg border border-byla-border px-3 sm:w-72"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome do participante"
              type="search"
              value={search}
            />
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-byla-border text-byla-muted">
              <tr>
                <th className="px-3 py-3 font-medium">Nome</th>
                <th className="px-3 py-3 font-medium">Tipo</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Valor</th>
                <th className="px-3 py-3 font-medium">Pagamento</th>
                <th className="px-3 py-3 font-medium">Check-in</th>
                <th className="px-3 py-3 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map((ticket) => (
                <tr
                  className={`border-b border-byla-border ${
                    ticket.recentlyPaid ? "bg-emerald-500/5" : ""
                  }`}
                  key={ticket.id}
                >
                  <td className="px-3 py-4">
                    <span className="font-medium">{ticket.buyerName}</span>
                    <span className="block text-xs text-byla-muted">
                      {ticket.buyerEmail}
                    </span>
                  </td>
                  <td className="px-3 py-4">{kindLabels[ticket.kind]}</td>
                  <td className="px-3 py-4">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadge(ticket).className}`}
                      >
                        {statusBadge(ticket).label}
                      </span>
                      {ticket.recentlyPaid ? (
                        <span
                          className="inline-flex rounded-full bg-byla-yellow px-2 py-0.5 text-xs font-bold text-black"
                          title="Pago nas últimas 24 horas"
                        >
                          Novo
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    {currency.format(ticket.priceCents / 100)}
                  </td>
                  <td className="px-3 py-4">{formatDate(ticket.paidAt)}</td>
                  <td className="px-3 py-4">{formatDate(ticket.checkedInAt)}</td>
                  <td className="px-3 py-4">
                    <div className="flex flex-col gap-2">
                      {ticket.status === "pago" ||
                      ticket.status === "check_in" ? (
                        <Link
                          className="font-medium text-byla-blue hover:underline"
                          href={`/pedidos/${ticket.publicToken}`}
                          target="_blank"
                        >
                          Abrir ingresso
                        </Link>
                      ) : null}
                      {ticket.status === "pago" ? (
                        <button
                          className="text-left font-medium text-red-700 disabled:opacity-50 dark:text-red-400"
                          disabled={isPending}
                          onClick={() => requestCancellation(ticket)}
                          type="button"
                        >
                          Cancelar
                        </button>
                      ) : null}
                      {ticket.status !== "pago" &&
                      ticket.status !== "check_in" ? (
                        <span>—</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTickets.length === 0 ? (
            <p className="py-8 text-center text-sm text-byla-muted">
              Nenhum ingresso encontrado.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-byla-border bg-byla-surface p-5">
      <p className="text-sm text-byla-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
