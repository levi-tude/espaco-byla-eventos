import { describe, expect, it } from "vitest";

import {
  checkedInLabel,
  pdfSafeText,
  ticketPdfLines,
  ticketPositionLabel,
  type TicketContent,
} from "@/lib/tickets/ticket-content";

const base: TicketContent = {
  eventName: "Noite de Forró",
  sessionName: "Sessão infantil",
  startsAt: "2026-10-10T19:00:00.000Z",
  endsAt: "2026-10-10T20:30:00.000Z",
  venue: "Espaço Byla",
  holderName: "Maria Exemplo",
  typeLabel: "Casadinha — Inteira",
  orderNumber: "A1B2C3D4",
  index: 1,
  total: 2,
  statusLabel: "Pago",
};

describe("linhas do PDF do ingresso", () => {
  it("tem todos os itens da lista 8.4.2, com acentos", () => {
    expect(ticketPdfLines(base)).toEqual([
      ["Evento", "Noite de Forró"],
      ["Sessão", "Sessão infantil"],
      ["Quando", "Sábado, 10 de outubro de 2026 · 16h00 - 17h30"],
      ["Local", "Espaço Byla"],
      ["Participante", "Maria Exemplo"],
      ["Tipo", "Casadinha - Inteira"],
      ["Ingresso", "1 de 2"],
      ["Pedido nº", "A1B2C3D4"],
      ["Status", "Pago"],
    ]);
  });

  it("sessão sem nome e ingresso único: sem linhas vazias", () => {
    const lines = ticketPdfLines({ ...base, sessionName: "  ", endsAt: null, total: 1 });
    const labels = lines.map(([label]) => label);
    expect(labels).not.toContain("Sessão");
    expect(labels).not.toContain("Ingresso");
    expect(lines).toContainEqual(["Quando", "Sábado, 10 de outubro de 2026 · 16h00"]);
  });

  it("texto do PDF só usa caracteres das fontes padrão", () => {
    for (const [label, value] of ticketPdfLines({ ...base, holderName: "Zoë “Zé” 😀" })) {
      expect(`${label}${value}`).toMatch(/^[\u0020-\u00FF]*$/);
    }
    expect(pdfSafeText("Zoë “Zé” 😀 — fim…")).toBe('Zoë "Zé"  - fim...');
  });
});

describe("posição e entrada", () => {
  it("'Ingresso X de Y' só com mais de um", () => {
    expect(ticketPositionLabel(2, 4)).toBe("Ingresso 2 de 4");
    expect(ticketPositionLabel(1, 1)).toBeNull();
  });

  it("'Entrou em' com data e hora de Brasília", () => {
    expect(checkedInLabel("2026-10-10T22:12:00.000Z")).toBe("Entrou em 10/10 às 19h12");
    expect(checkedInLabel(null)).toBeNull();
  });
});
