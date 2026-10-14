"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  addSessionDraft,
  applyPricesToAll,
  isLocked,
  limitedTypesForDraft,
  lockedLimitKeys,
  lockedPriceKeys,
  priceDraftFor,
  removeSessionDraft,
  type DraftType,
  type PriceDraft,
  type SessionDraft,
} from "@/components/equipe/session-drafts";
import { LimitField, PriceField } from "@/components/equipe/TicketTypesEditor";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatSessionLabel, parseEventInputValue } from "@/lib/datetime";
import { parseQuotaInput, quotaSummary, quotasError } from "@/lib/domain/quotas";
import { MAX_SESSIONS, SESSION_NAME_MAX_LENGTH } from "@/lib/domain/session-editor";
import { unitContentsLabel } from "@/lib/domain/ticket-types";
import { typeLimitsError, typeLimitsSummary } from "@/lib/domain/type-limits";

type DraftChecks = {
  quotaProblem: string | null;
  summary: { line: string; detail: string } | null;
  limitProblem: string | null;
  limitSummary: string | null;
};

/** Resumo ao vivo de quantidades e limites de uma sessão (o servidor confere de novo). */
export function draftChecks(
  draft: SessionDraft,
  types: readonly DraftType[],
  single: boolean,
): DraftChecks {
  const capacity = Number(draft.capacity);
  const validCapacity = Number.isInteger(capacity) && capacity > 0;
  const inteiraQuota = parseQuotaInput(draft.inteiraQuota);
  const meiaQuota = parseQuotaInput(draft.meiaQuota);
  if (inteiraQuota === undefined || meiaQuota === undefined) {
    return {
      quotaProblem: "Use números inteiros nas quantidades de inteiras e meias, ou deixe em branco.",
      summary: null,
      limitProblem: null,
      limitSummary: null,
    };
  }
  const quotas = { inteiraQuota, meiaQuota };
  const quotaProblem = validCapacity ? quotasError(capacity, quotas) : null;
  const limited = limitedTypesForDraft(draft, types, single);
  return {
    quotaProblem,
    summary: quotaSummary(capacity, quotas),
    limitProblem:
      !quotaProblem && validCapacity ? typeLimitsError(capacity, quotas, limited) : null,
    limitSummary: typeLimitsSummary(capacity, limited),
  };
}

/** Horário digitado → rótulo legível ("sáb, 10/10 · 19h00"); vazio se ainda incompleto. */
function draftLabel(draft: SessionDraft): string {
  if (!draft.startsAt) return "";
  const start = parseEventInputValue(draft.startsAt);
  if (Number.isNaN(start.getTime())) return "";
  const end = draft.endsAt ? parseEventInputValue(draft.endsAt) : null;
  return formatSessionLabel(
    draft.name.trim() || null,
    start.toISOString(),
    end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
  );
}

function scheduleChanged(draft: SessionDraft): boolean {
  return Boolean(
    draft.saved &&
      draft.saved.paidOrders > 0 &&
      (draft.saved.startsAt !== draft.startsAt || draft.saved.endsAt !== draft.endsAt),
  );
}

function ScheduleWarning({ draft }: { draft: SessionDraft }) {
  if (!scheduleChanged(draft) || !draft.saved) return null;
  const count = draft.saved.paidOrders;
  return (
    <Notice title="Esta sessão já tem compradores" tone="warning">
      {count === 1 ? "1 pedido pago" : `${count} pedidos pagos`} vão passar a valer para o novo
      horário. Avise os compradores depois de salvar.
    </Notice>
  );
}

/** Campo travado depois da aprovação (o organizador pede a mudança ao Admin). */
export const LOCKED_FIELD_CLASS = "read-only:bg-byla-overlay read-only:text-byla-muted";

/** Aviso + "Pedir mudança" embaixo de um grupo de campos travados. */
export function LockedNote({
  children,
  onRequestChange,
  className,
}: {
  children: ReactNode;
  onRequestChange?: () => void;
  className?: string;
}) {
  return (
    <div className={cx("grid gap-2 @md:flex @md:items-center @md:justify-between", className)}>
      <p className="text-sm text-byla-muted">{children}</p>
      {onRequestChange ? (
        <Button className="w-full shrink-0 @md:w-auto" onClick={onRequestChange} variant="secondary">
          Pedir mudança
        </Button>
      ) : null}
    </div>
  );
}

/** Data e hora de uma sessão: no evento de sessão única ficam na grade principal. */
export function SessionTimeFields({
  draft,
  onChange,
  startLabel = "Data e hora",
  onRequestChange,
}: {
  draft: SessionDraft;
  onChange: (patch: Partial<SessionDraft>) => void;
  startLabel?: string;
  onRequestChange?: () => void;
}) {
  const locked = isLocked(draft, "horario");
  return (
    <>
      <Field
        className={LOCKED_FIELD_CLASS}
        label={startLabel}
        onChange={(change) => onChange({ startsAt: change.target.value })}
        readOnly={locked}
        required
        type="datetime-local"
        value={draft.startsAt}
      />
      <Field
        className={LOCKED_FIELD_CLASS}
        hint="Opcional. Ajuda o comprador a se organizar."
        label="Término (opcional)"
        min={draft.startsAt || undefined}
        onChange={(change) => onChange({ endsAt: change.target.value })}
        readOnly={locked}
        type="datetime-local"
        value={draft.endsAt}
      />
      {locked ? (
        <LockedNote className="col-span-full" onRequestChange={onRequestChange}>
          Esta sessão já tem vendas: para mudar o horário, use “Pedir mudança”.
        </LockedNote>
      ) : null}
    </>
  );
}

/** "Quantidade de ingressos" de uma sessão, igual ao formulário de sessão única. */
export function SessionQuantityFields({
  draft,
  checks,
  onChange,
  bordered = true,
  onRequestChange,
}: {
  draft: SessionDraft;
  checks: DraftChecks;
  onChange: (patch: Partial<SessionDraft>) => void;
  bordered?: boolean;
  onRequestChange?: () => void;
}) {
  const { quotaProblem, summary } = checks;
  const locked = isLocked(draft, "lotacao");
  return (
    <fieldset
      className={cx("grid gap-4", bordered && "rounded-xl border border-byla-border p-4")}
    >
      <legend className={cx("text-base font-semibold", bordered && "px-1")}>
        Quantidade de ingressos
      </legend>
      <div className="grid gap-4 @lg:grid-cols-3">
        <Field
          inputMode="numeric"
          label="Total de ingressos"
          min={locked && draft.locked ? String(draft.locked.capacity) : "1"}
          onChange={(change) => onChange({ capacity: change.target.value })}
          required
          step="1"
          type="number"
          value={draft.capacity}
        />
        <Field
          className={LOCKED_FIELD_CLASS}
          inputMode="numeric"
          label="Quantidade de inteiras"
          onChange={(change) => onChange({ inteiraQuota: change.target.value })}
          placeholder="Sem quantidade separada"
          readOnly={locked}
          value={draft.inteiraQuota}
        />
        <Field
          className={LOCKED_FIELD_CLASS}
          inputMode="numeric"
          label="Quantidade de meias"
          onChange={(change) => onChange({ meiaQuota: change.target.value })}
          placeholder="Sem quantidade separada"
          readOnly={locked}
          value={draft.meiaQuota}
        />
      </div>
      {locked ? (
        <LockedNote onRequestChange={onRequestChange}>
          Esta sessão já tem vendas: o total só pode aumentar. Para diminuir lugares ou mudar
          inteiras e meias, use “Pedir mudança”.
        </LockedNote>
      ) : null}
      <p className="text-sm text-byla-muted">
        Cada pessoa de Casadinha, Pacote família ou tipo novo conta como inteira. Cortesias
        contam só no total. Deixe em branco para não separar.
      </p>
      {draft.saved ? (
        <p className="text-sm text-byla-muted">
          Já vendidos ou reservados nesta sessão: {draft.saved.occupied}.
        </p>
      ) : null}
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
  );
}

/** Resumo dos limites por tipo (fica logo abaixo dos preços). */
export function LimitSummary({ checks, className }: { checks: DraftChecks; className?: string }) {
  if (!checks.limitProblem && !checks.limitSummary) return null;
  return (
    <p
      aria-live="polite"
      className={cx(
        checks.limitProblem ? "text-sm font-medium text-byla-danger" : "text-sm text-byla-muted",
        className,
      )}
    >
      {checks.limitProblem ?? checks.limitSummary}
    </p>
  );
}

function SessionPrices({
  draft,
  types,
  onPriceChange,
}: {
  draft: SessionDraft;
  types: readonly DraftType[];
  onPriceChange: (typeKey: string, patch: Partial<PriceDraft>) => void;
}) {
  const priceLocks = lockedPriceKeys(draft);
  const limitLocks = lockedLimitKeys(draft);
  if (!types.length) {
    return (
      <p className="text-sm text-byla-muted">
        Marque os tipos de ingresso acima para definir os preços desta sessão.
      </p>
    );
  }
  return (
    <fieldset className="grid gap-3">
      <legend className="text-base font-semibold">Preços desta sessão</legend>
      {types.map((type) => {
        const price = priceDraftFor(draft, type.key);
        return (
          <div
            className={cx(
              "grid gap-3 rounded-xl border p-3",
              price.onSale ? "border-byla-link/50" : "border-byla-border",
            )}
            key={type.key}
          >
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
              <input
                checked={price.onSale}
                className="mt-0.5 h-5 w-5 shrink-0 accent-byla-action"
                disabled={price.onSale && priceLocks.has(type.key)}
                onChange={(event) => onPriceChange(type.key, { onSale: event.target.checked })}
                type="checkbox"
              />
              <span>
                <span className="block text-base font-semibold">{type.name} à venda</span>
                <span className="block text-sm text-byla-muted">
                  {unitContentsLabel(type.peoplePerUnit, type.kind)}
                </span>
              </span>
            </label>
            {price.onSale ? (
              <div className="grid gap-3 @md:grid-cols-2">
                <PriceField
                  label={type.name}
                  onChange={(next) => onPriceChange(type.key, { price: next })}
                  readOnly={priceLocks.has(type.key)}
                  value={price.price}
                />
                <LimitField
                  label={type.name}
                  onChange={(maxUnits) => onPriceChange(type.key, { maxUnits })}
                  peoplePerUnit={type.peoplePerUnit}
                  readOnly={limitLocks.has(type.key)}
                  value={price.maxUnits}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Preço e limite travados numa sessão com vendas (sessão única ou cartão). */
export function PriceLockNote({
  draft,
  onRequestChange,
}: {
  draft: SessionDraft;
  onRequestChange?: () => void;
}) {
  if (!lockedPriceKeys(draft).size && !lockedLimitKeys(draft).size) return null;
  return (
    <LockedNote onRequestChange={onRequestChange}>
      Esta sessão já tem vendas: os tipos à venda mantêm preço e limite e não saem da venda. Para
      mudar, use “Pedir mudança”.
    </LockedNote>
  );
}

function SessionCard({
  draft,
  index,
  total,
  types,
  onChange,
  onApplyPrices,
  onRemove,
  onRequestChange,
}: {
  draft: SessionDraft;
  index: number;
  total: number;
  types: readonly DraftType[];
  onChange: (patch: Partial<SessionDraft>) => void;
  onApplyPrices: () => void;
  onRemove: () => void;
  onRequestChange?: (topic: string) => void;
}) {
  const checks = draftChecks(draft, types, false);
  const label = draftLabel(draft);
  const locked = draft.saved?.liveOrders ?? false;
  const sessionName = label ? `Sessão ${index + 1} (${label})` : `Sessão ${index + 1}`;
  const requestFor = (topic: string) => (onRequestChange ? () => onRequestChange(topic) : undefined);

  function setPrice(typeKey: string, patch: Partial<PriceDraft>) {
    onChange({
      prices: { ...draft.prices, [typeKey]: { ...priceDraftFor(draft, typeKey), ...patch } },
    });
  }

  return (
    <section
      aria-label={`Sessão ${index + 1}`}
      className="grid gap-4 rounded-xl border border-byla-border p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Sessão {index + 1}</h3>
          {label ? <p className="text-sm text-byla-muted">{label}</p> : null}
        </div>
        {draft.saved ? (
          <StatusBadge tone={draft.saved.sold > 0 ? "info" : "neutral"}>
            {draft.saved.sold} {draft.saved.sold === 1 ? "vendido" : "vendidos"}
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Nova</StatusBadge>
        )}
      </header>

      <div className="grid gap-4 @lg:grid-cols-3">
        <Field
          hint="Opcional. Ex.: Sessão das crianças"
          label="Nome da sessão"
          maxLength={SESSION_NAME_MAX_LENGTH}
          onChange={(change) => onChange({ name: change.target.value })}
          value={draft.name}
        />
        <SessionTimeFields
          draft={draft}
          onChange={onChange}
          onRequestChange={requestFor(`Horário da ${sessionName}`)}
          startLabel="Início"
        />
      </div>
      <ScheduleWarning draft={draft} />

      <SessionQuantityFields
        bordered={false}
        checks={checks}
        draft={draft}
        onChange={onChange}
        onRequestChange={requestFor(`Lugares da ${sessionName}`)}
      />

      <SessionPrices draft={draft} onPriceChange={setPrice} types={types} />
      <LimitSummary checks={checks} className="-mt-2" />
      <PriceLockNote draft={draft} onRequestChange={requestFor(`Preços da ${sessionName}`)} />

      <div className="flex flex-wrap gap-2">
        {total > 1 && types.length ? (
          <Button onClick={onApplyPrices} variant="secondary">
            <Copy aria-hidden className="h-4 w-4" />
            Aplicar estes preços a todas as sessões
          </Button>
        ) : null}
        {locked && onRequestChange ? (
          <LockedNote className="basis-full" onRequestChange={requestFor(`Cancelar a ${sessionName}`)}>
            Esta sessão tem vendas e não pode ser removida. Para cancelar, use “Pedir mudança”.
          </LockedNote>
        ) : locked ? (
          <p className="flex min-h-11 items-center text-sm text-byla-muted">
            Esta sessão tem vendas e não pode ser removida. Para cancelar, escolha a sessão no topo do painel e use “Cancelar sessão”.
          </p>
        ) : (
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-byla-danger/50 px-4 text-base font-semibold text-byla-danger transition hover:bg-byla-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue"
            onClick={onRemove}
            type="button"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Remover sessão
          </button>
        )}
      </div>
    </section>
  );
}

export function AddSessionButton({
  drafts,
  onChange,
}: {
  drafts: readonly SessionDraft[];
  onChange: (next: SessionDraft[]) => void;
}) {
  const full = drafts.length >= MAX_SESSIONS;
  return (
    <div className="grid gap-1.5">
      <div>
        <Button
          className="w-full @md:w-auto"
          disabled={full}
          onClick={() => onChange(addSessionDraft(drafts))}
          variant="secondary"
        >
          <Plus aria-hidden className="h-5 w-5" />
          Adicionar sessão
        </Button>
      </div>
      <p className="text-sm text-byla-muted">
        {full
          ? `Limite de ${MAX_SESSIONS} sessões por evento.`
          : drafts.length === 1
            ? "Mesmo evento em outro horário (ex.: 19h e 20h30). A nova sessão copia quantidades e preços desta."
            : "A nova sessão copia quantidades e preços da última."}
      </p>
    </div>
  );
}

/** Sessões em cartões (evento com 2 ou mais sessões). */
export function SessionsEditor({
  drafts,
  types,
  onChange,
  disabled = false,
  onRequestChange,
}: {
  drafts: readonly SessionDraft[];
  types: readonly DraftType[];
  onChange: (next: SessionDraft[]) => void;
  disabled?: boolean;
  /** Área do organizador: abre "Pedir mudança" com o assunto já escrito. */
  onRequestChange?: (topic: string) => void;
}) {
  function update(key: string, patch: Partial<SessionDraft>) {
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }

  function remove(draft: SessionDraft, index: number) {
    const name = draftLabel(draft) || `Sessão ${index + 1}`;
    if (draft.saved && !window.confirm(`Remover a sessão “${name}”?`)) return;
    onChange(removeSessionDraft(drafts, draft.key));
  }

  function applyPrices(draft: SessionDraft, index: number) {
    if (
      !window.confirm(
        `Usar os preços, limites e tipos à venda da Sessão ${index + 1} em todas as outras sessões?`,
      )
    ) {
      return;
    }
    onChange(applyPricesToAll(drafts, draft.key, types));
  }

  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className="text-base font-semibold">Sessões ({drafts.length})</legend>
      <p className="-mt-2 text-sm text-byla-muted">
        Cada sessão tem horário, quantidade e preços próprios. O comprador escolhe a sessão
        antes dos ingressos.
      </p>
      {drafts.map((draft, index) => (
        <SessionCard
          draft={draft}
          index={index}
          key={draft.key}
          onApplyPrices={() => applyPrices(draft, index)}
          onChange={(patch) => update(draft.key, patch)}
          onRemove={() => remove(draft, index)}
          onRequestChange={onRequestChange}
          total={drafts.length}
          types={types}
        />
      ))}
      <AddSessionButton drafts={drafts} onChange={onChange} />
    </fieldset>
  );
}

export { ScheduleWarning };
