/**
 * Roteiro da retrospectiva. Só reorganiza o que o relatório já calculou
 * (as funções do banco). Não busca dado novo e não inclui pessoa nenhuma.
 */

import { formatMoney } from "@/lib/domain/service-fee";
import type { ReportView } from "@/lib/reports/model";

export const STORY_MS = 7000;

export type StoryBar = {
  label: string;
  value: number;
  display: string;
  color: string;
};

export type StorySlide = {
  id: string;
  kicker: string;
  title: string;
  hero: string | null;
  heroLabel: string | null;
  lines: { label: string; value: string }[];
  bars: StoryBar[];
  note: string | null;
};

export function storyAutoplayMs(reducedMotion: boolean): number | null {
  return reducedMotion ? null : STORY_MS;
}

/** No último slide, avançar fecha. No primeiro, voltar fica no lugar. */
export function stepStory(
  index: number,
  length: number,
  direction: 1 | -1,
): { index: number; close: boolean } {
  const next = index + direction;
  if (next >= length) return { index, close: true };
  if (next < 0) return { index: 0, close: false };
  return { index: next, close: false };
}

/** Como nos stories: a faixa da esquerda volta, o resto avança. */
export function storyTapZone(ratio: number): "prev" | "next" {
  return ratio < 0.35 ? "prev" : "next";
}

function peakOf(rows: readonly { label: string; value: number }[]) {
  return rows.reduce<{ label: string; value: number } | null>((best, row) => {
    if (!best || row.value > best.value) return row;
    return best;
  }, null);
}

function sum(rows: readonly { value: number }[]) {
  return rows.reduce((total, row) => total + row.value, 0);
}

function topBars(rows: StoryBar[], limit = 8): { bars: StoryBar[]; extra: number } {
  if (rows.length <= limit) return { bars: rows, extra: 0 };
  return { bars: rows.slice(0, limit), extra: rows.length - limit };
}

export function buildRetrospective(input: {
  eventName: string;
  whenLabel: string;
  view: ReportView;
}): StorySlide[] {
  const { view } = input;
  const daily = view.daily;
  const first = daily[0];
  const last = daily[daily.length - 1];
  const peak = peakOf(daily);
  const total = sum(daily);
  const money = view.dailyIsMoney;
  const dailyBars = topBars(
    daily.map((row) => ({
      label: row.label,
      value: row.value,
      display: money ? formatMoney(row.value) : String(row.value),
      color: peak && row.label === peak.label ? "#FFBD38" : "#4080FC",
    })),
  );

  const slides: StorySlide[] = [
    {
      id: "abertura",
      kicker: "Retrospectiva",
      title: input.eventName,
      hero: input.whenLabel || view.stateLabel,
      heroLabel: view.stateLabel,
      lines: [],
      bars: [],
      note: "A história deste evento, com os mesmos números do relatório.",
    },
    {
      id: "vendas",
      kicker: "Abertura das vendas",
      title: first ? `A primeira venda caiu em ${first.label}` : "Ainda não há venda paga",
      hero: daily.length ? (money ? formatMoney(total) : String(total)) : "0",
      heroLabel: money ? "em ingressos, no total" : "ingressos válidos no período",
      lines: [
        { label: "Dias com venda", value: String(daily.length) },
        ...(last && first && last.label !== first.label
          ? [{ label: "Até", value: last.label }]
          : []),
      ],
      bars: [],
      note: "Pelo dia do pagamento. A hora em que a venda foi ligada não entra aqui.",
    },
    {
      id: "ritmo",
      kicker: "Ao longo do tempo",
      title: daily.length > 1 ? "O ritmo das vendas" : "Um único dia de vendas",
      hero: null,
      heroLabel: null,
      lines: [],
      bars: dailyBars.bars,
      note:
        dailyBars.extra > 0
          ? `Mais ${dailyBars.extra} dias ficam de fora deste quadro.`
          : money
            ? "Cada barra é a receita dos ingressos naquele dia."
            : "Cada barra é a quantidade de ingressos válidos naquele dia.",
    },
    {
      id: "pico",
      kicker: "Pico",
      title: peak && peak.value > 0 ? `O auge foi ${peak.label}` : "Ainda sem um dia de pico",
      hero: peak && peak.value > 0 ? (money ? formatMoney(peak.value) : String(peak.value)) : "—",
      heroLabel: peak && peak.value > 0 ? (money ? "naquele dia" : "ingressos naquele dia") : null,
      lines: [],
      bars: [],
      note: daily.length > 1 ? "É o dia que mais pesou na história da venda." : "Com um dia só, o pico é esse dia.",
    },
    {
      id: "sessoes",
      kicker: "Sessões",
      title: view.sessions.length > 1 ? "Como cada sessão encheu" : "A lotação",
      hero: view.cards.find((card) => card.label.startsWith("Lotação"))?.value ?? null,
      heroLabel: "lugares ocupados",
      lines: view.sessions.map((session) => ({
        label: session.cancelled ? `${session.title} (cancelada)` : session.title,
        value: `${session.occupied} de ${session.capacity} · ${session.percent}%`,
      })),
      bars: view.sessions.map((session) => ({
        label: session.title,
        value: session.percent,
        display: `${session.occupied}/${session.capacity}`,
        color: session.cancelled ? "#A1A1AA" : "#4080FC",
      })),
      note: view.sessions.some((session) => session.training > 0)
        ? "A barra é quem ocupa lugar. Capacitação fica de fora."
        : "Quem ocupa lugar, incluindo cortesias.",
    },
    {
      id: "tipos",
      kicker: "Ingressos",
      title: "Quem veio em cada tipo",
      hero: String(view.typeTotal),
      heroLabel: "pessoas com ingresso válido",
      lines: view.types.map((type) => ({ label: type.label, value: String(type.people) })),
      bars: view.types.map((type) => ({
        label: type.label,
        value: type.people,
        display: String(type.people),
        color: type.color,
      })),
      note: view.typeNote ?? "Casadinha conta cada pessoa, não a unidade vendida.",
    },
    {
      id: "extras",
      kicker: "Meia, bônus e capacitação",
      title: "Os casos especiais",
      hero: null,
      heroLabel: null,
      lines: [
        { label: "Meia-entrada", value: String(view.meiaSold) },
        { label: "Comprovante ok", value: String(view.meiaOk) },
        { label: "Diferença paga", value: String(view.meiaDiff) },
        { label: "Recusadas", value: String(view.meiaRefused) },
        { label: "Bônus", value: String(view.types.find((type) => type.key === "bonus")?.people ?? 0) },
        { label: "Capacitação", value: String(view.types.find((type) => type.key === "capacitacao")?.people ?? 0) },
      ],
      bars: [],
      note: "Capacitação não ocupa a lotação. Bônus ocupa, e não gera pagamento.",
    },
    {
      id: "dia",
      kicker: "Dia do evento",
      title: view.doorExpected > 0 ? "Quem passou na porta" : "A porta ainda não contou entradas",
      hero: view.doorExpected > 0 ? `${view.doorPercent}%` : "0",
      heroLabel: "dos ingressos válidos já entraram",
      lines: [
        { label: "Presentes", value: `${view.doorPresent} de ${view.doorExpected}` },
        { label: "Falta", value: view.noShowLabel },
      ],
      bars: view.arrival.flatMap((block) =>
        block.buckets.map((bucket) => ({
          label: view.arrival.length > 1 ? `${block.title} ${bucket.label}` : bucket.label,
          value: bucket.count,
          display: String(bucket.count),
          color: "#FFBD38",
        })),
      ),
      note: view.arrival.length ? "Entradas agrupadas de 10 em 10 minutos." : "Ainda não há horário de entrada.",
    },
  ];

  if (view.money === "full" && view.split) {
    const gross = view.split.netCents + view.split.providerCents;
    slides.push({
      id: "financeiro",
      kicker: "Financeiro",
      title: "Para onde foi o dinheiro",
      hero: view.split.client,
      heroLabel: "o cliente pagou",
      lines: [
        { label: "Organizador", value: view.split.organizer },
        { label: "Taxa de serviço bruta", value: formatMoney(gross) },
        { label: "Tarifa do provedor", value: view.split.provider },
        { label: "Taxa líquida", value: view.split.net },
      ],
      bars: [
        { label: "Organizador", value: Math.max(view.split.organizerCents, 0), display: view.split.organizer, color: "#4080FC" },
        { label: "Taxa líquida", value: Math.max(view.split.netCents, 0), display: view.split.net, color: "#4ADE80" },
        { label: "Tarifa do provedor", value: Math.max(view.split.providerCents, 0), display: view.split.provider, color: "#F87171" },
      ],
      note: view.split.note,
    });
  } else if (view.money === "simple" && view.simpleLines.length) {
    const receive = view.simpleLines.find((line) => line.label === "Você recebe");
    slides.push({
      id: "financeiro",
      kicker: "Financeiro",
      title: "O seu resultado",
      hero: receive?.value ?? null,
      heroLabel: "você recebe",
      lines: view.simpleLines.map((line) => ({ label: line.label, value: line.value })),
      bars: [],
      note: view.simpleNote,
    });
  }

  slides.push(
    {
      id: "estornos",
      kicker: "Estornos",
      title: view.refundRows.some((row) => row.value !== "0" && row.value !== "0 pedidos")
        ? "O que voltou"
        : "Nenhum estorno neste recorte",
      hero: null,
      heroLabel: null,
      lines: view.refundRows,
      bars: [],
      note:
        view.refundMode === "full"
          ? "O estorno é sempre do pedido inteiro. A tarifa do provedor, se o banco não devolver, fica com a ACDH."
          : view.refundMode === "simple"
            ? "O estorno devolve o pedido inteiro. Da sua parte sai só o valor dos ingressos."
            : "O estorno devolve o pedido inteiro e a vaga volta na hora.",
    },
    {
      id: "resumo",
      kicker: "Para guardar",
      title: "O evento em números",
      hero: view.cards.find((card) => card.label.startsWith("Lotação"))?.value ?? null,
      heroLabel: "lotação",
      lines: summaryLines(view),
      bars: [],
      note: "Estes números são os do relatório. Nada aqui identifica quem comprou.",
    },
  );

  return slides;
}

function summaryLines(view: ReportView): { label: string; value: string }[] {
  if (view.money === "full" && view.split) {
    return [
      { label: "O cliente pagou", value: view.split.client },
      { label: "Organizador", value: view.split.organizer },
      { label: "Taxa líquida", value: view.split.net },
      { label: "Presentes", value: `${view.doorPresent} de ${view.doorExpected}` },
    ];
  }
  if (view.money === "simple") {
    return view.simpleLines
      .filter((line) => line.emphasis || line.label.startsWith("O cliente"))
      .map((line) => ({ label: line.label, value: line.value }))
      .concat([{ label: "Presentes", value: `${view.doorPresent} de ${view.doorExpected}` }]);
  }
  return [
    { label: "Ingressos válidos", value: String(view.typeTotal) },
    { label: "Presentes", value: `${view.doorPresent} de ${view.doorExpected}` },
    { label: "Pendentes", value: String(view.pendingTotal) },
  ];
}
