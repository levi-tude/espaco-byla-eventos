"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import {
  createEvent,
  type EventInput,
  setSalesOpen,
  updateEvent,
} from "@/app/equipe/eventos/actions";
import { toEventInputValue } from "@/lib/datetime";

type EventFormProps = {
  event?: {
    id: string;
    name: string;
    startsAt: string;
    venue: string;
    description: string;
    capacity: number;
    fullPriceCents: number;
    halfPriceCents: number;
    coverImageUrl: string | null;
    salesOpen: boolean;
  };
};

function toCents(value: string) {
  return Math.round(Number(value.replace(",", ".")) * 100);
}

function priceValue(cents?: number) {
  return cents === undefined ? "" : (cents / 100).toFixed(2);
}

export function EventForm({ event }: EventFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setMessage(null);

    const data = new FormData(formEvent.currentTarget);
    const input: EventInput = {
      name: String(data.get("name") ?? ""),
      startsAt: String(data.get("startsAt") ?? ""),
      venue: String(data.get("venue") ?? ""),
      description: String(data.get("description") ?? ""),
      capacity: Number(data.get("capacity")),
      fullPriceCents: toCents(String(data.get("fullPrice") ?? "")),
      halfPriceCents: toCents(String(data.get("halfPrice") ?? "")),
      coverImageUrl: String(data.get("coverImageUrl") ?? ""),
    };

    startTransition(async () => {
      try {
        if (event) {
          await updateEvent(event.id, input);
          setMessage("Alterações salvas.");
          router.refresh();
        } else {
          const created = await createEvent(input);
          router.push(`/equipe/eventos/${created.id}`);
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível salvar o evento.",
        );
      }
    });
  }

  function toggleSales() {
    if (!event) return;
    setMessage(null);

    startTransition(async () => {
      try {
        await setSalesOpen(event.id, !event.salesOpen);
        router.refresh();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Não foi possível alterar a venda.",
        );
      }
    });
  }

  return (
    <form
      className="grid gap-6 rounded-xl border border-byla-border bg-byla-surface p-6"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Nome
          <input
            className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
            defaultValue={event?.name}
            name="name"
            required
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Data e hora
          <input
            className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
            defaultValue={toEventInputValue(event?.startsAt)}
            name="startsAt"
            required
            type="datetime-local"
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Local
          <input
            className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
            defaultValue={event?.venue}
            name="venue"
            required
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Capacidade
          <input
            className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
            defaultValue={event?.capacity}
            min="1"
            name="capacity"
            required
            step="1"
            type="number"
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Preço inteira (R$)
          <input
            className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
            defaultValue={priceValue(event?.fullPriceCents)}
            min="0"
            name="fullPrice"
            required
            step="0.01"
            type="number"
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Preço meia (R$)
          <input
            className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
            defaultValue={priceValue(event?.halfPriceCents)}
            min="0"
            name="halfPrice"
            required
            step="0.01"
            type="number"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        Descrição
        <textarea
          className="min-h-28 rounded-lg border border-byla-border px-3 py-2.5 font-normal"
          defaultValue={event?.description}
          name="description"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        URL da capa (opcional)
        <input
          className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
          defaultValue={event?.coverImageUrl ?? ""}
          name="coverImageUrl"
          placeholder="https://..."
          type="url"
        />
      </label>

      {message ? (
        <p className="text-sm text-zinc-300" role="status">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-byla-blue px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>

        {event ? (
          <button
            className="rounded-lg border border-byla-border px-5 py-2.5 text-sm font-medium disabled:opacity-50"
            disabled={isPending}
            onClick={toggleSales}
            type="button"
          >
            {event.salesOpen ? "Fechar venda" : "Abrir venda"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
