import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement("a", { href }, children as never),
}));
vi.mock("@/app/equipe/eventos/actions", () => ({ cancelTicket: vi.fn(), issueCourtesy: vi.fn() }));
vi.mock("@/app/equipe/eventos/order-actions", () => ({
  refundOrder: vi.fn(),
  acceptPaidOrder: vi.fn(),
  resendOrderTickets: vi.fn(),
}));

import { TicketList, type TicketListItem } from "@/components/equipe/TicketList";

const base: TicketListItem = {
  id: "t1",
  orderId: "o1",
  orderTotalCents: 4000,
  paymentProvider: "mercadopago",
  buyerName: "Fulana de Tal",
  buyerEmail: "fulana@exemplo.com",
  kind: "meia",
  typeLabel: "Meia-entrada",
  status: "pago",
  orderStatus: "pago",
  decisionReason: null,
  priceCents: 2000,
  paidAt: "2026-11-20T12:00:00Z",
  recentlyPaid: false,
  checkedInAt: null,
  publicToken: "token-publico",
  sessionId: "00000000-0000-4000-8000-000000000002",
};

function render(tickets: TicketListItem[]) {
  return renderToStaticMarkup(
    createElement(TicketList, { eventId: "00000000-0000-4000-8000-000000000001", tickets }),
  );
}

describe("lista de participantes: Dar entrada", () => {
  it("ingresso pago com sessão ganha o botão; busca aceita nome ou e-mail", () => {
    const markup = render([base]);
    expect(markup).toContain("Dar entrada");
    expect(markup).toContain("Buscar por nome ou e-mail");
  });

  it.each([
    ["já entrou", { status: "check_in" as const, checkedInAt: "2026-11-28T20:04:00Z" }],
    ["estornado", { status: "estornado" as const }],
    ["não pago", { status: "nao_pago" as const, orderStatus: "pendente" as const }],
    ["aguardando decisão", { orderStatus: "aguardando_decisao" as const }],
    ["sem sessão", { sessionId: null }],
  ])("%s não tem o botão", (_caso, patch) => {
    expect(render([{ ...base, ...patch }])).not.toContain("Dar entrada");
  });
});
