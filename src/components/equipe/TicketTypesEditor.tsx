"use client";

import {
  peopleLabel,
  TICKET_PRESETS,
  TICKET_TYPE_LIMITS,
  type TicketPreset,
  type TicketTypeInput,
  unitContentsLabel,
} from "@/lib/domain/ticket-types";

/** Tipo à venda como a página da equipe carrega do banco. */
export type EditorTicketType = {
  id: string;
  preset: string | null;
  name: string;
  priceCents: number;
  peoplePerUnit: number;
  maxUnits: number | null;
  hasSales: boolean;
  unitsSold: number;
  unitsTaken: number;
};

type PresetRow = { checked: boolean; price: string; maxUnits: string };

type CustomRow = {
  key: string;
  id: string | null;
  name: string;
  peoplePerUnit: number;
  price: string;
  maxUnits: string;
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

const inputClass =
  "w-full rounded-lg border border-byla-border px-3 py-2.5 font-normal disabled:opacity-60";

let rowSequence = 0;
function newRowKey() {
  rowSequence += 1;
  return `novo-${rowSequence}`;
}

function priceText(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** "45", "45,5", "45,50" ou "45.50" → centavos; `null` se inválido. */
export function parsePriceCents(value: string): number | null {
  const clean = value.trim().replace(/\s/g, "");
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean.replace(",", ".")) * 100);
  return cents >= 1 && cents <= TICKET_TYPE_LIMITS.maxPriceCents ? cents : null;
}

function parseLimit(value: string): number | null | undefined {
  const clean = value.trim();
  if (!clean) return null;
  if (!/^\d{1,6}$/.test(clean)) return undefined;
  const units = Number(clean);
  return units >= 1 && units <= TICKET_TYPE_LIMITS.maxUnits ? units : undefined;
}

/** Evento novo: Inteira e Meia-entrada marcadas, sem preço (a equipe sempre informa). */
export function initialTicketTypesState(types?: EditorTicketType[]): TicketTypesState {
  const presets = Object.fromEntries(
    TICKET_PRESETS.map(({ preset }) => {
      const current = types?.find((type) => type.preset === preset);
      const row: PresetRow = current
        ? {
            checked: true,
            price: priceText(current.priceCents),
            maxUnits: current.maxUnits === null ? "" : String(current.maxUnits),
          }
        : {
            checked: !types && (preset === "inteira" || preset === "meia"),
            price: "",
            maxUnits: "",
          };
      return [preset, row];
    }),
  ) as Record<TicketPreset, PresetRow>;

  const customs = (types ?? [])
    .filter((type) => type.preset === null)
    .map((type) => ({
      key: type.id,
      id: type.id,
      name: type.name,
      peoplePerUnit: type.peoplePerUnit,
      price: priceText(type.priceCents),
      maxUnits: type.maxUnits === null ? "" : String(type.maxUnits),
    }));

  return { presets, customs };
}

/** Converte o formulário para a ação; o servidor e o banco validam de novo. */
export function ticketTypesFromState(
  state: TicketTypesState,
): { ok: true; types: TicketTypeInput[] } | { ok: false; error: string } {
  const types: TicketTypeInput[] = [];

  for (const { preset, name } of TICKET_PRESETS) {
    const row = state.presets[preset];
    if (!row.checked) continue;
    const priceCents = parsePriceCents(row.price);
    if (priceCents === null) {
      return { ok: false, error: `Informe o preço de “${name}” (ex.: 45,00).` };
    }
    const maxUnits = parseLimit(row.maxUnits);
    if (maxUnits === undefined) {
      return { ok: false, error: `Informe um limite válido para “${name}” ou deixe em branco.` };
    }
    types.push({ preset, priceCents, maxUnits });
  }

  for (const row of state.customs) {
    const name = row.name.trim();
    if (!name) return { ok: false, error: "Informe o nome de cada tipo novo." };
    const priceCents = parsePriceCents(row.price);
    if (priceCents === null) {
      return { ok: false, error: `Informe o preço de “${name}” (ex.: 45,00).` };
    }
    const maxUnits = parseLimit(row.maxUnits);
    if (maxUnits === undefined) {
      return { ok: false, error: `Informe um limite válido para “${name}” ou deixe em branco.` };
    }
    types.push({
      preset: null,
      id: row.id,
      name,
      peoplePerUnit: row.peoplePerUnit,
      priceCents,
      maxUnits,
    });
  }

  if (types.length === 0) {
    return { ok: false, error: "Marque pelo menos um tipo de ingresso para vender." };
  }
  return { ok: true, types };
}

function SalesHint({ sales, maxUnits }: { sales?: SalesInfo; maxUnits: string }) {
  if (!sales) return null;
  const limit = maxUnits.trim();
  return (
    <p className="text-xs text-byla-muted">
      Vendidos: {sales.unitsSold}
      {sales.unitsTaken > sales.unitsSold
        ? ` · reservados agora: ${sales.unitsTaken - sales.unitsSold}`
        : ""}
      {limit ? ` · limite: ${limit}` : ""}
    </p>
  );
}

const SALES_WARNING =
  "já tem vendas. Ele sai da venda, mas os ingressos vendidos continuam válidos e o histórico fica guardado. Continuar?";

export function TicketTypesEditor({
  value,
  onChange,
  sales,
  disabled = false,
}: {
  value: TicketTypesState;
  onChange: (next: TicketTypesState) => void;
  /** Vendas por tipo: chave `preset:<tipo pronto>` ou `id:<id do tipo>`. */
  sales: Record<string, SalesInfo>;
  disabled?: boolean;
}) {
  function setPreset(preset: TicketPreset, patch: Partial<PresetRow>) {
    onChange({
      ...value,
      presets: { ...value.presets, [preset]: { ...value.presets[preset], ...patch } },
    });
  }

  function togglePreset(preset: TicketPreset, name: string, checked: boolean) {
    if (!checked && sales[`preset:${preset}`]?.hasSales) {
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
      customs: [
        ...value.customs,
        { key: newRowKey(), id: null, name: "", peoplePerUnit: 1, price: "", maxUnits: "" },
      ],
    });
  }

  function removeCustom(row: CustomRow) {
    if (row.id && sales[`id:${row.id}`]?.hasSales) {
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
      <legend className="text-sm font-medium">Tipos de ingresso</legend>
      <p className="-mt-2 text-sm text-byla-muted">
        Marque os tipos que serão vendidos e informe o preço. O limite é opcional
        (em branco, vale só a capacidade do evento). Cortesias são emitidas pela
        equipe na lista de ingressos.
      </p>

      <div className="grid gap-3">
        {TICKET_PRESETS.map(({ preset, name }) => {
          const row = value.presets[preset];
          return (
            <div
              className="grid gap-3 rounded-lg border border-byla-border p-4"
              key={preset}
            >
              <label className="flex items-start gap-3">
                <input
                  checked={row.checked}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-byla-blue"
                  onChange={(event) => togglePreset(preset, name, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="block font-medium">Vender {name}</span>
                  <span className="block text-xs text-byla-muted">
                    {PRESET_DETAILS[preset]}
                  </span>
                </span>
              </label>
              <SalesHint maxUnits={row.maxUnits} sales={sales[`preset:${preset}`]} />
              {row.checked ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    Preço (R$)
                    <input
                      aria-label={`Preço ${name}`}
                      className={inputClass}
                      inputMode="decimal"
                      onChange={(event) => setPreset(preset, { price: event.target.value })}
                      placeholder="0,00"
                      required
                      value={row.price}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Limite (opcional)
                    <input
                      aria-label={`Limite ${name}`}
                      className={inputClass}
                      inputMode="numeric"
                      onChange={(event) => setPreset(preset, { maxUnits: event.target.value })}
                      placeholder="Sem limite"
                      value={row.maxUnits}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {value.customs.length ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">Tipos criados pela equipe</p>
          {value.customs.map((row, index) => {
            const rowSales = row.id ? sales[`id:${row.id}`] : undefined;
            const label = row.name.trim() || "tipo novo";
            return (
              <div className="grid gap-3 rounded-lg border border-byla-border p-4" key={row.key}>
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                  <label className="grid gap-1 text-sm">
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
                  <label className="grid gap-1 text-sm">
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
                <p className="text-xs text-byla-muted">
                  Cada compra gera {unitContentsLabel(row.peoplePerUnit, "inteira")}.
                  {rowSales?.hasSales ? " Já tem vendas: o número de pessoas não muda." : ""}
                </p>
                <SalesHint maxUnits={row.maxUnits} sales={rowSales} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    Preço (R$)
                    <input
                      aria-label={`Preço ${label}`}
                      className={inputClass}
                      inputMode="decimal"
                      onChange={(event) => setCustom(row.key, { price: event.target.value })}
                      placeholder="0,00"
                      required
                      value={row.price}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Limite (opcional)
                    <input
                      aria-label={`Limite ${label}`}
                      className={inputClass}
                      inputMode="numeric"
                      onChange={(event) => setCustom(row.key, { maxUnits: event.target.value })}
                      placeholder="Sem limite"
                      value={row.maxUnits}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    aria-label={`Subir ${label}`}
                    className="rounded-lg border border-byla-border px-3 py-2 text-sm disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() => moveCustom(index, -1)}
                    type="button"
                  >
                    ↑ Subir
                  </button>
                  <button
                    aria-label={`Descer ${label}`}
                    className="rounded-lg border border-byla-border px-3 py-2 text-sm disabled:opacity-40"
                    disabled={index === value.customs.length - 1}
                    onClick={() => moveCustom(index, 1)}
                    type="button"
                  >
                    ↓ Descer
                  </button>
                  <button
                    className="rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-700 dark:text-red-400"
                    onClick={() => removeCustom(row)}
                    type="button"
                  >
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div>
        <button
          className="rounded-lg border border-byla-border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          disabled={totalTypes >= TICKET_TYPE_LIMITS.maxTypes}
          onClick={addCustom}
          type="button"
        >
          + Criar novo tipo
        </button>
      </div>
    </fieldset>
  );
}
