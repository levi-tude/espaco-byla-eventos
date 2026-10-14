import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ areaEnabled: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/brand/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/lib/organizer/settings", () => ({ organizerAreaEnabled: mocks.areaEnabled }));

import OrganizerTermsPage from "@/app/termos-organizador/page";
import { OrganizerTermsText } from "@/components/legal/OrganizerTermsText";
import { formatMoney } from "@/lib/domain/service-fee";
import {
  ORGANIZER_TERMS_PATH,
  ORGANIZER_TERMS_UPDATED_LABEL,
  ORGANIZER_TERMS_VERSION,
} from "@/lib/legal/organizer-terms";
import { COMPANY } from "@/lib/legal/privacy";
import { TERMS_SERVICE_FEE } from "@/lib/legal/terms";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await OrganizerTermsPage());
}

const ITEMS = [
  "1. Quem somos",
  "2. Sua conta",
  "3. Como o evento vai ao ar",
  "4. Eventos que não aceitamos",
  "5. Ingressos e regras para quem compra",
  "6. Dinheiro: o que você recebe",
  "7. Repasse",
  "8. Estornos, contestações e cancelamentos",
  "9. Dados dos compradores (LGPD)",
  "10. Portaria",
  "11. Suas responsabilidades",
  "12. Responsabilidades do Espaço Byla",
  "13. Excluir um evento",
  "14. Suspensão e encerramento",
  "15. Mudanças nestes termos",
  "16. Foro",
];

beforeEach(() => {
  mocks.areaEnabled.mockReset();
  mocks.areaEnabled.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("página Termos do organizador", () => {
  it("com a área de organizadores desligada responde 404", async () => {
    mocks.areaEnabled.mockResolvedValue(false);
    await expect(OrganizerTermsPage()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("fica em /termos-organizador, com versão em formato de data e data de atualização no topo", async () => {
    expect(ORGANIZER_TERMS_PATH).toBe("/termos-organizador");
    expect(ORGANIZER_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const page = text(await renderPage());
    expect(page).toContain("Termos do organizador");
    expect(page).toContain(`Atualizados em ${ORGANIZER_TERMS_UPDATED_LABEL}`);
  });

  it("traz os 16 itens, em ordem", async () => {
    const page = text(await renderPage());
    let last = -1;
    for (const item of ITEMS) {
      const at = page.indexOf(item);
      expect(at, item).toBeGreaterThan(last);
      last = at;
    }
  });

  it("identifica o Espaço Byla com os dados da empresa e o contato configurado", async () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "contato@exemplo.test");
    const html = await renderPage();
    const page = text(html);
    expect(page).toContain(COMPANY.legalName);
    expect(page).toContain(COMPANY.cnpj);
    expect(page).toContain(COMPANY.address);
    expect(html).toContain('href="mailto:contato@exemplo.test"');
  });

  it("sem e-mail de contato configurado usa um texto neutro", async () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
    const html = await renderPage();
    expect(html).not.toContain("mailto:");
    expect(text(html)).toContain("os canais oficiais de atendimento do Espaço Byla");
  });

  it("taxa de serviço vem da mesma constante dos Termos de compra e não sai da parte do organizador", async () => {
    const page = text(await renderPage());
    const percent = TERMS_SERVICE_FEE.rateBps / 100;
    const min = formatMoney(TERMS_SERVICE_FEE.minCents).replace(/\s/g, " ");
    expect(page).toContain(`taxa de serviço (${percent}% por item, mínimo ${min})`);
    expect(page).toContain("num pagamento de R$ 52,50, sendo R$ 50,00 de ingresso e R$ 2,50 de taxa de serviço");
    expect(page).toContain("não sai da sua parte");
    expect(page).toContain("não cobra comissão");
    expect(page).toContain("tarifa em cada pagamento");
  });

  it("item 2: verificação em duas etapas por código no e-mail, sem aplicativo", async () => {
    const page = text(await renderPage());
    expect(page).toContain(
      "A verificação em duas etapas é obrigatória: ao entrar num aparelho novo, enviamos um código ao seu e-mail.",
    );
    expect(page).toContain("No cadastro, confirmamos o seu e-mail com um código.");
    expect(page.toLowerCase()).not.toContain("aplicativo");
    expect(page.toLowerCase()).not.toContain("autenticador");
  });

  it("item 3: nome e local (decisão 2A) dependem de nova confirmação depois de aprovado", async () => {
    const page = text(await renderPage());
    expect(page).toContain(
      "Depois de aprovado, algumas mudanças (nome, local, preço de sessão já vendida, redução de lugares, troca de horário, cancelamento de sessão) dependem de nova confirmação do Espaço Byla",
    );
  });

  it("traz as regras de repasse, devolução, dados dos compradores e foro do rascunho", async () => {
    const page = text(await renderPage());
    expect(page).toContain("em até 5 dias úteis");
    expect(page).toContain("o Dois de Julho");
    expect(page).toContain("Sua parte = valor dos ingressos vendidos − estornos − contestações no cartão − tarifas do banco.");
    expect(page).toContain("você devolve o valor por PIX ao Espaço Byla em até 10 dias depois do aviso");
    expect(page).toContain("apague em até 90 dias depois do evento");
    expect(page).toContain("avise o Espaço Byla em até 24 horas");
    expect(page).toContain("Cortesias");
    expect(page).toContain("Fica eleito o foro de Salvador – BA.");
  });

  it("não cita fornecedores nem deixa marcações de rascunho", async () => {
    const page = text(await renderPage()).toLowerCase();
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
      expect(page).not.toContain(word);
    }
  });

  it("liga para a Política de Privacidade e os Termos de compra", async () => {
    const html = await renderPage();
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain('href="/termos"');
  });
});

describe("OrganizerTermsText", () => {
  it("renderiza sozinho o texto completo (usado também no cadastro)", () => {
    const page = text(renderToStaticMarkup(createElement(OrganizerTermsText)));
    for (const item of ITEMS) expect(page).toContain(item);
    expect(page).toContain(`Atualizados em ${ORGANIZER_TERMS_UPDATED_LABEL}`);
  });
});
