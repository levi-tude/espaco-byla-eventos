import { Ban, BadgeCheck, Banknote, RotateCcw } from "lucide-react";

import { cx } from "@/components/ui/cx";
import {
  formatCents,
  MEIA_RESULT_LABELS,
  MEIA_RESULTS,
  type MeiaResult,
} from "@/lib/domain/meia-check";

export type MeiaPanelState = {
  /** Banco com a migration da conferência: sem ela os botões não aparecem. */
  enabled: boolean;
  mark: MeiaResult | null;
  busy: boolean;
  error: string | null;
  /** Inteira − meia desta sessão (para cobrar), se conhecido. */
  diffCents: number | null;
};

const icons: Record<MeiaResult, typeof Ban> = {
  comprovante_ok: BadgeCheck,
  pagou_diferenca: Banknote,
  recusado: Ban,
};

export function meiaButtonLabel(result: MeiaResult, diffCents: number | null): string {
  if (result === "pagou_diferenca" && diffCents != null && diffCents > 0) {
    return `${MEIA_RESULT_LABELS[result]} (${formatCents(diffCents)})`;
  }
  return MEIA_RESULT_LABELS[result];
}

/**
 * Os 3 botões da conferência da meia. A marcação atual fica destacada e dá para trocar
 * (toque errado). Depois de "Recusado" a entrada foi desfeita: o botão de voltar dá
 * entrada de novo pela mesma função do check-in.
 */
export function MeiaCheckButtons({
  state,
  onMark,
  onRedoEntry,
  surface = "light",
}: {
  state: MeiaPanelState;
  onMark?: (result: MeiaResult) => void;
  onRedoEntry?: () => void;
  /** "light" = sobre fundo claro/amarelo; "dark" = sobre verde/vermelho. */
  surface?: "light" | "dark";
}) {
  if (!state.enabled) return null;

  if (state.mark === "recusado") {
    return (
      <div className="grid w-full gap-2">
        {state.error ? <p className="rounded-lg bg-black/30 px-3 py-2 text-base font-semibold">{state.error}</p> : null}
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-white/80 bg-transparent px-4 text-base font-semibold text-white disabled:opacity-60"
          disabled={state.busy || !onRedoEntry}
          onClick={onRedoEntry}
          type="button"
        >
          <RotateCcw aria-hidden className="h-5 w-5" />
          Foi engano: dar entrada de novo
        </button>
      </div>
    );
  }

  return (
    <div className="grid w-full gap-2" role="group" aria-label="Conferência da meia-entrada">
      {state.mark === null ? (
        <p className="text-base font-bold">Toque em uma opção antes do próximo ingresso</p>
      ) : (
        <p className="text-sm font-semibold opacity-90">Registrado. Tocou errado? Escolha outra opção.</p>
      )}
      {MEIA_RESULTS.map((result) => {
        const Icon = icons[result];
        const selected = state.mark === result;
        return (
          <button
            aria-pressed={selected}
            className={cx(
              "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-4 text-lg font-bold shadow transition disabled:opacity-60",
              result === "recusado"
                ? "bg-byla-danger-solid text-white"
                : surface === "dark"
                  ? "bg-white text-zinc-900"
                  : "bg-zinc-900 text-white",
              selected && "ring-4 ring-white outline outline-2 outline-black",
            )}
            disabled={state.busy || !onMark}
            key={result}
            onClick={() => onMark?.(result)}
            type="button"
          >
            <Icon aria-hidden className="h-6 w-6" />
            {meiaButtonLabel(result, state.diffCents)}
            {selected ? " ✓" : ""}
          </button>
        );
      })}
      {state.error ? <p className="rounded-lg bg-black/20 px-3 py-2 text-base font-semibold">{state.error}</p> : null}
    </div>
  );
}
