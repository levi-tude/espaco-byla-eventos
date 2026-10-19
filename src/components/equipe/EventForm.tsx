"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

import {
  createEvent,
  type EventInput,
  updateEvent,
} from "@/app/equipe/eventos/actions";
import {
  createOrganizerEvent,
  updateOrganizerEvent,
  withdrawEventSubmission,
} from "@/app/organizador/eventos/actions";
import { CoverField } from "@/components/equipe/CoverField";
import {
  type EditorSession,
  initialSessionDrafts,
  lockedLimitKeys,
  lockedPriceKeys,
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
  LOCKED_FIELD_CLASS,
  LockedNote,
  PriceLockNote,
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
  type TicketTypeLocks,
  ticketTypesFromState,
  TicketTypesEditor,
} from "@/components/equipe/TicketTypesEditor";
import { CHANGE_SENT_MESSAGE, RequestChangeDialog } from "@/components/organizer/RequestChangeDialog";
import { Button } from "@/components/ui/Button";
import { Field, TextAreaField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { LockedField } from "@/lib/organizer/post-approval";

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
  /** "organizador": ações do organizador; o evento novo nasce rascunho. */
  area?: "equipe" | "organizador";
  /** Campos do evento travados depois da aprovação (nome, local). Os da sessão vêm em `sessions[].lockedFields`. */
  lockedFields?: LockedField[];
  /** Evento em análise: tudo só leitura, com "Voltar para rascunho". */
  inReview?: boolean;
};

export function EventForm({ event, area = "equipe", lockedFields = [], inReview = false }: EventFormProps) {
  const router = useRouter();
  const organizer = area === "organizador";
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [changeTopic, setChangeTopic] = useState<string | null>(null);
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
      ({ id, name, startsAt, endsAt, capacity, inteiraQuota, meiaQuota, prices, lockedFields: locks }) => [
        id,
        name,
        startsAt,
        endsAt,
        capacity,
        inteiraQuota,
        meiaQuota,
        prices,
        locks ?? null,
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
  const nameLocked = lockedFields.includes("nome");
  const venueLocked = lockedFields.includes("local");
  const requestChange = organizer && event ? (topic: string) => setChangeTopic(topic) : undefined;
  const requestFor = (topic: string) => (requestChange ? () => requestChange(topic) : undefined);

  const typeLocks: TicketTypeLocks | undefined = organizer
    ? {
        types: new Set(drafts.flatMap((draft) => [...lockedPriceKeys(draft)])),
        prices: single ? lockedPriceKeys(only) : new Set(),
        limits: single ? lockedLimitKeys(only) : new Set(),
      }
    : undefined;

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
    if (inReview) return;

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
          const result = organizer
            ? await updateOrganizerEvent(event.id, input)
            : await updateEvent(event.id, input);
          if (!result.ok) return setMessage({ ok: false, text: result.error });
          setMessage({ ok: true, text: "Alterações salvas." });
          router.refresh();
        } else {
          const result = organizer ? await createOrganizerEvent(input) : await createEvent(input);
          if (!result.ok) return setMessage({ ok: false, text: result.error });
          router.push(`${organizer ? "/organizador" : "/equipe"}/eventos/${result.data.id}`);
        }
      } catch {
        setMessage({ ok: false, text: "Não foi possível salvar o evento." });
      }
    });
  }

  function backToDraft() {
    if (!event) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await withdrawEventSubmission(event.id);
        if (!result.ok) return setMessage({ ok: false, text: result.error });
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "Não foi possível voltar para rascunho." });
      }
    });
  }

  return (
    <>
      <form
        className="@container grid gap-6 rounded-2xl border border-byla-border bg-byla-surface p-4 sm:p-6"
        onSubmit={handleSubmit}
      >
        <fieldset className="grid min-w-0 gap-6" disabled={inReview}>
          <div className="grid gap-5 @lg:grid-cols-2">
            <div className="grid gap-2 @lg:col-span-2">
              <Field
                className={LOCKED_FIELD_CLASS}
                defaultValue={event?.name}
                label="Nome"
                name="name"
                readOnly={nameLocked}
                required
              />
              {nameLocked ? (
                <LockedNote onRequestChange={requestFor("Nome do evento")}>
                  Depois da aprovação, o nome muda só com o ACDH Eventos.
                </LockedNote>
              ) : null}
            </div>
            {single ? (
              <SessionTimeFields
                draft={only}
                onChange={updateOnly}
                onRequestChange={requestFor("Horário")}
              />
            ) : null}
            <div className="grid gap-2 @lg:col-span-2">
              <Field
                className={LOCKED_FIELD_CLASS}
                defaultValue={event?.venue}
                label="Local"
                name="venue"
                readOnly={venueLocked}
                required
              />
              {venueLocked ? (
                <LockedNote onRequestChange={requestFor("Local")}>
                  Depois da aprovação, o local muda só com o ACDH Eventos.
                </LockedNote>
              ) : null}
            </div>
          </div>

          {single && singleChecks ? (
            <>
              <ScheduleWarning draft={only} />
              <SessionQuantityFields
                checks={singleChecks}
                draft={only}
                onChange={updateOnly}
                onRequestChange={requestFor("Lugares")}
              />
              <AddSessionButton drafts={drafts} onChange={setDrafts} />
            </>
          ) : null}

          <TicketTypesEditor
            area={area}
            disabled={isPending}
            locks={typeLocks}
            onChange={setTicketTypes}
            prices={single ? singlePrices : undefined}
            sales={sales}
            value={ticketTypes}
          />
          {single && singleChecks ? <LimitSummary checks={singleChecks} className="-mt-2" /> : null}
          {single ? <PriceLockNote draft={only} onRequestChange={requestFor("Preços")} /> : null}

          {single ? null : (
            <SessionsEditor
              disabled={isPending}
              drafts={drafts}
              onChange={setDrafts}
              onRequestChange={requestChange}
              types={types}
            />
          )}

          <TextAreaField defaultValue={event?.description} label="Descrição" name="description" />

          <CoverField
            allowLink={!organizer}
            defaultValue={event?.coverImageUrl ?? null}
            onBusyChange={setCoverBusy}
          />
        </fieldset>

        {message ? (
          <Notice tone={message.ok ? "success" : "danger"}>{message.text}</Notice>
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 rounded-b-2xl border-t border-byla-border bg-byla-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:-mb-6 sm:px-6">
          {inReview ? (
            <div className="grid gap-2 @lg:flex @lg:items-center @lg:justify-between">
              <p className="text-sm text-byla-muted">
                Em análise, o evento não pode ser editado. Para mudar algo, volte para rascunho e envie de novo.
              </p>
              <Button
                className="@lg:w-auto"
                fullWidth
                loading={isPending}
                loadingLabel="Voltando..."
                onClick={backToDraft}
                size="lg"
                variant="secondary"
              >
                Voltar para rascunho
              </Button>
            </div>
          ) : (
            <Button
              className="@lg:w-auto"
              disabled={coverBusy}
              fullWidth
              loading={isPending || coverBusy}
              loadingLabel={coverBusy ? "Enviando capa..." : "Salvando..."}
              size="lg"
              type="submit"
            >
              {event ? "Salvar alterações" : organizer ? "Salvar rascunho" : "Criar evento"}
            </Button>
          )}
        </div>
      </form>

      {event && changeTopic ? (
        <RequestChangeDialog
          eventId={event.id}
          onClose={() => setChangeTopic(null)}
          onSent={() => {
            setChangeTopic(null);
            setMessage({ ok: true, text: CHANGE_SENT_MESSAGE });
          }}
          topic={changeTopic}
        />
      ) : null}
    </>
  );
}
