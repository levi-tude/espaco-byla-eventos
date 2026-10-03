"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import {
  createEvent,
  type EventInput,
  setSalesOpen,
  updateEvent,
} from "@/app/equipe/eventos/actions";
import { CoverField } from "@/components/equipe/CoverField";
import {
  type EditorTicketType,
  initialTicketTypesState,
  ticketTypesFromState,
  TicketTypesEditor,
} from "@/components/equipe/TicketTypesEditor";
import { toEventInputValue } from "@/lib/datetime";

type EventFormProps = {
  event?: {
    id: string;
    name: string;
    startsAt: string;
    venue: string;
    description: string;
    capacity: number;
    ticketTypes: EditorTicketType[];
    coverImageUrl: string | null;
    salesOpen: boolean;
  };
};

export function EventForm({ event }: EventFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [ticketTypes, setTicketTypes] = useState(() =>
    initialTicketTypesState(event?.ticketTypes),
  );
  // Depois de salvar (ou se outra pessoa da equipe mudar os tipos), o editor
  // recomeça do banco: tipo novo já salvo precisa do id para não ser recriado.
  // Vendas ficam de fora da chave para a atualização automática não apagar edições.
  const savedTypesKey = JSON.stringify(
    (event?.ticketTypes ?? []).map(({ id, preset, name, priceCents, peoplePerUnit, maxUnits }) => [
      id,
      preset,
      name,
      priceCents,
      peoplePerUnit,
      maxUnits,
    ]),
  );
  const [loadedTypesKey, setLoadedTypesKey] = useState(savedTypesKey);
  if (loadedTypesKey !== savedTypesKey) {
    setLoadedTypesKey(savedTypesKey);
    setTicketTypes(initialTicketTypesState(event?.ticketTypes));
  }
  const sales = Object.fromEntries(
    (event?.ticketTypes ?? []).map((type) => [
      type.preset ? `preset:${type.preset}` : `id:${type.id}`,
      type,
    ]),
  );

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setMessage(null);

    const types = ticketTypesFromState(ticketTypes);
    if (!types.ok) {
      setMessage(types.error);
      return;
    }

    const data = new FormData(formEvent.currentTarget);
    const input: EventInput = {
      name: String(data.get("name") ?? ""),
      startsAt: String(data.get("startsAt") ?? ""),
      venue: String(data.get("venue") ?? ""),
      description: String(data.get("description") ?? ""),
      capacity: Number(data.get("capacity")),
      ticketTypes: types.types,
      coverImageUrl: String(data.get("coverImageUrl") ?? ""),
    };

    startTransition(async () => {
      try {
        if (event) {
          const result = await updateEvent(event.id, input);
          if (!result.ok) return setMessage(result.error);
          setMessage("Alterações salvas.");
          router.refresh();
        } else {
          const result = await createEvent(input);
          if (!result.ok) return setMessage(result.error);
          router.push(`/equipe/eventos/${result.data.id}`);
        }
      } catch {
        setMessage("Não foi possível salvar o evento.");
      }
    });
  }

  function toggleSales() {
    if (!event) return;
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await setSalesOpen(event.id, !event.salesOpen);
        if (!result.ok) return setMessage(result.error);
        router.refresh();
      } catch {
        setMessage("Não foi possível alterar a venda.");
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

      </div>

      <TicketTypesEditor
        disabled={isPending}
        onChange={setTicketTypes}
        sales={sales}
        value={ticketTypes}
      />

      <label className="grid gap-2 text-sm font-medium">
        Descrição
        <textarea
          className="min-h-28 rounded-lg border border-byla-border px-3 py-2.5 font-normal"
          defaultValue={event?.description}
          name="description"
        />
      </label>

      <CoverField defaultValue={event?.coverImageUrl ?? null} onBusyChange={setCoverBusy} />

      {message ? (
        <p className="text-sm text-zinc-300" role="status">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-byla-blue px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={isPending || coverBusy}
          type="submit"
        >
          {coverBusy ? "Enviando capa..." : isPending ? "Salvando..." : "Salvar"}
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
