import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));
vi.mock("@/app/equipe/eventos/actions", () => ({ cancelTicket: vi.fn(), issueCourtesy: vi.fn() }));
vi.mock("@/app/equipe/eventos/order-actions", () => ({ refundOrder: vi.fn(), acceptPaidOrder: vi.fn(), resendOrderTickets: vi.fn() }));

import { CheckInCounter } from "@/components/equipe/CheckInCounter";
import { CheckInResultCard, toCheckInResult } from "@/components/equipe/CheckInResultCard";
import type { MeiaPanelState } from "@/components/equipe/MeiaCheckButtons";
import { TicketList, type TicketListItem } from "@/components/equipe/TicketList";

const order = {
  total: 2,
  entered: 2,
  tickets: [
    { typeLabel: "Meia-entrada", kind: "meia" as const, entered: true, enteredAt: "17h04", current: true },
    { typeLabel: "Inteira", kind: "inteira" as const, entered: true, enteredAt: "17h04", current: false },
  ],
};
const meiaResult = toCheckInResult({
  ok: true,
  buyerName: "Maria",
  kind: "meia",
  typeLabel: "Meia-entrada",
  sessionLine: "",
  order,
  ticketId: "22222222-2222-4222-8222-222222222222",
  meiaDiffCents: 2500,
});
const panel = (patch: Partial<MeiaPanelState> = {}): MeiaPanelState => ({
  enabled: true,
  mark: null,
  busy: false,
  error: null,
  diffCents: 2500,
  ...patch,
});
const card = (meia?: MeiaPanelState) =>
  renderToStaticMarkup(createElement(CheckInResultCard, { result: meiaResult, meia, onMeiaMark: () => {}, onRedoEntry: () => {} }));

describe("tela da meia com conferência", () => {
  it("a resposta da meia guarda o ingresso e a diferença", () => {
    expect(meiaResult).toMatchObject({ tone: "meia", ticketId: "22222222-2222-4222-8222-222222222222", meiaDiffCents: 2500 });
  });

  it("pendente: amarela, 3 botões e aviso para tocar antes do próximo", () => {
    const html = card(panel());
    expect(html).toContain('data-meia="pendente"');
    expect(html).toContain("Conferir comprovante");
    expect(html).toContain("Comprovante ok");
    expect(html).toMatch(/Pagou a diferença \(R\$\s25,00\)/);
    expect(html).toContain("Recusado");
    expect(html).toContain("Toque em uma opção antes do próximo ingresso");
  });

  it("comprovante ok: fica verde, marcação destacada e dá para corrigir", () => {
    const html = card(panel({ mark: "comprovante_ok" }));
    expect(html).toContain('data-meia="comprovante_ok"');
    expect(html).toContain("bg-byla-success-solid");
    expect(html).toContain("Meia · comprovante ok");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Tocou errado? Escolha outra opção.");
  });

  it("recusado: vermelho, entrada desfeita, lista mostra 'não entrou' e botão de engano", () => {
    const html = card(panel({ mark: "recusado" }));
    expect(html).toContain("bg-byla-danger-solid");
    expect(html).toContain("Entrada desfeita · não liberar");
    expect(html).toContain("Pedido com 2 ingressos · 1 já entrou");
    expect(html).toContain("Foi engano: dar entrada de novo");
  });

  it("sem a migration (desligada): card amarelo de antes, sem botões", () => {
    const html = card(panel({ enabled: false }));
    expect(html).toContain("Meia – conferir comprovante");
    expect(html).not.toContain("Comprovante ok");
    expect(card(undefined)).not.toContain("Comprovante ok");
  });
});

describe("resumo da conferência", () => {
  it("contador mostra o resumo da sessão quando existe", () => {
    const counts = { present: 23, sold: 36, outsideCapacity: 0, capacity: 70, meiaPresent: 12, meiaSold: 20 };
    const html = renderToStaticMarkup(
      createElement(CheckInCounter, {
        counts,
        meia: { lidas: 13, comprovanteOk: 9, pagouDiferenca: 2, diferencaTotalCents: 5000, recusadas: 1, naoRegistradas: 1 },
      }),
    );
    expect(html).toContain("Conferência de meia");
    expect(html).toMatch(/diferença recebida: <span[^>]*>R\$\s50,00/);
    expect(html).toContain("Não registradas");
    expect(renderToStaticMarkup(createElement(CheckInCounter, { counts }))).not.toContain("Conferência de meia");
  });
});

const base: TicketListItem = {
  id: "t1",
  orderId: "o1",
  orderTotalCents: 2500,
  paymentProvider: "mercadopago",
  buyerName: "Maria",
  buyerEmail: "maria@exemplo.com",
  kind: "meia",
  typeLabel: "Meia-entrada",
  status: "check_in",
  orderStatus: "pago",
  decisionReason: null,
  priceCents: 2500,
  paidAt: "2026-11-20T12:00:00Z",
  recentlyPaid: false,
  checkedInAt: "2026-11-28T20:04:00Z",
  publicToken: "x",
  sessionId: "s1",
};
const list = (tickets: TicketListItem[], enabled: boolean) =>
  renderToStaticMarkup(createElement(TicketList, { eventId: "e1", tickets, meiaChecksEnabled: enabled }));

describe("lista de participantes com a conferência", () => {
  it("meia com entrada sem marcação: selo 'não registrada' e botões de conferência", () => {
    const html = list([{ ...base, meiaCheck: null }], true);
    expect(html).toContain("Meia: conferência não registrada");
    expect(html).toContain("Conferência da meia:");
  });

  it("marcação atual aparece no selo e no botão", () => {
    const html = list([{ ...base, meiaCheck: { result: "comprovante_ok", diffCents: null, checkedAt: "2026-11-28T20:05:00Z" } }], true);
    expect(html).toContain("Meia: comprovante ok");
    expect(html).toContain('aria-pressed="true"');
  });

  it("meia recusada: selo vermelho e 'Dar entrada' de novo", () => {
    const html = list(
      [{ ...base, status: "pago", checkedInAt: null, meiaCheck: { result: "recusado", diffCents: null, checkedAt: "2026-11-28T20:07:00Z" } }],
      true,
    );
    expect(html).toContain("Meia recusada às 17h07");
    expect(html).toContain("Dar entrada");
  });

  it("sem a migration: nada de conferência na lista", () => {
    const html = list([base], false);
    expect(html).not.toContain("Conferência da meia");
    expect(html).not.toContain("não registrada");
  });
});
