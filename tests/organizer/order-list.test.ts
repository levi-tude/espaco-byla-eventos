import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/organizador/eventos/order-actions", () => ({
  requestOrderRefund: vi.fn(),
  cancelOpsRequest: vi.fn(),
}));
vi.mock("@/app/organizador/eventos/actions", () => ({
  deleteOwnEvent: vi.fn(),
  requestEventDeletion: vi.fn(),
}));

import { DeleteEventSection } from "@/components/organizer/DeleteEventSection";
import { OpsRequestList, type OrganizerOpsRequest } from "@/components/organizer/OpsRequestList";
import { type OrganizerOrder, OrganizerOrderList } from "@/components/organizer/OrganizerOrderList";

const EVENT_ID = "00000000-0000-4000-8000-000000000001";

function order(overrides: Partial<OrganizerOrder> = {}): OrganizerOrder {
  return {
    orderId: "abcdef12-0000-4000-8000-000000000010",
    orderNumber: "ABCDEF12",
    buyerName: "Fulana de Tal",
    buyerEmail: "fulana@exemplo.com",
    sessionLabel: "sáb, 10/10 · 19h00",
    items: [
      { name: "Inteira", quantity: 2 },
      { name: "Meia-entrada", quantity: 1 },
    ],
    status: "pago",
    isCourtesy: false,
    ticketsTotal: 3,
    ticketsCheckedIn: 0,
    refundRequest: null,
    ...overrides,
  };
}

function renderOrders(orders: OrganizerOrder[]) {
  return renderToStaticMarkup(createElement(OrganizerOrderList, { orders }));
}

function refundButtons(html: string): number {
  return html.split("Pedir estorno").length - 1;
}

describe("OrganizerOrderList", () => {
  it("mostra só os dados combinados do pedido e o aviso dos Termos", () => {
    const html = renderOrders([order({ ticketsCheckedIn: 2 })]);
    expect(html).toContain("Nº ABCDEF12");
    expect(html).toContain("Fulana de Tal");
    expect(html).toContain("fulana@exemplo.com");
    expect(html).toContain("sáb, 10/10 · 19h00");
    expect(html).toContain("2× Inteira");
    expect(html).toContain("1× Meia-entrada");
    expect(html).toContain("Pago");
    expect(html).toContain("2 de 3 já entraram");
    expect(html).toContain("Use estes dados só para a operação deste evento (Termos do organizador, item 9).");
    expect(html).toContain("Precisa de cortesias? Peça à equipe da ACDH Eventos pelo WhatsApp.");
  });

  it.each([
    ["estornado", { status: "estornado" as const }, "Estornado"],
    ["aguardando decisão", { status: "aguardando_decisao" as const }, "Pago sem vaga — a equipe vai decidir"],
    ["cortesia", { isCourtesy: true }, "Cortesia"],
  ])("situação %s", (_label, overrides, text) => {
    expect(renderOrders([order(overrides)])).toContain(text);
  });

  it("“Pedir estorno” só aparece em pedido pago, sem entrada e sem pedido em análise", () => {
    expect(refundButtons(renderOrders([order()]))).toBe(1);
    expect(refundButtons(renderOrders([order({ isCourtesy: true })]))).toBe(0);
    expect(refundButtons(renderOrders([order({ status: "estornado" })]))).toBe(0);
    expect(refundButtons(renderOrders([order({ ticketsCheckedIn: 1 })]))).toBe(0);
    expect(refundButtons(renderOrders([order({ status: "aguardando_decisao" })]))).toBe(0);
    const pending = renderOrders([order({ refundRequest: "pendente" })]);
    expect(refundButtons(pending)).toBe(0);
    expect(pending).toContain("Estorno pedido — aguardando a equipe");
  });

  it("nunca recebe telefone, link do pedido nem código do ingresso", () => {
    for (const field of ["buyerPhone", "phone", "publicToken", "public_token", "ticketCodes", "code"] as const) {
      expectTypeOf<OrganizerOrder>().not.toHaveProperty(field);
    }
    const extra = {
      ...order(),
      buyerPhone: "71900000003",
      publicToken: "tok_segredo",
      ticketCodes: ["11111111-1111-4111-8111-111111111111"],
    };
    const html = renderOrders([extra]);
    expect(html).not.toContain("71900000003");
    expect(html).not.toContain("tok_segredo");
    expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(html).not.toContain("/pedidos/");
  });

  it("sem pedidos mostra mensagem simples", () => {
    expect(renderOrders([])).toContain("Nenhum pedido ainda.");
  });
});

describe("OpsRequestList", () => {
  const requests: OrganizerOpsRequest[] = [
    {
      id: "00000000-0000-4000-8000-000000000020",
      kind: "estorno",
      orderNumber: "ABCDEF12",
      what: null,
      reason: "Comprador desistiu.",
      status: "pendente",
      decisionNote: null,
      createdLabel: "14/10/2026",
    },
    {
      id: "00000000-0000-4000-8000-000000000021",
      kind: "mudanca",
      orderNumber: null,
      what: "Sessão de 19h passa para 20h",
      reason: "Atraso do artista.",
      status: "recusado",
      decisionNote: "Vamos conversar pelo WhatsApp.",
      createdLabel: "13/10/2026",
    },
  ];

  it("lista os pedidos com situação e cancelar só nos pendentes", () => {
    const html = renderToStaticMarkup(createElement(OpsRequestList, { requests }));
    expect(html).toContain("Estorno");
    expect(html).toContain("Pedido nº ABCDEF12");
    expect(html).toContain("Em análise");
    expect(html).toContain("Sessão de 19h passa para 20h");
    expect(html).toContain("Recusado");
    expect(html).toContain("Vamos conversar pelo WhatsApp.");
    expect(html.split("Cancelar pedido").length - 1).toBe(1);
  });

  it("sem pedidos mostra mensagem simples", () => {
    expect(renderToStaticMarkup(createElement(OpsRequestList, { requests: [] }))).toContain(
      "Nenhum pedido à equipe.",
    );
  });
});

describe("DeleteEventSection", () => {
  it("sem vendas: “Excluir evento” pedindo o nome", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteEventSection, { eventId: EVENT_ID, eventName: "Peça Y", hasSales: false, deletionPending: false }),
    );
    expect(html).toContain("Excluir evento");
    expect(html).not.toContain("Pedir exclusão");
  });

  it("com vendas: “Pedir exclusão” explicando que as vendas pausam", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteEventSection, { eventId: EVENT_ID, eventName: "Peça Y", hasSales: true, deletionPending: false }),
    );
    expect(html).toContain("Pedir exclusão");
    expect(html).toContain("As vendas pausam na hora e a ACDH Eventos decide.");
  });

  it("com pedido de exclusão em análise não oferece outro", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteEventSection, { eventId: EVENT_ID, eventName: "Peça Y", hasSales: true, deletionPending: true }),
    );
    expect(html).toContain("Pedido de exclusão em análise");
    expect(html).not.toContain(">Pedir exclusão<");
  });
});
