// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  deleteOwnEvent: vi.fn(),
  requestEventDeletion: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock("@/app/organizador/eventos/actions", () => ({
  deleteOwnEvent: mocks.deleteOwnEvent,
  requestEventDeletion: mocks.requestEventDeletion,
}));

import { DeleteEventSection } from "@/components/organizer/DeleteEventSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_ID = "00000000-0000-4000-8000-000000000001";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!found) throw new Error(`botão ${label} não encontrado`);
  return found;
}

async function tryDelete() {
  await act(async () =>
    root.render(
      createElement(DeleteEventSection, { eventId: EVENT_ID, eventName: "Peça Y", hasSales: false, deletionPending: false }),
    ),
  );
  await act(async () => button("Excluir evento").click());
  const input = container.querySelector<HTMLInputElement>('input[name="confirmar-nome"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Peça Y");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = container.querySelector("form")!;
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("DeleteEventSection", () => {
  it("venda começou depois de abrir a página: atualiza para mostrar “Pedir exclusão”", async () => {
    mocks.deleteOwnEvent.mockResolvedValue({ ok: false, error: "Este evento já teve vendas. Use “Pedir exclusão”." });
    await tryDelete();
    expect(mocks.deleteOwnEvent).toHaveBeenCalledWith(EVENT_ID, "Peça Y");
    expect(container.textContent).toContain("Este evento já teve vendas. Use “Pedir exclusão”.");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("outro erro só mostra a mensagem, sem atualizar", async () => {
    mocks.deleteOwnEvent.mockResolvedValue({
      ok: false,
      error: "O nome digitado não confere. Digite o nome do evento como aparece na tela.",
    });
    await tryDelete();
    expect(container.textContent).toContain("O nome digitado não confere.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
