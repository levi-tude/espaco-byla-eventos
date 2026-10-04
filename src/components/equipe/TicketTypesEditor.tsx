"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import {
  customTypeKey,
  parseLimit,
  presetTypeKey,
  type DraftType,
  type PriceDraft,
} from "@/components/equipe/session-drafts";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { controlClasses } from "@/components/ui/Field";
import {
  peopleLabel,
  TICKET_PRESETS,
  TICKET_TYPE_LIMITS,
  type TicketPreset,
  type TicketTypeInput,
  unitContentsLabel,
} from "@/lib/domain/ticket-types";

export {
  customTypeKey,
  parsePriceCents,
  presetTypeKey,
  savedTypeKey,
} from "@/components/equipe/session-drafts";

/** Tipo à venda como a página da equipe carrega do banco. */
export type EditorTicketType = {
  id: string;
  preset: string | null;
  name: string;
  peoplePerUnit: number;
  hasSales: boolean;
  unitsSold: number;
  unitsTaken: number;
};

type PresetRow = { checked: boolean };

type CustomRow = {
  key: string;
  id: string | null;
  name: string;
  peoplePerUnit: number;
};

export type TicketTypesState = {
  presets: Record<TicketPreset, PresetRow>;
  customs: CustomRow[];
};

type SalesInfo = Pick<EditorTicketType, "hasSales" | "unitsSold" | "unitsTaken">;

const PRESET_DETAILS: Record<TicketPreset, string> = {
  inteira: "1 pessoa",
  meia: "1 pessoa",
  casadinha: "2 pessoas · gera 2 ingressos inteira",
  familia: "4 pessoas · gera 4 ingressos inteira",
};

const inputClass = cx(controlClasses, "min-h-12 font-normal");
const fieldLabelClass = "grid gap-1.5 text-sm font-medium text-foreground";

let rowSequence = 0;
function newRowKey() {
  rowSequence += 1;
  return `novo-${rowSequence}`;
}

/** Evento novo: Inteira e Meia-entrada marcadas. */
export function initialTicketTypesState(types?: EditorTicketType[]): TicketTypesState {
  const presets = Object.fromEntries(
    TICKET_PRESETS.map(({ preset }) => [
      preset,
      {
        checked: types
          ? types.some((type) => type.preset === preset)
          : preset === "inteira" || preset === "meia",
      },
    ]),
  ) as Record<TicketPreset, PresetRow>;

  const customs = (types ?? [])
    .filter((type) => type.preset === null)
    .map((type) => ({
      key: type.id,
      id: type.id,
      name: type.name,
      peoplePerUnit: type.peoplePerUnit,
    }));

  return { presets, customs };
}

/** Tipos marcados, na ordem enviada ao servidor (a posição é o `typeIndex` dos preços). */
export function draftTypesFromState(state: TicketTypesState): DraftType[] {
  const types: DraftType[] = TICKET_PRESETS.filter(
    ({ preset }) => state.presets[preset].checked,
  ).map(({ preset, name, kind, peoplePerUnit }) => ({
    key: presetTypeKey(preset),
    name,
    kind,
    peoplePerUnit,
  }));
  for (const row of state.customs) {
    types.push({
      key: customTypeKey(row.key),
      name: row.name.trim() || "tipo novo",
      kind: "inteira",
      peoplePerUnit: row.peoplePerUnit,
    });
  }
  return types;
}

/**
 * Converte os tipos para a ação. Preço e limite ficam nas sessões; os daqui são
 * só marcadores (o servidor usa os das sessões). O servidor e o banco validam de novo.
 */
export function ticketTypesFromState(
  state: TicketTypesState,
): { ok: true; types: TicketTypeInput[] } | { ok: false; error: string } {
  const types: TicketTypeInput[] = TICKET_PRESETS.filter(
    ({ preset }) => state.presets[preset].checked,
  ).map(({ preset }) => ({ preset, priceCents: 0, maxUnits: null }));

  for (const row of state.customs) {
    const name = row.name.trim();
    if (!name) return { ok: false, error: "Informe o nome de cada tipo novo." };
    types.push({
      preset: null,
      id: row.id,
      name,
      peoplePerUnit: row.peoplePerUnit,
      priceCents: 0,
      maxUnits: null,
    });
  }

  if (types.length === 0) {
    return { ok: false, error: "Marque pelo menos um tipo de ingresso para vender." };
  }
  return { ok: true, types };
}

function SalesHint({ sales, maxUnits }: { sales?: SalesInfo; maxUnits?: string }) {
  if (!sales) return null;
  const limit = maxUnits?.trim();
  return (
    <p className="text-sm text-byla-muted">
      Vendidos: {sales.unitsSold}
      {sales.unitsTaken > sales.unitsSold
        ? ` · reservados agora: ${sales.unitsTaken - sales.unitsSold}`
        : ""}
      {limit ? ` · limite: ${limit}` : ""}
    </p>
  );
}

export function LimitField({
  label,
  peoplePerUnit,
  value,
  onChange,
}: {
  label: string;
  peoplePerUnit: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const units = parseLimit(value);
  return (
    <label className={fieldLabelClass}>
      {peoplePerUnit > 1 ? "Limite de unidades (opcional)" : "Limite (opcional)"}
      <input
        aria-label={`Limite ${label}`}
        className={inputClass}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Sem limite"
        value={value}
      />
      {peoplePerUnit > 1 && units ? (
        <span className="text-sm font-normal text-byla-muted">
          Até {units} {units === 1 ? "unidade" : "unidades"} = {units * peoplePerUnit} ingressos
        </span>
      ) : null}
    </label>
  );
}

export function PriceField({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className={fieldLabelClass}>
      Preço (R$)
      <input
        aria-label={`Preço ${label}`}
        className={inputClass}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        placeholder="0,00"
        required={required}
        value={value}
      />
    </label>
  );
}

/** Preço e limite de cada tipo na sessão única (a tela junta tipo e preço numa linha). */
export type SingleSessionPrices = {
  get: (key: string) => PriceDraft;
  set: (key: string, patch: Partial<PriceDraft>) => void;
};

const SALES_WARNING =
  "já tem vendas. Ele sai da venda, mas os ingressos vendidos continuam válidos e o histórico fica guardado. Continuar?";

export function TicketTypesEditor({
  value,
  onChange,
  sales,
  prices,
  disabled = false,
}: {
  value: TicketTypesState;
  onChange: (next: TicketTypesState) => void;
  /** Vendas por tipo, pela chave do tipo (`preset:<tipo pronto>` ou `custom:<id>`). */
  sales: Record<string, SalesInfo>;
  /** Sessão única: preço e limite na linha do tipo. Ausente = preços em cada sessão. */
  prices?: SingleSessionPrices;
  disabled?: boolean;
}) {
  function setPreset(preset: TicketPreset, patch: Partial<PresetRow>) {
    onChange({
      ...value,
      presets: { ...value.presets, [preset]: { ...value.presets[preset], ...patch } },
    });
  }

  function togglePreset(preset: TicketPreset, name: string, checked: boolean) {
    if (!checked && sales[presetTypeKey(preset)]?.hasSales) {
      if (!window.confirm(`“${name}” ${SALES_WARNING}`)) return;
    }
    setPreset(preset, { checked });
  }

  function setCustom(key: string, patch: Partial<CustomRow>) {
    onChange({
      ...value,
      customs: value.customs.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    });
  }

  function addCustom() {
    onChange({
      ...value,
      customs: [...value.customs, { key: newRowKey(), id: null, name: "", peoplePerUnit: 1 }],
    });
  }

  function removeCustom(row: CustomRow) {
    if (row.id && sales[customTypeKey(row.id)]?.hasSales) {
      if (!window.confirm(`“${row.name.trim() || "Este tipo"}” ${SALES_WARNING}`)) return;
    }
    onChange({ ...value, customs: value.customs.filter((item) => item.key !== row.key) });
  }

  function moveCustom(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= value.customs.length) return;
    const customs = [...value.customs];
    [customs[index], customs[target]] = [customs[target], customs[index]];
    onChange({ ...value, customs });
  }

  const totalTypes =
    TICKET_PRESETS.filter(({ preset }) => value.presets[preset].checked).length +
    value.customs.length;

  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className="text-base font-semibold">Tipos de ingresso</legend>
      <p className="mt-1 text-sm text-byla-muted">
        {prices
          ? "Marque os tipos que serão vendidos e informe o preço. O limite é opcional e conta ingressos: cada limite e a soma deles precisam caber no total (e na quantidade de inteiras ou meias, se houver). Em branco, o tipo divide o que sobrar. Cortesias são emitidas pela equipe na lista de ingressos."
          : "Marque os tipos que o evento vende. O preço, o limite e se o tipo está à venda ficam em cada sessão, logo abaixo. Cortesias são emitidas pela equipe na lista de ingressos."}
      </p>

      <div className="grid gap-3">
        {TICKET_PRESETS.map(({ preset, name, peoplePerUnit }) => {
          const row = value.presets[preset];
          const key = presetTypeKey(preset);
          const price = prices?.get(key);
          return (
            <div
              className={cx(
                "grid gap-3 rounded-xl border p-3 sm:p-4",
                row.checked ? "border-byla-link/50" : "border-byla-border",
              )}
              key={preset}
            >
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                <input
                  checked={row.checked}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-byla-action"
                  onChange={(event) => togglePreset(preset, name, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block text-base font-semibold">Vender {name}</span>
                  <span className="block text-sm text-byla-muted">
                    {PRESET_DETAILS[preset]}
                  </span>
                </span>
              </label>
              <SalesHint maxUnits={price?.maxUnits} sales={sales[key]} />
              {row.checked && prices && price ? (
                <div className="grid gap-3 @md:grid-cols-2">
                  <PriceField
                    label={name}
                    onChange={(next) => prices.set(key, { price: next })}
                    value={price.price}
                  />
                  <LimitField
                    label={name}
                    onChange={(maxUnits) => prices.set(key, { maxUnits })}
                    peoplePerUnit={peoplePerUnit}
                    value={price.maxUnits}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {value.customs.length ? (
        <div className="grid gap-3">
          <p className="text-base font-semibold">Tipos criados pela equipe</p>
          {value.customs.map((row, index) => {
            const rowSales = row.id ? sales[customTypeKey(row.id)] : undefined;
            const label = row.name.trim() || "tipo novo";
            const key = customTypeKey(row.key);
            const price = prices?.get(key);
            return (
              <div
                className="grid gap-3 rounded-xl border border-byla-link/50 p-3 sm:p-4"
                key={row.key}
              >
                <div className="grid gap-3 @md:grid-cols-[1fr_9rem]">
                  <label className={fieldLabelClass}>
                    Nome
                    <input
                      className={inputClass}
                      maxLength={TICKET_TYPE_LIMITS.nameMaxLength}
                      onChange={(event) => setCustom(row.key, { name: event.target.value })}
                      placeholder="Ex.: Camarote"
                      required
                      value={row.name}
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    Pessoas
                    <select
                      className={inputClass}
                      disabled={rowSales?.hasSales}
                      onChange={(event) =>
                        setCustom(row.key, { peoplePerUnit: Number(event.target.value) })
                      }
                      value={row.peoplePerUnit}
                    >
                      {Array.from(
                        { length: TICKET_TYPE_LIMITS.maxPeoplePerUnit },
                        (_, i) => i + 1,
                      ).map((count) => (
                        <option key={count} value={count}>
                          {peopleLabel(count)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-sm text-byla-muted">
                  Cada compra gera {unitContentsLabel(row.peoplePerUnit, "inteira")}.
                  {rowSales?.hasSales ? " Já tem vendas: o número de pessoas não muda." : ""}
                </p>
                <SalesHint maxUnits={price?.maxUnits} sales={rowSales} />
                {prices && price ? (
                  <div className="grid gap-3 @md:grid-cols-2">
                    <PriceField
                      label={label}
                      onChange={(next) => prices.set(key, { price: next })}
                      value={price.price}
                    />
                    <LimitField
                      label={label}
                      onChange={(maxUnits) => prices.set(key, { maxUnits })}
                      peoplePerUnit={row.peoplePerUnit}
                      value={price.maxUnits}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-label={`Subir ${label}`}
                    disabled={index === 0}
                    onClick={() => moveCustom(index, -1)}
                    variant="secondary"
                  >
                    <ArrowUp aria-hidden className="h-4 w-4" />
                    Subir
                  </Button>
                  <Button
                    aria-label={`Descer ${label}`}
                    disabled={index === value.customs.length - 1}
                    onClick={() => moveCustom(index, 1)}
                    variant="secondary"
                  >
                    <ArrowDown aria-hidden className="h-4 w-4" />
                    Descer
                  </Button>
                  <button
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-byla-danger/50 px-4 text-base font-semibold text-byla-danger transition hover:bg-byla-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue disabled:opacity-50"
                    onClick={() => removeCustom(row)}
                    type="button"
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div>
        <Button
          className="w-full @md:w-auto"
          disabled={totalTypes >= TICKET_TYPE_LIMITS.maxTypes}
          onClick={addCustom}
          variant="secondary"
        >
          <Plus aria-hidden className="h-5 w-5" />
          Criar novo tipo
        </Button>
      </div>
    </fieldset>
  );
}
