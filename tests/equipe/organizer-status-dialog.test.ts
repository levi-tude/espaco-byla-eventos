// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setOrganizerStatus: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/equipe/organizadores/actions", () => ({
  archiveSignupRequest: vi.fn(),
  createInvite: vi.fn(),
  createPasswordResetLink: vi.fn(),
  forgetAccountDevices: vi.fn(),
  revokeInvite: vi.fn(),
  setOrganizerStatus: mocks.setOrganizerStatus,
}));

import { AccountActions } from "@/app/equipe/organizadores/OrganizerAdminControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ERROR = "Não foi possível mudar a situação da conta. Tente de novo.";

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

describe("AccountActions: janela de suspender", () => {
  it("erro some ao fechar a janela e não volta ao abrir de novo", async () => {
    mocks.setOrganizerStatus.mockResolvedValue({ ok: false, error: ERROR });
    await act(async () =>
      root.render(
        createElement(AccountActions, { userId: USER_ID, publicName: "Produtora Teste", status: "ativo", devicesCount: 0 }),
      ),
    );

    await act(async () => button("Suspender").click());
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Motivo suficiente");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.setOrganizerStatus).toHaveBeenCalledWith(USER_ID, "suspenso", "Motivo suficiente");
    expect(container.textContent).toContain(ERROR);

    await act(async () => button("Voltar").click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).not.toContain(ERROR);

    await act(async () => button("Suspender").click());
    expect(container.querySelector("dialog")).not.toBeNull();
    expect(container.textContent).not.toContain(ERROR);
  });
});
