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
import { parseQuotaInput, quotaSummary, quotasError } from "@/lib/domain/quotas";

type EventFormProps = {
  event?: {
    id: string;
    name: string;
    startsAt: string;
    venue: string;
    description: string;
    capacity: number;
    inteiraQuota: number | null;
    meiaQuota: number | null;
    ticketTypes: EditorTicketType[];
    coverImageUrl: string | null;
    salesOpen: boolean;
  };
};

type Counts = { capacity: string; inteiraQuota: string; meiaQuota: string };

function initialCounts(event: EventFormProps["event"]): Counts {
  return {
    capacity: event ? String(event.capacity) : "",
    inteiraQuota: event?.inteiraQuota == null ? "" : String(event.inteiraQuota),
    meiaQuota: event?.meiaQuota == null ? "" : String(event.meiaQuota),
  };
}

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
  const savedCounts = initialCounts(event);
  const [counts, setCounts] = useState(savedCounts);
  const savedCountsKey = JSON.stringify(savedCounts);
  const [loadedCountsKey, setLoadedCountsKey] = useState(savedCountsKey);
  if (loadedCountsKey !== savedCountsKey) {
    setLoadedCountsKey(savedCountsKey);
    setCounts(savedCounts);
  }
  const capacityValue = Number(counts.capacity);
  const inteiraQuota = parseQuotaInput(counts.inteiraQuota);
  const meiaQuota = parseQuotaInput(counts.meiaQuota);
  const quotaProblem =
    inteiraQuota === undefined || meiaQuota === undefined
      ? "Use números inteiros nas quantidades de inteiras e meias, ou deixe em branco."
      : Number.isInteger(capacityValue) && capacityValue > 0
        ? quotasError(capacityValue, { inteiraQuota, meiaQuota })
        : null;
  const summary =
    inteiraQuota === undefined || meiaQuota === undefined
      ? null
      : quotaSummary(capacityValue, { inteiraQuota, meiaQuota });

  function setCount(field: keyof Counts, value: string) {
    setCounts((current) => ({ ...current, [field]: value }));
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
    if (quotaProblem || inteiraQuota === undefined || meiaQuota === undefined) {
      setMessage(quotaProblem);
      return;
    }

    const data = new FormData(formEvent.currentTarget);
    const input: EventInput = {
      name: String(data.get("name") ?? ""),
      startsAt: String(data.get("startsAt") ?? ""),
      venue: String(data.get("venue") ?? ""),
      description: String(data.get("description") ?? ""),
      capacity: capacityValue,
      inteiraQuota,
      meiaQuota,
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

      </div>

      <fieldset className="grid gap-4 rounded-lg border border-byla-border p-4">
        <legend className="px-1 text-sm font-semibold">Quantidade de ingressos</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium">
            Total de ingressos
            <input
              className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
              min="1"
              name="capacity"
              onChange={(change) => setCount("capacity", change.target.value)}
              required
              step="1"
              type="number"
              value={counts.capacity}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Quantidade de inteiras
            <input
              className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
              inputMode="numeric"
              name="inteiraQuota"
              onChange={(change) => setCount("inteiraQuota", change.target.value)}
              placeholder="Sem quantidade separada"
              value={counts.inteiraQuota}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Quantidade de meias
            <input
              className="rounded-lg border border-byla-border px-3 py-2.5 font-normal"
              inputMode="numeric"
              name="meiaQuota"
              onChange={(change) => setCount("meiaQuota", change.target.value)}
              placeholder="Sem quantidade separada"
              value={counts.meiaQuota}
            />
          </label>
        </div>
        <p className="text-xs text-byla-muted">
          Cada pessoa de Casadinha, Pacote família ou tipo novo conta como inteira. Cortesias
          contam só no total. Deixe em branco para não separar.
        </p>
        {summary ? (
          <p aria-live="polite" className="text-sm">
            <span className="font-medium text-foreground">{summary.line}</span>
            <span className="block text-byla-muted">{quotaProblem ?? summary.detail}</span>
          </p>
        ) : quotaProblem ? (
          <p aria-live="polite" className="text-sm text-byla-muted">
            {quotaProblem}
          </p>
        ) : null}
      </fieldset>

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
