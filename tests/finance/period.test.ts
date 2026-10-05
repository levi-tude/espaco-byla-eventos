import { describe, expect, it } from "vitest";

import {
  feeCsvFileName,
  feePeriodLabel,
  feePeriodShortcuts,
  parseFeePeriod,
} from "@/lib/finance/period";

const today = "2026-10-04";
const current = { fromMonth: "2026-10", toMonth: "2026-10", from: "2026-10-01", to: "2026-10-31" };

describe("parseFeePeriod", () => {
  it("sem parâmetros usa o mês atual", () => {
    expect(parseFeePeriod(undefined, undefined, today)).toEqual(current);
  });

  it("aceita um intervalo válido e calcula o último dia do mês", () => {
    expect(parseFeePeriod("2025-11", "2026-02", today)).toEqual({
      fromMonth: "2025-11",
      toMonth: "2026-02",
      from: "2025-11-01",
      to: "2026-02-28",
    });
  });

  it("ano bissexto", () => {
    expect(parseFeePeriod("2028-02", "2028-02", today).to).toBe("2028-02-29");
  });

  it("só o início vale para um mês", () => {
    expect(parseFeePeriod("2026-09", undefined, today)).toMatchObject({
      fromMonth: "2026-09",
      toMonth: "2026-09",
    });
  });

  it("aceita até 24 meses", () => {
    expect(parseFeePeriod("2024-11", "2026-10", today)).toMatchObject({ fromMonth: "2024-11" });
  });

  it.each([
    ["mais de 24 meses", "2024-10", "2026-10"],
    ["fim antes do início", "2026-10", "2026-09"],
    ["mês 13", "2026-13", "2026-13"],
    ["formato errado", "10/2026", "10/2026"],
    ["injeção", "2026-10'--", "2026-10"],
    ["lista", ["2026-01", "2026-02"], "2026-02"],
  ])("%s volta para o mês atual", (_caso, de, ate) => {
    expect(parseFeePeriod(de, ate, today)).toEqual(current);
  });
});

describe("atalhos e textos", () => {
  it("este mês, mês passado e últimos 12 meses (virada de ano)", () => {
    expect(feePeriodShortcuts("2026-01-15")).toEqual([
      { label: "Este mês", fromMonth: "2026-01", toMonth: "2026-01" },
      { label: "Mês passado", fromMonth: "2025-12", toMonth: "2025-12" },
      { label: "Últimos 12 meses", fromMonth: "2025-02", toMonth: "2026-01" },
    ]);
  });

  it("rótulo do período", () => {
    expect(feePeriodLabel(current)).toBe("outubro de 2026");
    expect(feePeriodLabel(parseFeePeriod("2025-11", "2026-02", today))).toBe(
      "novembro de 2025 a fevereiro de 2026",
    );
  });

  it("nome do arquivo da planilha", () => {
    expect(feeCsvFileName(parseFeePeriod("2025-11", "2026-02", today))).toBe(
      "taxa-servico-2025-11_2026-02.csv",
    );
  });
});
