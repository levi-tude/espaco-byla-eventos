import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { MeiaEntradaInfo } from "@/components/public/MeiaEntradaInfo";
import { MEIA_ENTRADA_TERMS_HREF } from "@/lib/legal/terms";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
}

describe("MeiaEntradaInfo", () => {
  it("traz as regras genéricas e o link para os termos", () => {
    const html = renderToStaticMarkup(createElement(MeiaEntradaInfo));
    const page = text(html);
    expect(page).toContain("Meia-entrada");
    expect(page).toContain("A meia é metade da inteira e não se soma a outras promoções");
    expect(page).toContain("com a CIE ou com a carteira de estudante oficial da Bahia");
    expect(page).toContain("1 acompanhante, quando necessário");
    expect(page).toContain("60 anos ou mais");
    expect(page).toContain("Professores e profissionais da educação");
    expect(page).toContain("contracheque ou crachá funcional + RG");
    expect(page).toContain("Regras para crianças, quando houver, estão na descrição de cada evento");
    expect(page).toContain("Leve o comprovante e um documento com foto");
    expect(page).toContain("não entra e não há reembolso");
    expect(page).not.toContain("ID Jovem");
    expect(page).not.toContain("jovens de 15 a 29");
    expect(page).not.toContain("CadÚnico");
    expect(page).toContain("Ver regras completas nos Termos de compra");
    expect(html).toContain(`href="${MEIA_ENTRADA_TERMS_HREF}"`);
    expect(MEIA_ENTRADA_TERMS_HREF).toBe("/termos#meia-entrada");
  });

  it("não inclui regras específicas de um espetáculo", () => {
    const page = text(renderToStaticMarkup(createElement(MeiaEntradaInfo)));
    expect(page).not.toContain("Cápsulas");
    expect(page).not.toMatch(/5 a 10/);
    expect(page).not.toContain("menores de 5");
  });
});
