import { describe, expect, it } from "vitest";

import {
  isMeiaFeatureMissing,
  isMeiaResult,
  latestMeiaChecks,
  meiaBadge,
  meiaDiffCents,
  parseMeiaSummary,
} from "@/lib/domain/meia-check";

describe("conferência da meia", () => {
  it("resultados aceitos", () => {
    expect(isMeiaResult("comprovante_ok")).toBe(true);
    expect(isMeiaResult("pagou_diferenca")).toBe(true);
    expect(isMeiaResult("recusado")).toBe(true);
    expect(isMeiaResult("ok")).toBe(false);
    expect(isMeiaResult(null)).toBe(false);
  });

  it("resumo do banco (bigint vem como texto)", () => {
    expect(
      parseMeiaSummary({
        meias_lidas: 5,
        comprovante_ok: 2,
        pagou_diferenca: 1,
        diferenca_total_cents: "2500",
        recusadas: 1,
        nao_registradas: 1,
      }),
    ).toEqual({ lidas: 5, comprovanteOk: 2, pagouDiferenca: 1, diferencaTotalCents: 2500, recusadas: 1, naoRegistradas: 1 });
    expect(parseMeiaSummary(null)).toBeNull();
  });

  it.each([
    [{ code: "PGRST202", message: "Could not find the function" }, true],
    [{ code: "42883", message: "function does not exist" }, true],
    [{ code: "PGRST205", message: "Could not find the table 'public.meia_checks'" }, true],
    [{ code: "42P01", message: "relation does not exist" }, true],
    [{ code: "P0001", message: "MEIA_ACESSO" }, false],
    [null, false],
  ])("banco sem a migration: %o → %s", (error, expected) => {
    expect(isMeiaFeatureMissing(error)).toBe(expected);
  });

  it("vale a marcação mais recente (correção)", () => {
    const latest = latestMeiaChecks([
      { id: "2", ticket_id: "t1", result: "pagou_diferenca", diff_cents: 2500, created_at: "2026-11-28T20:06:00Z" },
      { id: "1", ticket_id: "t1", result: "comprovante_ok", diff_cents: null, created_at: "2026-11-28T20:05:00Z" },
      { id: "3", ticket_id: "t2", result: "recusado", diff_cents: null, created_at: "2026-11-28T20:07:00Z" },
      { id: "4", ticket_id: "t3", result: "estranho", diff_cents: null, created_at: "2026-11-28T20:08:00Z" },
    ]);
    expect(latest.get("t1")).toEqual({ result: "pagou_diferenca", diffCents: 2500, checkedAt: "2026-11-28T20:06:00Z" });
    expect(latest.get("t2")?.result).toBe("recusado");
    expect(latest.has("t3")).toBe(false);
  });

  it("selo na lista", () => {
    const at = "2026-11-28T20:07:00Z";
    expect(meiaBadge({ kind: "inteira", status: "check_in" }, null)).toBeNull();
    expect(meiaBadge({ kind: "meia", status: "pago" }, null)).toBeNull();
    expect(meiaBadge({ kind: "meia", status: "check_in" }, null)).toEqual({ label: "Meia: conferência não registrada", tone: "warning" });
    expect(meiaBadge({ kind: "meia", status: "check_in" }, { result: "comprovante_ok", diffCents: null, checkedAt: at })?.tone).toBe("success");
    expect(meiaBadge({ kind: "meia", status: "check_in" }, { result: "pagou_diferenca", diffCents: 2500, checkedAt: at })?.label).toMatch(
      /^Meia: pagou a diferença \(R\$\s25,00\)$/,
    );
    expect(meiaBadge({ kind: "meia", status: "pago" }, { result: "recusado", diffCents: null, checkedAt: at })).toEqual({
      label: "Meia recusada às 17h07",
      tone: "danger",
    });
    // Recusada e lida de novo sem nova marcação: volta a "não registrada".
    expect(meiaBadge({ kind: "meia", status: "check_in" }, { result: "recusado", diffCents: null, checkedAt: at })?.tone).toBe("warning");
  });

  it("diferença usa a inteira de 1 pessoa (preset inteira primeiro), igual ao banco", () => {
    const base = { kind: "inteira", archived: false, peoplePerUnit: 1 };
    expect(
      meiaDiffCents(
        [
          { ...base, id: "p", preset: null, sortOrder: 0, priceCents: 2500 },
          { ...base, id: "i", preset: "inteira", sortOrder: 1, priceCents: 5000 },
          { ...base, id: "c", preset: "casadinha", peoplePerUnit: 2, sortOrder: 2, priceCents: 8000 },
        ],
        2500,
      ),
    ).toBe(2500);
    expect(meiaDiffCents([{ ...base, id: "x", preset: null, sortOrder: 0, priceCents: 2000 }], 2500)).toBe(0);
    expect(meiaDiffCents([], 2500)).toBeNull();
  });
});
