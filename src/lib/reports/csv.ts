/**
 * Planilha do relatório do evento. Só números agregados: sem nome, e-mail,
 * telefone, código ou token. Colunas de dinheiro só para quem pode ver.
 */

import { csvMoney, csvText } from "@/lib/finance/fee-csv";
import type { ReportView } from "@/lib/reports/model";

function quote(cell: string): string {
  return /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function table(rows: string[][]): string {
  return rows.map((row) => row.map(quote).join(";")).join("\r\n");
}

export function buildEventReportCsv(view: ReportView, eventName: string): string {
  const blocks: string[][][] = [];
  blocks.push([
    ["Relatório do evento"],
    [csvText(eventName)],
    ["Estado", csvText(view.stateLabel)],
  ]);

  blocks.push([
    ["Resumo"],
    ["Indicador", "Valor", "Detalhe"],
    ...view.cards.map((card) => [csvText(card.label), csvText(card.value), csvText(card.hint)]),
  ]);

  blocks.push([
    ["Lotação por sessão"],
    ["Sessão", "Ocupam lugar", "Capacidade", "Livres", "Capacitação (fora da lotação)", "Cancelada"],
    ...view.sessions.map((session) => [
      csvText(session.title),
      String(session.occupied),
      String(session.capacity),
      String(session.free),
      String(session.training),
      session.cancelled ? "sim" : "não",
    ]),
  ]);

  blocks.push([
    ["Por tipo (pessoas)"],
    ["Tipo", "Pessoas"],
    ...view.types.map((type) => [csvText(type.label), String(type.people)]),
  ]);

  blocks.push([
    ["Por dia"],
    ["Dia", view.dailyIsMoney ? "Ingressos (R$)" : "Ingressos"],
    ...view.daily.map((row) => [csvText(row.label), view.dailyIsMoney ? csvMoney(row.value) : String(row.value)]),
  ]);

  blocks.push([
    ["Portaria"],
    ["Presentes", String(view.doorPresent)],
    ["Válidos", String(view.doorExpected)],
    ["Falta", csvText(view.noShowLabel)],
    ["Meia comprovante ok", String(view.meiaOk)],
    ["Meia diferença paga", String(view.meiaDiff)],
    ["Meia recusada", String(view.meiaRefused)],
  ]);

  if (view.money === "full" && view.split) {
    blocks.push([
      ["Financeiro do evento"],
      ["O cliente pagou (R$)", csvMoney(view.split.organizerCents + view.split.netCents + view.split.providerCents)],
      ["Organizador (R$)", csvMoney(view.split.organizerCents)],
      ["Taxa de serviço bruta (R$)", csvMoney(view.split.netCents + view.split.providerCents)],
      ["Tarifa do provedor (R$)", csvMoney(view.split.providerCents)],
      ["Taxa líquida (R$)", csvMoney(view.split.netCents)],
    ]);
  }

  if (view.money === "simple" && view.simpleLines.length) {
    blocks.push([
      ["Seu financeiro"],
      ["Linha", "Valor"],
      ...view.simpleLines.map((line) => [csvText(line.label), csvText(line.value)]),
    ]);
  }

  blocks.push([
    ["Estornos"],
    ["Item", "Valor"],
    ...view.refundRows.map((row) => [csvText(row.label), csvText(row.value)]),
  ]);

  const body = blocks.map((rows) => table(rows)).join("\r\n\r\n");
  return `\uFEFF${body}\r\n`;
}
