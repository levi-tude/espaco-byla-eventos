// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));
vi.mock("@/app/equipe/eventos/actions", () => ({ cancelTicket: vi.fn(), issueCourtesy: vi.fn() }));
vi.mock("@/app/equipe/eventos/order-actions", () => ({ refundOrder: vi.fn(), acceptPaidOrder: vi.fn(), resendOrderTickets: vi.fn() }));
vi.mock("@/components/equipe/check-in-feedback", () => ({
  playFeedback: vi.fn(),
  unlockAudio: vi.fn(),
  keepScreenOn: () => () => undefined,
}));
vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    start = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);
    pause = vi.fn();
    resume = vi.fn();
    clear = vi.fn();
    isScanning = false;
  },
}));

import { CheckInScanner } from "@/components/equipe/CheckInScanner";
import { TicketList, type TicketListItem } from "@/components/equipe/TicketList";
import { meiaRefuseSecondConfirm, shortSessionTime } from "@/lib/domain/meia-check";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let confirmMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  confirmMock = vi.fn(() => true);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockImplementation(confirmMock as never);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0/g, " ");
const json = (body: unknown) => ({ json: async () => body }) as Response;
const dialog = () => document.querySelector('[role="alertdialog"]');
function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!found) throw new Error(`botão ${label} não encontrado`);
  return found;
}
const click = (el: HTMLElement) => act(async () => el.click());
const meiaPosts = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/check-in/meia").map(([, init]) => JSON.parse(init.body));

describe("texto da segunda confirmação", () => {
  it("nome, meia, sessão, sem reembolso e diferença", () => {
    const p = meiaRefuseSecondConfirm({ buyerName: "Maria", sessionLabel: "sáb, 28/11 · 17h00 · Cápsulas", diffCents: 2500 });
    expect(p.title).toBe("Confirmar recusa de Maria – meia, sessão 17h?");
    expect(p.body.map(plain)).toEqual([
      "A entrada será desfeita e a pessoa NÃO entra. Não há reembolso.",
      "Ela só pode entrar se voltar com o comprovante ou pagar a diferença (R$ 25,00).",
    ]);
    expect(p.body.join(" ")).not.toMatch(/ID Jovem/);
  });

  it("sem diferença conhecida, sem sessão e sem nome", () => {
    const p = meiaRefuseSecondConfirm({ buyerName: " ", sessionLabel: null, diffCents: null });
    expect(p.title).toBe("Confirmar recusa de esta pessoa – meia?");
    expect(p.body[1]).toBe("Ela só pode entrar se voltar com o comprovante ou pagar a diferença.");
  });

  it("horário curto da sessão", () => {
    expect(shortSessionTime("sáb, 28/11 · 19h30")).toBe("19h30");
    expect(shortSessionTime("sáb, 28/11 · 09h00")).toBe("9h");
    expect(shortSessionTime("sem hora")).toBeNull();
  });
});

describe("lista de participantes: Recusado pede duas confirmações", () => {
  const ticket: TicketListItem = {
    id: TICKET, orderId: "o1", orderTotalCents: 2500, paymentProvider: "mercadopago",
    buyerName: "Maria", buyerEmail: "maria@exemplo.com", kind: "meia", typeLabel: "Meia-entrada",
    status: "check_in", orderStatus: "pago", decisionReason: null, priceCents: 2500,
    paidAt: "2026-11-20T12:00:00Z", recentlyPaid: false, checkedInAt: "2026-11-28T20:04:00Z",
    publicToken: "x", sessionId: "s1", entrySessionLabel: "sáb, 28/11 · 17h00",
  };
  const render = () =>
    act(async () => root.render(createElement(TicketList, { eventId: EVENT, tickets: [ticket], meiaChecksEnabled: true })));
  const rowRefuse = () =>
    button("Recusado", container.querySelector('[aria-label="Conferência da meia de Maria"]') as HTMLElement);

  it("cancelar a primeira: nada acontece", async () => {
    confirmMock.mockReturnValue(false);
    await render();
    await click(rowRefuse());
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(meiaPosts()).toEqual([]);
  });

  it("aceitar a primeira abre o diálogo; Voltar (padrão, com foco) não recusa", async () => {
    await render();
    await click(rowRefuse());
    const d = dialog() as HTMLElement;
    expect(d.textContent).toContain("Confirmar recusa de Maria – meia, sessão 17h?");
    expect(d.textContent).toContain("Não há reembolso.");
    expect(d.textContent).not.toContain("ID Jovem");
    expect(document.activeElement?.textContent).toBe("Voltar");
    expect(meiaPosts()).toEqual([]);
    await click(button("Voltar", d));
    expect(dialog()).toBeNull();
    expect(meiaPosts()).toEqual([]);
  });

  it("Esc também volta sem recusar", async () => {
    await render();
    await click(rowRefuse());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(dialog()).toBeNull();
    expect(meiaPosts()).toEqual([]);
  });

  it("'Sim, recusar' envia a recusa uma vez", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, result: "recusado", diffCents: null, checkedIn: false }));
    await render();
    await click(rowRefuse());
    await click(button("Sim, recusar", dialog() as HTMLElement));
    expect(dialog()).toBeNull();
    expect(meiaPosts()).toEqual([{ eventId: EVENT, ticketId: TICKET, result: "recusado" }]);
  });

  it("outros botões continuam com um toque só", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, result: "comprovante_ok", diffCents: null, checkedIn: true }));
    await render();
    await click(button("Comprovante ok", container.querySelector('[aria-label="Conferência da meia de Maria"]') as HTMLElement));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(meiaPosts()).toEqual([{ eventId: EVENT, ticketId: TICKET, result: "comprovante_ok" }]);
  });
});

describe("tela de leitura: Recusado pede duas confirmações", () => {
  async function readMeia() {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/check-in"
        ? json({ ok: true, ticketId: TICKET, meiaDiffCents: 2500, buyerName: "Maria", kind: "meia", typeLabel: "Meia-entrada", sessionLine: "sáb, 28/11 · 17h00 · Cápsulas do Tempo" })
        : json({ ok: true, result: "recusado", diffCents: null, checkedIn: false }),
    );
    await act(async () => root.render(createElement(CheckInScanner, { eventId: EVENT, sessionId: "33333333-3333-4333-8333-333333333333", meiaChecks: true })));
    const input = container.querySelector("#manual-code") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "ABC123");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (input.form as HTMLFormElement).requestSubmit());
  }

  it("Voltar mantém a meia pendente; 'Sim, recusar' recusa", async () => {
    await readMeia();
    await click(button("Recusado"));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    let d = dialog() as HTMLElement;
    expect(d.textContent).toContain("Confirmar recusa de Maria – meia, sessão 17h?");
    expect(plain(d.textContent)).toContain("pagar a diferença (R$ 25,00)");
    await click(button("Voltar", d));
    expect(meiaPosts()).toEqual([]);
    expect(container.querySelector("[data-meia]")?.getAttribute("data-meia")).not.toBe("recusado");

    await click(button("Recusado"));
    d = dialog() as HTMLElement;
    await click(button("Sim, recusar", d));
    expect(meiaPosts()).toEqual([{ eventId: EVENT, ticketId: TICKET, result: "recusado" }]);
  });

  it("cancelar a primeira não abre a segunda", async () => {
    await readMeia();
    confirmMock.mockReturnValue(false);
    await click(button("Recusado"));
    expect(dialog()).toBeNull();
    expect(meiaPosts()).toEqual([]);
  });
});
