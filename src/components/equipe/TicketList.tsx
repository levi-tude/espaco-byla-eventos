"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";

import {
  cancelTicket,
  issueCourtesy,
} from "@/app/equipe/eventos/actions";
import type { Enums } from "@/types/database";

export type TicketListItem = {
  id: string;
  buyerName: string;
  buyerEmail: string;
  kind: Enums<"ticket_kind">;
  status: Enums<"ticket_status">;
  priceCents: number;
  paidAt: string | null;
  checkedInAt: string | null;
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
  nao_pago: "Aguardando pagamento",
  pago: "Pago",
  cancelado: "Cancelado",
  check_in: "Check-in realizado",
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TicketList({ eventId, remaining, tickets }: Props) {
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
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
        await issueCourtesy({
          eventId,
          name: String(formData.get("name") ?? ""),
          email: String(formData.get("email") ?? ""),
        });
        form.reset();
        setMessage("Cortesia emitida com sucesso.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Não foi possível emitir.",
        );
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
        await cancelTicket(eventId, ticket.id);
        setMessage("Ingresso cancelado. A vaga foi liberada.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Não foi possível cancelar.",
        );
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
        className="rounded-xl border border-zinc-200 bg-white p-6"
        onSubmit={submitCourtesy}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Emitir cortesia</h2>
            <p className="text-sm text-zinc-600">
              {remaining} {remaining === 1 ? "vaga disponível" : "vagas disponíveis"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-medium">
            Nome
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-zinc-300 px-3"
              disabled={isPending || remaining === 0}
              name="name"
              required
            />
          </label>
          <label className="text-sm font-medium">
            E-mail
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-zinc-300 px-3"
              disabled={isPending || remaining === 0}
              name="email"
              required
              type="email"
            />
          </label>
          <button
            className="self-end rounded-lg bg-zinc-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
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
      </form>

      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Lista de participantes</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {tickets.length} {tickets.length === 1 ? "ingresso" : "ingressos"}
            </p>
          </div>
          <label className="text-sm font-medium">
            Buscar por nome
            <input
              className="mt-1 block min-h-10 w-full rounded-lg border border-zinc-300 px-3 sm:w-72"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome do participante"
              type="search"
              value={search}
            />
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-600">
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
                <tr className="border-b border-zinc-100" key={ticket.id}>
                  <td className="px-3 py-4">
                    <span className="font-medium">{ticket.buyerName}</span>
                    <span className="block text-xs text-zinc-500">
                      {ticket.buyerEmail}
                    </span>
                  </td>
                  <td className="px-3 py-4">{kindLabels[ticket.kind]}</td>
                  <td className="px-3 py-4">{statusLabels[ticket.status]}</td>
                  <td className="px-3 py-4">
                    {currency.format(ticket.priceCents / 100)}
                  </td>
                  <td className="px-3 py-4">{formatDate(ticket.paidAt)}</td>
                  <td className="px-3 py-4">{formatDate(ticket.checkedInAt)}</td>
                  <td className="px-3 py-4">
                    {ticket.status === "pago" ? (
                      <button
                        className="font-medium text-red-700 disabled:opacity-50"
                        disabled={isPending}
                        onClick={() => requestCancellation(ticket)}
                        type="button"
                      >
                        Cancelar
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTickets.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-600">
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
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
