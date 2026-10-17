// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventSharePanel } from "@/components/events/EventSharePanel";
import { eventShareModel, SHARE_PENDING_MESSAGE } from "@/lib/events/share-link";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const model = eventShareModel({
  name: "Peça Y",
  slug: "peca-y",
  whenLabel: "12 de dezembro de 2099",
  approvalStatus: "aprovado",
  organizerId: null,
  deletedAt: null,
  lastSessionAt: "2099-12-12T22:00:00Z",
  appUrl: "https://espaco.example",
  now: new Date("2026-10-17T15:00:00Z"),
});

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn();

async function render(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("EventSharePanel", () => {
  it("mostra o endereço, copiar e WhatsApp; Compartilhar só quando o aparelho oferece", async () => {
    await render(createElement(EventSharePanel, { model }));
    expect(container.querySelector("input")?.value).toBe("https://espaco.example/eventos/peca-y");
    expect(container.textContent).toContain("Copiar link");
    expect(container.textContent).not.toContain("Compartilhar");
    const whatsapp = container.querySelector("a");
    expect(whatsapp?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(decodeURIComponent(whatsapp?.getAttribute("href") ?? "")).toContain(
      "Peça Y\n12 de dezembro de 2099\nhttps://espaco.example/eventos/peca-y",
    );
    expect(container.textContent).not.toContain("Compartilhar");
  });

  it("mostra Compartilhar quando o aparelho oferece", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    await render(createElement(EventSharePanel, { model }));
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Compartilhar"),
    );
    await act(async () => button?.click());
    expect(share).toHaveBeenCalledWith({
      title: "Peça Y",
      text: "Peça Y\n12 de dezembro de 2099",
      url: "https://espaco.example/eventos/peca-y",
    });
  });

  it("copiar confirma e, se a área de transferência falhar, pede para copiar à mão", async () => {
    await render(createElement(EventSharePanel, { model }));
    const copy = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Copiar link"),
    );
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith("https://espaco.example/eventos/peca-y");
    expect(container.textContent).toContain("Link copiado.");

    writeText.mockRejectedValueOnce(new Error("negado"));
    await act(async () => copy?.click());
    expect(container.textContent).toContain("Não deu para copiar sozinho.");
  });

  it("sem página pública mostra só o aviso", async () => {
    await render(
      createElement(EventSharePanel, { model: { kind: "pending", message: SHARE_PENDING_MESSAGE } }),
    );
    expect(container.textContent).toContain(SHARE_PENDING_MESSAGE);
    expect(container.querySelector("input")).toBeNull();

    await act(async () => root.render(createElement(EventSharePanel, { model: { kind: "hidden" } })));
    expect(container.textContent).toBe("");
  });
});
