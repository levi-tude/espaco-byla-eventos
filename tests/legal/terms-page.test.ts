import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/PublicSiteHeader", () => ({ PublicSiteHeader: () => null }));
vi.mock("@/lib/organizer/public-nav", () => ({
  organizerAreaPublicHref: async () => "/organizador/entrar",
}));
vi.mock("@/lib/organizer/settings", () => ({ organizerAreaEnabled: async () => false }));

import TermsPage from "@/app/termos/page";
import { SiteFooter } from "@/components/brand/SiteFooter";
import { COMPANY } from "@/lib/legal/privacy";
import {
  INSTALLMENT_INTEREST_NOTE,
  MEIA_ENTRADA_SECTION_ID,
  TERMS_PATH,
  TERMS_UPDATED_LABEL,
  TERMS_VERSION,
} from "@/lib/legal/terms";

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
      "Transferência do ingresso",
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
    expect(page).toContain(
      "taxa de serviço de 10%, com 4% de desconto no total para pagamento via Pix",
    );
    expect(page).not.toMatch(/5,56%/);
    expect(page).not.toContain("mínimo de R$ 1,00");
    expect(page).toContain("Ingressos de cortesia não têm taxa");
    expect(page).toContain("devolve 100% do valor pago");
    const payment = page.indexOf("Compra e pagamento");
    const note = page.indexOf(INSTALLMENT_INTEREST_NOTE);
    expect(note).toBeGreaterThan(payment);
  });

  it("aplica as decisões do dono de 2026-10-07", () => {
    const page = text(renderToStaticMarkup(TermsPage()));
    expect(page).toContain(
      "até 7 dias corridos depois de comprar, desde que o pedido de desistência seja feito com pelo menos 48 horas de antecedência do início da sessão",
    );
    expect(page).toContain("100% do valor pago, incluindo a taxa de serviço");
    expect(page).toContain("Pedidos com algum ingresso já usado na entrada não podem ser reembolsados");
    expect(page).toContain("reembolso de 100% (com a taxa) até 24 horas antes do novo horário");
    expect(page).toContain("Se não pagar, não entra e não há reembolso");
    expect(page).toContain("segue a lei");
    expect(page).not.toMatch(/\d+\s*% dos ingressos/);
    expect(page).toContain("não há garantia de reembolso");
    expect(page).toContain("a equipe analisa caso a caso");
    expect(page).toContain("O ingresso não é nominal: entra quem apresentar o QR Code primeiro");
    expect(page).toContain("pode passar o ingresso para outra pessoa");
  });

  it("versão nova: Quem vende explica os eventos de organizadores parceiros", () => {
    expect(TERMS_VERSION > "2026-10-07").toBe(true);
    const page = text(renderToStaticMarkup(TermsPage()));
    const seller = page.indexOf("Quem vende");
    const partners = page.indexOf(
      "Alguns eventos são produzidos por organizadores parceiros, indicados como “Produção” na página do evento e no e-mail do ingresso. Mesmo nesses casos, a venda, o pagamento, o atendimento e os reembolsos são feitos pela ACDH Eventos, conforme estes termos.",
    );
    expect(partners).toBeGreaterThan(seller);
    expect(partners).toBeLessThan(page.indexOf("Compra e pagamento"));
  });

  it("identifica quem vende com os mesmos dados da Política de Privacidade", () => {
    const page = text(renderToStaticMarkup(TermsPage()));
    expect(page).toContain(COMPANY.legalName);
    expect(page).toContain(COMPANY.cnpj);
  });

  it("não cita fornecedores nem deixa marcações de rascunho", () => {
    const page = text(renderToStaticMarkup(TermsPage())).toLowerCase();
    for (const word of ["mercado pago", "mercadopago", "supabase", "vercel", "resend", "google", "cloudflare", "todo:", "xxx", "a definir", "pendente"]) {
      expect(page).not.toContain(word);
    }
  });

  it("traz o texto vigente da meia-entrada, com CIE, carteira oficial da Bahia e professores", () => {
    const html = renderToStaticMarkup(TermsPage());
    const page = text(html);
    expect(html).toContain(`id="${MEIA_ENTRADA_SECTION_ID}"`);
    expect(MEIA_ENTRADA_SECTION_ID).toBe("meia-entrada");
    expect(page).toContain("Estudantes do ensino fundamental, médio ou superior, com a CIE ou com a carteira de estudante oficial da Bahia");
    expect(page).toContain("Pessoas com deficiência e 1 acompanhante, quando necessário");
    expect(page).toContain("Pessoas com 60 anos ou mais, com RG");
    expect(page).toContain("Professores e profissionais da educação, de escola pública ou privada, na ativa ou aposentados, com contracheque ou crachá funcional + RG");
    expect(page).toContain("Regras para crianças, quando houver, estão na descrição de cada evento");
    expect(page).toContain("Na entrada: leve o comprovante e um documento com foto");
    expect(page).toContain("A meia é metade da inteira e não se soma a outras promoções");
    expect(page).toContain("Lei nº 12.933/2013");
    expect(page).toContain("Decreto nº 8.537/2015");
    expect(page).toContain("Lei nº 10.741/2003");
    expect(page).toContain("Lei estadual da Bahia nº 10.029/2006");
    expect(page).toContain("Lei estadual da Bahia nº 14.765/2024");
    expect(page).toContain("Lei municipal de Salvador nº 9.763/2023");
    expect(page).not.toContain("ID Jovem");
    expect(page).not.toContain("jovens de 15 a 29");
    expect(page).not.toContain("CadÚnico");
    expect(page).not.toContain("não valem boleto");
  });

  it("usa o e-mail de contato configurado e, sem ele, um texto neutro", () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "contato@exemplo.test");
    expect(renderToStaticMarkup(TermsPage())).toContain('href="mailto:contato@exemplo.test"');

    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
    const html = renderToStaticMarkup(TermsPage());
    expect(html).not.toContain("mailto:");
    expect(text(html)).toContain("os canais oficiais de atendimento da ACDH Eventos");
  });
});

describe("rodapé", () => {
  it("leva aos Termos de compra e à Política de Privacidade", async () => {
    const html = renderToStaticMarkup(await SiteFooter());
    expect(html).toContain(`href="${TERMS_PATH}"`);
    expect(html).toContain('href="/privacidade"');
    expect(text(html)).toContain("Termos de compra");
    expect(text(html)).toContain("Política de Privacidade");
  });
});

