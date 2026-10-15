import { describe, expect, it } from "vitest";

import { buildPayoutsCsv, PAYOUT_CSV_HEADER, type PayoutCsvRow } from "@/lib/organizer/payout-csv";

const row = (o: Partial<PayoutCsvRow> = {}): PayoutCsvRow => ({
  pixDate: "2026-10-29",
  createdAt: "2026-10-29T15:00:00Z",
  kind: "repasse",
  organizer: "Produtora P",
  event: "Show Um",
  amountCents: 43905,
  createdByName: "Admin",
  noteOrReason: null,
  ...o,
});

describe("buildPayoutsCsv", () => {
  it("cabeçalho fixo, BOM, ; e CRLF, valor com vírgula", () => {
    const csv = buildPayoutsCsv([row()]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(PAYOUT_CSV_HEADER.join(";"));
    expect(lines[1]).toBe("29/10/2026;29/10/2026;Repasse;Produtora P;Show Um;439,05;Admin;");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("tipo em palavras e valor sem sinal", () => {
    const csv = buildPayoutsCsv([
      row({ amountCents: -5000 }),
      row({ kind: "ajuste", amountCents: 100, pixDate: null, noteOrReason: "Motivo" }),
      row({ kind: "ajuste", amountCents: -100, pixDate: null }),
      row({ kind: "devolucao", amountCents: -4739 }),
    ]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toContain(";Desconto no repasse;");
    expect(lines[1]).toContain(";50,00;");
    expect(lines[2]).toBe(";29/10/2026;Ajuste a favor do Espaço;Produtora P;Show Um;1,00;Admin;Motivo");
    expect(lines[3]).toContain(";Ajuste a favor do organizador;");
    expect(lines[4]).toContain(";Devolução recebida;");
    expect(lines[4]).toContain(";47,39;");
  });

  it("texto que começa com fórmula é escapado e ; vira célula entre aspas", () => {
    const csv = buildPayoutsCsv([row({ event: "=HYPERLINK(1)", organizer: "-Produtora", noteOrReason: "a;b" })]);
    expect(csv).toContain(";'=HYPERLINK(1);");
    expect(csv).toContain(";'-Produtora;");
    expect(csv).toContain(';"a;b"');
  });

  it("nenhuma coluna de PIX, titular ou documento", () => {
    expect(PAYOUT_CSV_HEADER.join(" ")).not.toMatch(/chave|titular|cpf|cnpj|documento/i);
    expect(PAYOUT_CSV_HEADER.filter((h) => /pix/i.test(h))).toEqual(["Data do PIX"]);
  });
});
