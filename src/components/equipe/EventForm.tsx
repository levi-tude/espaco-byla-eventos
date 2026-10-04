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
  type EditorSession,
  initialSessionDrafts,
  priceDraftFor,
  scheduleChangesWithSales,
  type PriceDraft,
  type SessionDraft,
  sessionsToInput,
} from "@/components/equipe/session-drafts";
import {
  AddSessionButton,
  draftChecks,
  LimitSummary,
  ScheduleWarning,
  SessionQuantityFields,
  SessionsEditor,
  SessionTimeFields,
} from "@/components/equipe/SessionsEditor";
import {
  draftTypesFromState,
  type EditorTicketType,
  initialTicketTypesState,
  savedTypeKey,
  ticketTypesFromState,
  TicketTypesEditor,
} from "@/components/equipe/TicketTypesEditor";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

type EventFormProps = {
  event?: {
    id: string;
    name: string;
    venue: string;
    description: string;
    ticketTypes: EditorTicketType[];
    sessions: EditorSession[];
    coverImageUrl: string | null;
  };
};

export function EventForm({ event }: EventFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [ticketTypes, setTicketTypes] = useState(() =>
    initialTicketTypesState(event?.ticketTypes),
  );
  const [drafts, setDrafts] = useState<SessionDraft[]>(() =>
    initialSessionDrafts(event?.sessions),
  );
  // Depois de salvar (ou se outra pessoa da equipe mudar o evento), o editor
  // recomeça do banco: tipo e sessão novos já salvos precisam do id para não
  // serem recriados. Vendas ficam de fora da chave para a atualização
  // automática não apagar edições.
  const savedKey = JSON.stringify([
    (event?.ticketTypes ?? []).map(({ id, preset, name, peoplePerUnit }) => [
      id,
      preset,
      name,
      peoplePerUnit,
    ]),
    (event?.sessions ?? []).map(
      ({ id, name, startsAt, endsAt, capacity, inteiraQuota, meiaQuota, prices }) => [
        id,
        name,
        startsAt,
        endsAt,
        capacity,
        inteiraQuota,
        meiaQuota,
        prices,
      ],
    ),
  ]);
  const [loadedKey, setLoadedKey] = useState(savedKey);
  if (loadedKey !== savedKey) {
    setLoadedKey(savedKey);
    setTicketTypes(initialTicketTypesState(event?.ticketTypes));
    setDrafts(initialSessionDrafts(event?.sessions));
  }

  const types = draftTypesFromState(ticketTypes);
  const single = drafts.length === 1;
  const only = drafts[0];
  const singleChecks = single ? draftChecks(only, types, true) : null;

  const sales = Object.fromEntries(
    (event?.ticketTypes ?? []).map((type) => [savedTypeKey(type), type]),
  );

  function updateOnly(patch: Partial<SessionDraft>) {
    setDrafts((current) =>
      current.map((draft, index) => (index === 0 ? { ...draft, ...patch } : draft)),
    );
  }

  const singlePrices = {
    get: (key: string) => priceDraftFor(only, key),
    set: (key: string, patch: Partial<PriceDraft>) =>
      setDrafts((current) =>
        current.map((draft, index) =>
          index === 0
            ? {
                ...draft,
                prices: { ...draft.prices, [key]: { ...priceDraftFor(draft, key), ...patch } },
              }
            : draft,
        ),
      ),
  };

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setMessage(null);

    const typesInput = ticketTypesFromState(ticketTypes);
    if (!typesInput.ok) {
      setMessage({ ok: false, text: typesInput.error });
      return;
    }
    for (const [index, draft] of drafts.entries()) {
      const checks = draftChecks(draft, types, single);
      const problem = checks.quotaProblem ?? checks.limitProblem;
      if (problem) {
        setMessage({ ok: false, text: single ? problem : `Sessão ${index + 1}: ${problem}` });
        return;
      }
    }
    const sessions = sessionsToInput(drafts, types);
    if (!sessions.ok) {
      setMessage({ ok: false, text: sessions.error });
      return;
    }
    const changed = scheduleChangesWithSales(drafts);
    if (changed.length) {
      const paid = changed.reduce((sum, item) => sum + item.paidOrders, 0);
      const ok = window.confirm(
        `Você mudou o horário de ${changed.length === 1 ? "uma sessão" : `${changed.length} sessões`} com ${paid === 1 ? "1 pedido pago" : `${paid} pedidos pagos`}. Os ingressos continuam valendo para o novo horário. Avise os compradores depois de salvar. Continuar?`,
      );
      if (!ok) return;
    }

    const data = new FormData(formEvent.currentTarget);
    const input: EventInput = {
      name: String(data.get("name") ?? ""),
      venue: String(data.get("venue") ?? ""),
      description: String(data.get("description") ?? ""),
      ticketTypes: typesInput.types,
      sessions: sessions.sessions,
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
        {single ? <SessionTimeFields draft={only} onChange={updateOnly} /> : null}
        <Field
          defaultValue={event?.venue}
          label="Local"
          name="venue"
          required
          wrapperClassName="@lg:col-span-2"
        />
      </div>

      {single && singleChecks ? (
        <>
          <ScheduleWarning draft={only} />
          <SessionQuantityFields checks={singleChecks} draft={only} onChange={updateOnly} />
          <AddSessionButton drafts={drafts} onChange={setDrafts} />
        </>
      ) : null}

      <TicketTypesEditor
        disabled={isPending}
        onChange={setTicketTypes}
        prices={single ? singlePrices : undefined}
        sales={sales}
        value={ticketTypes}
      />
      {single && singleChecks ? <LimitSummary checks={singleChecks} className="-mt-2" /> : null}

      {single ? null : (
        <SessionsEditor disabled={isPending} drafts={drafts} onChange={setDrafts} types={types} />
      )}

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
