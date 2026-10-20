import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/SiteHeader", () => ({ SiteHeader: () => null }));

import PrivacyPage from "@/app/privacidade/page";
import {
  COMPANY,
  DATA_RETENTION_YEARS,
  PRIVACY_POLICY_UPDATED_LABEL,
  PRIVACY_POLICY_VERSION,
} from "@/lib/legal/privacy";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:])/g, "$1");
}

function page(): string {
  return text(renderToStaticMarkup(PrivacyPage()));
}

afterEach(() => vi.unstubAllEnvs());

describe("página Política de Privacidade", () => {
  it("tem versão nova em formato de data e a data de atualização no topo", () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRIVACY_POLICY_VERSION > "2026-10-03").toBe(true);
    expect(page()).toContain(`Atualizada em ${PRIVACY_POLICY_UPDATED_LABEL}`);
  });

  it("introdução cobre compra, pedido para fazer evento e conta de organizador", () => {
    expect(page()).toContain(
      "quando você compra ingressos por este site, pede para fazer um evento ou usa uma conta de organizador",
    );
  });

  it("lista os dados do pedido para fazer evento e da conta de organizador", () => {
    const content = page();
    expect(content).toContain(
      "No pedido para fazer um evento: nome, contato (WhatsApp ou e-mail) e a ideia do evento.",
    );
    expect(content).toContain(
      "Na conta de organizador: nome, nome público, e-mail (confirmado por código), telefone, chave PIX, nome e CPF ou CNPJ do titular da chave e registros de acesso, usados para a conta, a segurança, o pagamento do organizador e obrigações fiscais e contábeis. O nome público aparece na página dos eventos do organizador.",
    );
  });

  it("explica o que o organizador do evento recebe, logo depois do banco", () => {
    const content = page();
    const bank = content.indexOf("o banco responsável por processar o pagamento");
    const organizer = content.indexOf("o organizador do evento, quando o evento for produzido por um organizador parceiro");
    expect(bank).toBeGreaterThan(-1);
    expect(organizer).toBeGreaterThan(bank);
    expect(content).toContain(
      "apenas o seu nome, o seu e-mail e a situação do seu pedido e dos ingressos (inclusive se já foram usados na entrada), para a operação daquele evento",
    );
    expect(content).toContain("a não enviar propaganda e a apagá-los depois do evento");
    expect(content).toContain("Telefone, CPF e dados de pagamento nunca são compartilhados com o organizador.");
  });

  it("diz para que usa os dados de organizadores", () => {
    expect(page()).toContain(
      "Analisar pedidos para fazer eventos e administrar as contas de organizadores, inclusive o pagamento da parte deles.",
    );
  });

  it("traz os prazos de guarda de pedidos para fazer evento e de contas de organizador", () => {
    const content = page();
    expect(content).toContain("Pedidos para fazer evento são apagados até 6 meses depois de respondidos.");
    expect(content).toContain(
      `Dados da conta de organizador ficam guardados por até ${DATA_RETENTION_YEARS} anos depois do fim da parceria, para obrigações fiscais e contábeis.`,
    );
  });

  it("segurança: acesso restrito à equipe e aos organizadores, sempre com verificação em duas etapas", () => {
    expect(page()).toContain(
      `acesso restrito à equipe da ${COMPANY.brand} e, para os próprios eventos, aos organizadores parceiros, sempre com verificação em duas etapas`,
    );
  });

  it("cookies: explica a sessão de login e o lembrar este aparelho de quem tem conta", () => {
    expect(page()).toContain(
      "Para quem entra com login (conta da equipe ou de organizador), o site também guarda a sessão de acesso e, se a pessoa escolher, o cookie de “lembrar este aparelho” por 30 dias.",
    );
  });

  it("identifica o responsável com os dados da empresa", () => {
    const content = page();
    expect(content).toContain(COMPANY.legalName);
    expect(content).toContain(COMPANY.cnpj);
  });

  it("não cita fornecedores nem deixa marcações de rascunho", () => {
    const content = page().toLowerCase();
    for (const word of [
      "mercado pago",
      "mercadopago",
      "supabase",
      "resend",
      "google",
      "cloudflare",
      "vercel",
      "todo:",
      "xxx",
      "a definir",
      "{",
      "}",
    ]) {
      expect(content).not.toContain(word);
    }
  });

  it("usa o e-mail de contato configurado e, sem ele, um texto neutro", () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "contato@exemplo.test");
    expect(renderToStaticMarkup(PrivacyPage())).toContain('href="mailto:contato@exemplo.test"');

    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
    const html = renderToStaticMarkup(PrivacyPage());
    expect(html).not.toContain("mailto:");
    expect(text(html)).toContain("os canais oficiais de atendimento da ACDH Eventos");
  });
});
