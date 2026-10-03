"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import {
  createEvent,
  type EventInput,
  updateEvent,
} from "@/app/equipe/eventos/actions";
import { CoverField } from "@/components/equipe/CoverField";
import {
  type EditorTicketType,
  initialTicketTypesState,
  limitedTypesFromState,
  ticketTypesFromState,
  TicketTypesEditor,
} from "@/components/equipe/TicketTypesEditor";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { toEventInputValue } from "@/lib/datetime";
import { parseQuotaInput, quotaSummary, quotasError } from "@/lib/domain/quotas";
import { typeLimitsError, typeLimitsSummary } from "@/lib/domain/type-limits";

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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
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

  const limitTypes = limitedTypesFromState(ticketTypes);
  const limitProblem =
    !quotaProblem &&
    inteiraQuota !== undefined &&
    meiaQuota !== undefined &&
    Number.isInteger(capacityValue) &&
    capacityValue > 0
      ? typeLimitsError(capacityValue, { inteiraQuota, meiaQuota }, limitTypes)
      : null;
  const limitSummary = typeLimitsSummary(capacityValue, limitTypes);

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
      setMessage({ ok: false, text: types.error });
      return;
    }
    if (quotaProblem || inteiraQuota === undefined || meiaQuota === undefined) {
      setMessage(quotaProblem ? { ok: false, text: quotaProblem } : null);
      return;
    }
    if (limitProblem) {
      setMessage({ ok: false, text: limitProblem });
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
          if (!result.ok) return setMessage({ ok: false, text: result.error });
          setMessage({ ok: true, text: "Alterações salvas." });
          router.refresh();
        } else {
          const result = await createEvent(input);
          if (!result.ok) return setMessage({ ok: false, text: result.error });
          router.push(`/equipe/eventos/${result.data.id}`);
        }
      } catch {
        setMessage({ ok: false, text: "Não foi possível salvar o evento." });
      }
    });
  }

  return (
    <form
      className="@container grid gap-6 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-5 @lg:grid-cols-2">
        <Field
          defaultValue={event?.name}
          label="Nome"
          name="name"
          required
          wrapperClassName="@lg:col-span-2"
        />
        <Field
          defaultValue={toEventInputValue(event?.startsAt)}
          label="Data e hora"
          name="startsAt"
          required
          type="datetime-local"
        />
        <Field defaultValue={event?.venue} label="Local" name="venue" required />
      </div>

      <fieldset className="grid gap-4 rounded-xl border border-byla-border p-4">
        <legend className="px-1 text-base font-semibold">Quantidade de ingressos</legend>
        <div className="grid gap-4 @lg:grid-cols-3">
          <Field
            inputMode="numeric"
            label="Total de ingressos"
            min="1"
            name="capacity"
            onChange={(change) => setCount("capacity", change.target.value)}
            required
            step="1"
            type="number"
            value={counts.capacity}
          />
          <Field
            inputMode="numeric"
            label="Quantidade de inteiras"
            name="inteiraQuota"
            onChange={(change) => setCount("inteiraQuota", change.target.value)}
            placeholder="Sem quantidade separada"
            value={counts.inteiraQuota}
          />
          <Field
            inputMode="numeric"
            label="Quantidade de meias"
            name="meiaQuota"
            onChange={(change) => setCount("meiaQuota", change.target.value)}
            placeholder="Sem quantidade separada"
            value={counts.meiaQuota}
          />
        </div>
        <p className="text-sm text-byla-muted">
          Cada pessoa de Casadinha, Pacote família ou tipo novo conta como inteira. Cortesias
          contam só no total. Deixe em branco para não separar.
        </p>
        {summary ? (
          <p aria-live="polite" className="rounded-lg bg-byla-overlay px-3 py-2 text-base">
            <span className="font-semibold text-foreground">{summary.line}</span>
            <span
              className={
                quotaProblem
                  ? "block text-sm font-medium text-byla-danger"
                  : "block text-sm text-byla-muted"
              }
            >
              {quotaProblem ?? summary.detail}
            </span>
          </p>
        ) : quotaProblem ? (
          <p aria-live="polite" className="text-sm font-medium text-byla-danger">
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
      {limitProblem || limitSummary ? (
        <p
          aria-live="polite"
          className={
            limitProblem
              ? "-mt-2 text-sm font-medium text-byla-danger"
              : "-mt-2 text-sm text-byla-muted"
          }
        >
          {limitProblem ?? limitSummary}
        </p>
      ) : null}

      <TextAreaField defaultValue={event?.description} label="Descrição" name="description" />

      <CoverField defaultValue={event?.coverImageUrl ?? null} onBusyChange={setCoverBusy} />

      {message ? (
        <Notice tone={message.ok ? "success" : "danger"}>{message.text}</Notice>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 rounded-b-2xl border-t border-byla-border bg-byla-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
        <Button
          className="@lg:w-auto"
          disabled={coverBusy}
          fullWidth
          loading={isPending || coverBusy}
          loadingLabel={coverBusy ? "Enviando capa..." : "Salvando..."}
          size="lg"
          type="submit"
        >
          {event ? "Salvar alterações" : "Criar evento"}
        </Button>
      </div>
    </form>
  );
}

