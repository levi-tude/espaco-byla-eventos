// Conferência da meia-entrada na portaria (comprovante ok, pagou a diferença, recusado).
// Puro: serve à rota, às páginas e às telas.

import { formatSessionTime } from "@/lib/datetime";

export const MEIA_RESULTS = ["comprovante_ok", "pagou_diferenca", "recusado"] as const;
export type MeiaResult = (typeof MEIA_RESULTS)[number];

export const MEIA_RESULT_LABELS: Record<MeiaResult, string> = {
  comprovante_ok: "Comprovante ok",
  pagou_diferenca: "Pagou a diferença",
  recusado: "Recusado",
};

export function isMeiaResult(value: unknown): value is MeiaResult {
  return typeof value === "string" && (MEIA_RESULTS as readonly string[]).includes(value);
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number): string {
  return currency.format(cents / 100);
}

export type MeiaSummary = {
  lidas: number;
  comprovanteOk: number;
  pagouDiferenca: number;
  diferencaTotalCents: number;
  recusadas: number;
  naoRegistradas: number;
};

const toInt = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Linha de `meia_check_summary` → resumo (números ausentes viram 0). */
export function parseMeiaSummary(row: Record<string, unknown> | null | undefined): MeiaSummary | null {
  if (!row) return null;
  return {
    lidas: toInt(row.meias_lidas),
    comprovanteOk: toInt(row.comprovante_ok),
    pagouDiferenca: toInt(row.pagou_diferenca),
    diferencaTotalCents: toInt(row.diferenca_total_cents),
    recusadas: toInt(row.recusadas),
    naoRegistradas: toInt(row.nao_registradas),
  };
}

/**
 * Banco ainda sem a migration da conferência (função/tabela inexistente): a portaria
 * esconde os botões e o check-in segue normal.
 */
export function isMeiaFeatureMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(code)) return true;
  const message = error.message ?? "";
  return /record_meia_check|meia_check_summary|meia_checks/.test(message) && /not find|does not exist|schema cache/i.test(message);
}

export type MeiaCheckState = {
  result: MeiaResult;
  diffCents: number | null;
  checkedAt: string;
};

/** Última marcação de cada ingresso (linhas em qualquer ordem). */
export function latestMeiaChecks(
  rows: { ticket_id: string; result: string; diff_cents: number | null; created_at: string; id?: string }[],
): Map<string, MeiaCheckState> {
  const latest = new Map<string, MeiaCheckState & { key: string }>();
  for (const row of rows) {
    if (!isMeiaResult(row.result)) continue;
    const key = `${row.created_at}|${row.id ?? ""}`;
    const current = latest.get(row.ticket_id);
    if (current && current.key >= key) continue;
    latest.set(row.ticket_id, {
      result: row.result,
      diffCents: row.diff_cents,
      checkedAt: row.created_at,
      key,
    });
  }
  return new Map(
    [...latest].map(([ticketId, { result, diffCents, checkedAt }]) => [ticketId, { result, diffCents, checkedAt }]),
  );
}

export type MeiaBadgeTone = "success" | "warning" | "danger";

/** Selo da meia na lista de participantes (null quando não há o que mostrar). */
export function meiaBadge(
  ticket: { kind: string; status: string },
  check: MeiaCheckState | null | undefined,
): { label: string; tone: MeiaBadgeTone } | null {
  if (ticket.kind !== "meia") return null;
  const at = check ? formatSessionTime(check.checkedAt) : "";
  if (ticket.status === "check_in") {
    if (check?.result === "comprovante_ok") return { label: "Meia: comprovante ok", tone: "success" };
    if (check?.result === "pagou_diferenca") {
      const value = check.diffCents != null ? ` (${formatCents(check.diffCents)})` : "";
      return { label: `Meia: pagou a diferença${value}`, tone: "success" };
    }
    return { label: "Meia: conferência não registrada", tone: "warning" };
  }
  if (ticket.status === "pago" && check?.result === "recusado") {
    return { label: `Meia recusada${at ? ` às ${at}` : ""}`, tone: "danger" };
  }
  return null;
}

/** Mensagem para cada resultado de `record_meia_check` que não é "ok". */
export function meiaOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "nao_meia":
      return "Este ingresso não é meia-entrada.";
    case "sem_entrada":
      return "Este ingresso está sem entrada registrada. Leia o QR de novo para dar entrada.";
    case "nao_encontrado":
      return "Ingresso não encontrado.";
    default:
      return "Não foi possível registrar a conferência.";
  }
}

/** Confirmação antes de recusar (desfaz a entrada). */
export const MEIA_REFUSE_CONFIRM =
  "Recusar esta meia?\nA entrada é desfeita: a pessoa não entra agora e o ingresso volta a valer se ela voltar com o comprovante (ou pagar a diferença).";

/** Confirmação ao seguir sem registrar a conferência. */
export const MEIA_SKIP_CONFIRM =
  "A conferência desta meia não foi registrada.\nSeguir mesmo assim? Ela fica como “não registrada”.";

export type InteiraCandidate = {
  kind: string;
  preset: string | null;
  peoplePerUnit: number | null;
  archived: boolean;
  sortOrder: number | null;
  id: string;
  /** Preço do tipo nesta sessão (ou o preço base do tipo). */
  priceCents: number;
};

/**
 * Diferença inteira − meia, com a MESMA escolha da função do banco: tipo inteira de 1
 * pessoa, preferindo o preset "inteira", depois os não arquivados e a ordem do evento.
 */
export function meiaDiffCents(candidates: InteiraCandidate[], meiaPriceCents: number): number | null {
  const rank = (c: InteiraCandidate) => (c.preset === "inteira" ? 0 : c.preset === null ? 2 : 1);
  const full = candidates
    .filter((c) => c.kind === "inteira" && (c.peoplePerUnit ?? 1) === 1)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(a.archived) - Number(b.archived) ||
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    )[0];
  return full ? Math.max(full.priceCents - meiaPriceCents, 0) : null;
}

/** "sáb, 28/11 · 17h00 · Evento" → "17h"; "19h30" → "19h30". Sem horário: null. */
export function shortSessionTime(label: string | null | undefined): string | null {
  const m = label?.match(/(\d{1,2})h(\d{2})/);
  if (!m) return null;
  return m[2] === "00" ? `${Number(m[1])}h` : `${Number(m[1])}h${m[2]}`;
}

export type MeiaRefuseSecondConfirm = { title: string; body: string[] };

/** Segunda confirmação do "Recusado": explica o que acontece antes de desfazer a entrada. */
export function meiaRefuseSecondConfirm(input: {
  buyerName?: string | null;
  sessionLabel?: string | null;
  diffCents?: number | null;
}): MeiaRefuseSecondConfirm {
  const name = input.buyerName?.trim() || "esta pessoa";
  const time = shortSessionTime(input.sessionLabel);
  const diff =
    typeof input.diffCents === "number" && input.diffCents > 0
      ? `pagar a diferença (${formatCents(input.diffCents)})`
      : "pagar a diferença";
  return {
    title: `Confirmar recusa de ${name} – meia${time ? `, sessão ${time}` : ""}?`,
    body: [
      "A entrada será desfeita e a pessoa NÃO entra. Não há reembolso.",
      `Ela só pode entrar se voltar com o comprovante ou ${diff}.`,
    ],
  };
}

export const MEIA_REFUSE_BACK = "Voltar";
export const MEIA_REFUSE_YES = "Sim, recusar";
