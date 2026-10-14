// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  createOrganizerEvent: vi.fn(),
  updateOrganizerEvent: vi.fn(),
  withdrawEventSubmission: vi.fn(),
  requestEventChange: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/app/equipe/eventos/actions", () => ({
  createEvent: mocks.createEvent,
  updateEvent: mocks.updateEvent,
}));
vi.mock("@/app/organizador/eventos/actions", () => ({
  createOrganizerEvent: mocks.createOrganizerEvent,
  updateOrganizerEvent: mocks.updateOrganizerEvent,
  withdrawEventSubmission: mocks.withdrawEventSubmission,
  requestEventChange: mocks.requestEventChange,
}));
vi.mock("@/components/equipe/CoverField", () => ({
  CoverField: ({ defaultValue }: { defaultValue: string | null }) =>
    createElement("input", { defaultValue: defaultValue ?? "", name: "coverImageUrl", type: "hidden" }),
}));

import { EventForm } from "@/components/equipe/EventForm";
import type { EditorSession } from "@/components/equipe/session-drafts";
import type { EditorTicketType } from "@/components/equipe/TicketTypesEditor";
import type { LockedField } from "@/lib/organizer/post-approval";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const ALL_LOCKS: LockedField[] = ["nome", "local", "horario", "preco", "lotacao"];

const ticketTypes: EditorTicketType[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    preset: "inteira",
    name: "Inteira",
    peoplePerUnit: 1,
    hasSales: true,
    unitsSold: 3,
    unitsTaken: 3,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    preset: "meia",
    name: "Meia-entrada",
    peoplePerUnit: 1,
    hasSales: false,
    unitsSold: 0,
    unitsTaken: 0,
  },
];

function session(id: string, overrides: Partial<EditorSession> = {}): EditorSession {
  return {
    id,
    name: null,
    startsAt: "2099-12-12T22:00:00.000Z",
    endsAt: null,
    capacity: 80,
    inteiraQuota: null,
    meiaQuota: 30,
    prices: {
      "preset:inteira": { priceCents: 5000, maxUnits: null, onSale: true },
      "preset:meia": { priceCents: 2500, maxUnits: 10, onSale: true },
    },
    sold: 3,
    occupied: 3,
    hasOrders: true,
    liveOrders: true,
    paidOrders: 2,
    ...overrides,
  };
}

function event(sessions: EditorSession[]) {
  return {
    id: EVENT_ID,
    name: "Peça Y",
    venue: "Espaço Byla",
    description: "Uma peça.",
    ticketTypes,
    sessions,
    coverImageUrl: null,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // jsdom não abre <dialog> sozinho.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createEvent.mockResolvedValue({ ok: true, data: { id: EVENT_ID } });
  mocks.createOrganizerEvent.mockResolvedValue({ ok: true, data: { id: EVENT_ID } });
  mocks.updateOrganizerEvent.mockResolvedValue({ ok: true, data: undefined });
  mocks.withdrawEventSubmission.mockResolvedValue({ ok: true, data: undefined });
  mocks.requestEventChange.mockResolvedValue({ ok: true, data: undefined });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: Parameters<typeof EventForm>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(EventForm, props)));
}

function pageText(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function scope(label?: string): ParentNode {
  if (!label) return container;
  const found = container.querySelector(`[aria-label="${label}"]`);
  if (!found) throw new Error(`área ${label} não encontrada`);
  return found;
}

function field(label: string, within?: string): HTMLInputElement {
  const labelElement = [...scope(within).querySelectorAll("label")].find(
    (item) => (item.textContent ?? "").trim() === label,
  );
  const input = labelElement?.htmlFor ? document.getElementById(labelElement.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`campo ${label} não encontrado em: ${pageText()}`);
  return input;
}

function byAriaLabel(label: string, within?: string): HTMLInputElement {
  const input = scope(within).querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!input) throw new Error(`campo ${label} não encontrado`);
  return input;
}

function checkbox(text: string, within?: string): HTMLInputElement {
  const label = [...scope(within).querySelectorAll("label")].find((item) => item.textContent?.includes(text));
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error(`caixa ${text} não encontrada`);
  return input;
}

function buttons(label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === label);
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm() {
  const form = container.querySelector("form");
  await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("EventForm da equipe continua igual", () => {
  it("sem área: campos livres, sem Pedir mudança e com Criar evento", async () => {
    await render({});
    expect(field("Nome").readOnly).toBe(false);
    expect(field("Local").readOnly).toBe(false);
    expect(buttons("Pedir mudança")).toHaveLength(0);
    expect(buttons("Voltar para rascunho")).toHaveLength(0);
    expect(buttons("Criar evento")).toHaveLength(1);
    expect(pageText()).toContain("Cortesias são emitidas pela equipe");
  });

  it("evento da equipe com vendas não trava nada", async () => {
    await render({ event: event([session(SESSION_A)]) });
    expect(field("Data e hora").readOnly).toBe(false);
    expect(byAriaLabel("Preço Inteira").readOnly).toBe(false);
    expect(checkbox("Vender Inteira").disabled).toBe(false);
    expect(buttons("Pedir mudança")).toHaveLength(0);
  });
});

describe("EventForm do organizador", () => {
  it("evento novo: salva rascunho pela ação do organizador e abre a página dele", async () => {
    await render({ area: "organizador" });
    expect(buttons("Criar evento")).toHaveLength(0);
    expect(buttons("Salvar rascunho")).toHaveLength(1);
    expect(pageText()).not.toMatch(/Abrir venda|Fechar venda/);
    expect(pageText()).toContain("Precisa de cortesias? Peça à equipe do Espaço Byla pelo WhatsApp.");

    await type(field("Nome"), "Peça Y");
    await type(field("Local"), "Espaço Byla");
    await type(field("Data e hora"), "2099-12-12T19:00");
    await type(field("Total de ingressos"), "80");
    await type(byAriaLabel("Preço Inteira"), "50,00");
    await type(byAriaLabel("Preço Meia-entrada"), "25,00");
    await submitForm();

    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.createOrganizerEvent).toHaveBeenCalledTimes(1);
    const sent = mocks.createOrganizerEvent.mock.calls[0][0];
    expect(sent).toMatchObject({ name: "Peça Y", venue: "Espaço Byla" });
    expect(JSON.stringify(sent)).not.toContain("sales_open");
    expect(mocks.push).toHaveBeenCalledWith(`/organizador/eventos/${EVENT_ID}`);
  });

  it("rascunho existente salva pela ação do organizador", async () => {
    await render({ area: "organizador", event: event([session(SESSION_A, { liveOrders: false, sold: 0 })]) });
    expect(buttons("Pedir mudança")).toHaveLength(0);
    await submitForm();
    expect(mocks.updateEvent).not.toHaveBeenCalled();
    expect(mocks.updateOrganizerEvent).toHaveBeenCalledWith(EVENT_ID, expect.objectContaining({ name: "Peça Y" }));
    expect(pageText()).toContain("Alterações salvas.");
  });

  it("aprovado: nome e local só leitura, com Pedir mudança ao lado", async () => {
    await render({
      area: "organizador",
      lockedFields: ["nome", "local"],
      event: event([session(SESSION_A, { liveOrders: false, sold: 0, lockedFields: ["nome", "local"] })]),
    });
    expect(field("Nome").readOnly).toBe(true);
    expect(field("Local").readOnly).toBe(true);
    expect(field("Data e hora").readOnly).toBe(false);
    expect(byAriaLabel("Preço Inteira").readOnly).toBe(false);
    expect(buttons("Pedir mudança")).toHaveLength(2);
    expect(buttons("Salvar alterações")).toHaveLength(1);
  });

  it("sessão única com vendas: horário, preço à venda e redução de lugares travados", async () => {
    await render({
      area: "organizador",
      lockedFields: ["nome", "local"],
      event: event([session(SESSION_A, { lockedFields: ALL_LOCKS })]),
    });
    expect(field("Data e hora").readOnly).toBe(true);
    expect(field("Término (opcional)").readOnly).toBe(true);
    const capacity = field("Total de ingressos");
    expect(capacity.readOnly).toBe(false);
    expect(capacity.min).toBe("80");
    expect(field("Quantidade de meias").readOnly).toBe(true);
    expect(byAriaLabel("Preço Inteira").readOnly).toBe(true);
    expect(byAriaLabel("Limite Meia-entrada").readOnly).toBe(true);
    expect(checkbox("Vender Inteira").disabled).toBe(true);
    expect(checkbox("Vender Casadinha").disabled).toBe(false);
    expect(buttons("Pedir mudança").length).toBeGreaterThanOrEqual(4);
  });

  it("várias sessões: só a sessão com vendas trava", async () => {
    await render({
      area: "organizador",
      lockedFields: ["nome", "local"],
      event: event([
        session(SESSION_A, { lockedFields: ALL_LOCKS }),
        session(SESSION_B, {
          startsAt: "2099-12-13T22:00:00.000Z",
          sold: 0,
          occupied: 0,
          hasOrders: false,
          liveOrders: false,
          paidOrders: 0,
          lockedFields: ["nome", "local"],
        }),
      ]),
    });
    expect(field("Início", "Sessão 1").readOnly).toBe(true);
    expect(byAriaLabel("Preço Inteira", "Sessão 1").readOnly).toBe(true);
    expect(checkbox("Inteira à venda", "Sessão 1").disabled).toBe(true);
    expect(field("Início", "Sessão 2").readOnly).toBe(false);
    expect(byAriaLabel("Preço Inteira", "Sessão 2").readOnly).toBe(false);
    expect(checkbox("Inteira à venda", "Sessão 2").disabled).toBe(false);
    expect(pageText()).toContain("Esta sessão tem vendas e não pode ser removida.");
    expect(pageText()).not.toContain("Cancelar sessão");
  });

  it("Pedir mudança abre a caixa e envia o que mudar e o motivo", async () => {
    await render({
      area: "organizador",
      lockedFields: ["nome", "local"],
      event: event([session(SESSION_A, { liveOrders: false, sold: 0, lockedFields: ["nome", "local"] })]),
    });
    await click(buttons("Pedir mudança")[1]);
    const what = container.querySelector<HTMLTextAreaElement>('textarea[name="what"]');
    const reason = container.querySelector<HTMLTextAreaElement>('textarea[name="reason"]');
    expect(what?.value).toContain("Local");
    await type(what!, "Local: Salão 2 do Espaço Byla");
    await type(reason!, "O palco do salão 2 é maior.");
    await click(buttons("Enviar pedido")[0]);

    expect(mocks.requestEventChange).toHaveBeenCalledWith(EVENT_ID, {
      what: "Local: Salão 2 do Espaço Byla",
      reason: "O palco do salão 2 é maior.",
    });
    expect(mocks.updateOrganizerEvent).not.toHaveBeenCalled();
    expect(pageText()).toContain("Pedido enviado.");
  });

  it("pedido recusado pelo servidor mostra a mensagem na caixa", async () => {
    mocks.requestEventChange.mockResolvedValue({ ok: false, error: "Escreva o motivo (de 5 a 500 caracteres)." });
    await render({
      area: "organizador",
      lockedFields: ["nome", "local"],
      event: event([session(SESSION_A, { liveOrders: false, sold: 0, lockedFields: ["nome", "local"] })]),
    });
    await click(buttons("Pedir mudança")[0]);
    await type(container.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!, "curto");
    await click(buttons("Enviar pedido")[0]);
    expect(pageText()).toContain("Escreva o motivo (de 5 a 500 caracteres).");
  });

  it("em análise: tudo só leitura e Voltar para rascunho", async () => {
    await render({
      area: "organizador",
      inReview: true,
      event: event([session(SESSION_A, { liveOrders: false, sold: 0 })]),
    });
    const fieldset = field("Nome").closest("fieldset");
    expect(fieldset?.disabled).toBe(true);
    expect(field("Data e hora").closest("fieldset[disabled]")).not.toBeNull();
    expect(buttons("Salvar alterações")).toHaveLength(0);
    expect(buttons("Pedir mudança")).toHaveLength(0);

    await click(buttons("Voltar para rascunho")[0]);
    expect(mocks.withdrawEventSubmission).toHaveBeenCalledWith(EVENT_ID);
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
