import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/SiteHeader", () => ({ SiteHeader: () => null }));

import TermsPage from "@/app/termos/page";
import { SiteFooter } from "@/components/brand/SiteFooter";
import { COMPANY } from "@/lib/legal/privacy";
import { TERMS_PATH, TERMS_UPDATED_LABEL, TERMS_VERSION } from "@/lib/legal/terms";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
}

afterEach(() => vi.unstubAllEnvs());

describe("página Termos de compra", () => {
  it("tem a versão em formato de data e a data de atualização no topo", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(text(renderToStaticMarkup(TermsPage()))).toContain(`Atualizados em ${TERMS_UPDATED_LABEL}`);
  });

  it("traz todas as seções combinadas", () => {
    const page = text(renderToStaticMarkup(TermsPage()));
    for (const title of [
      "Quem vende",
      "Compra e pagamento",
      "Taxa de serviço",
      "Ingressos e entrada",
      "Meia-entrada",
      "Sessões, troca de horário e cancelamento",
      "Desistência e reembolsos",
      "Contestação no cartão",
      "Contato",
    ]) {
      expect(page).toContain(title);
    }
  });

  it("reflete as regras vigentes de compra, taxa e reembolso", () => {
    const page = text(renderToStaticMarkup(TermsPage()));
    expect(page).toContain("até 10 pessoas");
    expect(page).toContain("reservados por 15 minutos");
    expect(page).toContain("encerram 5 minutos depois");
    expect(page).toMatch(/taxa de serviço de 5% do preço/);
    expect(page).toContain("mínimo de R$ 1,00");
    expect(page).toContain("Ingressos de cortesia não têm taxa");
    expect(page).toContain("até 7 dias corridos depois de comprar");
    expect(page).toContain("48 horas de antecedência");
    expect(page).toContain("Pelo menos 40% dos ingressos");
    expect(page).toContain("devolve 100% do valor pago");
  });

  it("identifica quem vende com os mesmos dados da Política de Privacidade", () => {
    const page = text(renderToStaticMarkup(TermsPage()));
    expect(page).toContain(COMPANY.legalName);
    expect(page).toContain(COMPANY.cnpj);
  });

  it("não cita fornecedores nem deixa marcações de rascunho", () => {
    const page = text(renderToStaticMarkup(TermsPage())).toLowerCase();
    for (const word of ["mercado pago", "mercadopago", "supabase", "vercel", "resend", "todo:", "xxx", "a definir", "pendente"]) {
      expect(page).not.toContain(word);
    }
  });

  it("usa o e-mail de contato configurado e, sem ele, um texto neutro", () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "contato@exemplo.test");
    expect(renderToStaticMarkup(TermsPage())).toContain('href="mailto:contato@exemplo.test"');

    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
    const html = renderToStaticMarkup(TermsPage());
    expect(html).not.toContain("mailto:");
    expect(text(html)).toContain("os canais oficiais de atendimento do Espaço Byla");
  });
});

describe("rodapé", () => {
  it("leva aos Termos de compra e à Política de Privacidade", () => {
    const html = renderToStaticMarkup(SiteFooter());
    expect(html).toContain(`href="${TERMS_PATH}"`);
    expect(html).toContain('href="/privacidade"');
    expect(text(html)).toContain("Termos de compra");
    expect(text(html)).toContain("Política de Privacidade");
  });
});
