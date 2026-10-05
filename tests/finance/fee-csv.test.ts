import { describe, expect, it } from "vitest";

import type { OverviewEvent } from "@/lib/domain/fee-payout";
import { buildFeeCsv, csvMoney, csvText, FEE_CSV_HEADER } from "@/lib/finance/fee-csv";

const today = "2026-10-20";

function event(patch: Partial<OverviewEvent> = {}): OverviewEvent {
  return {
    eventId: "00000000-0000-4000-8000-000000000001",
    name: "Show X",
    lastSessionAt: "2026-10-03",
    dueDate: "2026-10-04",
    ticketsCents: 37500,
    feeCents: 1875,
    refundedCents: 5250,
    contestedCents: 0,
    feeDueCents: 1625,
    paidOutCents: 0,
    balanceCents: 1625,
    lastPayout: null,
    ...patch,
  };
}

function rows(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter(Boolean)
    .map((line) => line.split(";"));
}

describe("csvMoney", () => {
  it.each([
    [0, "0,00"],
    [5, "0,05"],
    [1875, "18,75"],
    [123456, "1234,56"],
    [-250, "-2,50"],
  ])("%i centavos → %s", (cents, text) => {
    expect(csvMoney(cents)).toBe(text);
  });
});

describe("csvText", () => {
  it.each(["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "protege texto que começa com caractere de fórmula (%s)",
    (value) => {
      expect(csvText(value)).toBe(`'${value}`);
    },
  );

  it("não mexe em texto comum nem em vazio", () => {
    expect(csvText("Show X")).toBe("Show X");
    expect(csvText(null)).toBe("");
  });
});

describe("buildFeeCsv", () => {
  it("começa com BOM, usa ; e CRLF, e tem o cabeçalho combinado", () => {
    const csv = buildFeeCsv([event()], today);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
    expect(rows(csv)[0]).toEqual(FEE_CSV_HEADER);
  });

  it("linha do evento com vírgula decimal e situação", () => {
    const [, line] = rows(buildFeeCsv([event()], today));
    expect(line).toEqual([
      "Show X",
      "03/10/2026",
      "375,00",
      "18,75",
      "52,50",
      "0,00",
      "16,25",
      "0,00",
      "16,25",
      "A pagar · R$ 16,25",
      "",
      "",
      "",
    ]);
  });

  it("evento pago mostra data do PIX, quem marcou e a nota", () => {
    const [, line] = rows(
      buildFeeCsv(
        [
          event({
            paidOutCents: 1625,
            balanceCents: 0,
            lastPayout: {
              createdAt: "2026-10-06T15:00:00.000Z",
              createdByName: "Ana",
              pixDate: "2026-10-06",
              note: "E1234",
            },
          }),
        ],
        today,
      ),
    );
    expect(line.slice(9)).toEqual(["Pago em 06/10 por Ana", "06/10/2026", "Ana", "E1234"]);
  });

  it("saldo negativo continua número (sem apóstrofo) e texto livre é protegido", () => {
    const [, line] = rows(
      buildFeeCsv(
        [
          event({
            name: "=cmd|' /C calc'!A0",
            feeDueCents: 0,
            paidOutCents: 250,
            balanceCents: -250,
            lastPayout: {
              createdAt: "2026-10-06T15:00:00.000Z",
              createdByName: "@Ana",
              pixDate: "2026-10-06",
              note: "-nota",
            },
          }),
        ],
        today,
      ),
    );
    expect(line[0]).toBe("'=cmd|' /C calc'!A0");
    expect(line[8]).toBe("-2,50");
    expect(line[9]).toBe("Desconto pendente · −R$ 2,50");
    expect(line[11]).toBe("'@Ana");
    expect(line[12]).toBe("'-nota");
  });

  it("aspas, ; e quebras de linha no nome ficam entre aspas", () => {
    const csv = buildFeeCsv([event({ name: 'Festa "A"; B' })], today);
    expect(csv).toContain('"Festa ""A""; B";');
  });

  it("evento que ainda não terminou fica aguardando", () => {
    const [, line] = rows(buildFeeCsv([event({ dueDate: "2026-10-21" })], today));
    expect(line[9]).toBe("Aguardando fim do evento");
  });

  it("não leva dados de compradores (só colunas do evento)", () => {
    const csv = buildFeeCsv([event()], today);
    expect(rows(csv)[0]).not.toContain("Comprador");
    expect(csv).not.toMatch(/@\w+\.\w+/);
  });

  it("sem eventos, só o cabeçalho", () => {
    expect(rows(buildFeeCsv([], today))).toHaveLength(1);
  });
});
