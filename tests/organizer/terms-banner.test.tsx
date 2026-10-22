// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("@/app/organizador/conta/actions", () => ({
  acceptOrganizerTermsAction: mocks.accept,
}));

import { OrganizerTermsBanner } from "@/components/organizer/OrganizerTermsBanner";

describe("OrganizerTermsBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("some na hora depois do aceite e chama refresh", async () => {
    mocks.accept.mockResolvedValue({ ok: true, data: undefined });
    await act(async () => {
      root.render(createElement(OrganizerTermsBanner));
    });
    expect(container.textContent).toContain("Li e aceito a nova versão");

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Termos do organizador atualizados");
  });

  it("mantém o aviso e mostra erro se o aceite falhar", async () => {
    mocks.accept.mockResolvedValue({ ok: false, error: "Tente de novo." });
    await act(async () => {
      root.render(createElement(OrganizerTermsBanner));
    });
    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Tente de novo.");
    expect(container.textContent).toContain("Termos do organizador atualizados");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
