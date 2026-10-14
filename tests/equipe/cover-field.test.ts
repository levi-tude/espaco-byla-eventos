// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
});

vi.mock("@/lib/media/upload-client", () => ({ uploadImage: vi.fn() }));
vi.mock("@/components/equipe/CoverCropDialog", () => ({ CoverCropDialog: () => null }));

import { CoverField } from "@/components/equipe/CoverField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWN_COVER =
  "https://proj.supabase.co/storage/v1/object/public/event-media/covers/11111111-1111-4111-8111-111111111111.webp";

let container: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: Parameters<typeof CoverField>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(CoverField, props)));
}

function buttonTexts(): string[] {
  return [...container.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
}

describe("CoverField", () => {
  it("equipe: mostra Enviar imagem e Colar link", async () => {
    await render({ defaultValue: null, onBusyChange: () => {} });
    expect(buttonTexts()).toEqual(expect.arrayContaining(["Enviar imagem", "Colar link"]));
  });

  it("equipe com capa por link abre já no campo de link", async () => {
    await render({ defaultValue: "https://exemplo.com/capa.jpg", onBusyChange: () => {} });
    expect(container.querySelector('[aria-label="Link da capa"]')).not.toBeNull();
  });

  it("sem link (organizador): só o envio de imagem, sem Colar link nem campo de link", async () => {
    await render({ allowLink: false, defaultValue: null, onBusyChange: () => {} });
    expect(buttonTexts()).not.toContain("Colar link");
    expect(buttonTexts()).not.toContain("Enviar imagem");
    expect(buttonTexts()).toContain("Escolher imagem");
    expect(container.querySelector('[aria-label="Link da capa"]')).toBeNull();
  });

  it("sem link e com capa por link já salva: não abre o campo de link", async () => {
    await render({ allowLink: false, defaultValue: "https://exemplo.com/capa.jpg", onBusyChange: () => {} });
    expect(container.querySelector('[aria-label="Link da capa"]')).toBeNull();
    expect(buttonTexts()).toEqual(expect.arrayContaining(["Trocar", "Remover"]));
  });

  it("sem link e com capa enviada: mostra a prévia normalmente", async () => {
    await render({ allowLink: false, defaultValue: OWN_COVER, onBusyChange: () => {} });
    expect(container.querySelector<HTMLInputElement>('input[name="coverImageUrl"]')?.value).toBe(OWN_COVER);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(OWN_COVER);
  });
});
