import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/BrandMark", () => ({ BrandMark: () => null }));

import { EventEndedNotice } from "@/components/public/EventEndedNotice";
import { type PastEventCard, PastEventsSection } from "@/components/public/PastEventsSection";

const card: PastEventCard = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "show-de-outubro",
  name: "Show de outubro",
  venue: "Espaço Byla",
  coverImageUrl: "https://exemplo.supabase.co/storage/v1/object/public/event-media/capa.jpg",
  dateLabel: "10 de outubro de 2026",
};

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#xa0;|\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

describe("PastEventsSection", () => {
  it("não mostra nada sem eventos", () => {
    expect(
      renderToStaticMarkup(createElement(PastEventsSection, { events: [], nextLimit: null })),
    ).toBe("");
  });

  it("mostra título, card com data, local e link, sem preço", () => {
    const html = renderToStaticMarkup(
      createElement(PastEventsSection, { events: [card], nextLimit: null }),
    );
    expect(html).toContain('id="eventos-passados"');
    const page = text(html);
    expect(page).toContain("Eventos passados");
    expect(page).toContain("Show de outubro");
    expect(page).toContain("10 de outubro de 2026");
    expect(page).toContain("Espaço Byla");
    expect(html).toContain('href="/eventos/show-de-outubro"');
    expect(page).not.toMatch(/R\$|A partir de|Esgotado/);
    expect(page).not.toContain("Ver mais");
  });

  it("Ver mais leva ao próximo limite sem JavaScript", () => {
    const html = renderToStaticMarkup(
      createElement(PastEventsSection, { events: [card], nextLimit: 24 }),
    );
    expect(html).toContain('href="/?passados=24#eventos-passados"');
    expect(text(html)).toContain("Ver mais");
  });
});

describe("EventEndedNotice", () => {
  it("avisa que acabou, mostra a data e leva aos próximos eventos", () => {
    const html = renderToStaticMarkup(
      createElement(EventEndedNotice, { whenLabel: "10 de outubro de 2026" }),
    );
    const page = text(html);
    expect(page).toContain("Evento encerrado");
    expect(page).toContain("Este evento já aconteceu.");
    expect(page).toContain("10 de outubro de 2026");
    expect(html).toContain('href="/"');
    expect(page).toContain("Ver próximos eventos");
    expect(page).not.toContain("Comprar");
  });

  it("sem data, mostra só o aviso", () => {
    const page = text(renderToStaticMarkup(createElement(EventEndedNotice, { whenLabel: "" })));
    expect(page).toContain("Este evento já aconteceu.");
  });
});
