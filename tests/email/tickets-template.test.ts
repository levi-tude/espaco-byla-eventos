import { describe, expect, it } from "vitest";

import { buildTicketsEmail } from "@/lib/email/tickets-template";

const ticket = (n: number) => ({
  holderName: "Maria Souza",
  kindLabel: n === 1 ? "Inteira" : "Meia-entrada",
  code: `CODIGO-${n}`,
  qrContentId: `ingresso-${n}`,
});

const base = {
  buyerName: "Maria Souza",
  eventName: "Noite de Forró",
  venue: "Espaço Byla",
  startsAt: "2026-10-10T22:00:00.000Z",
  orderNumber: "A1B2C3D4",
  tickets: [ticket(1), ticket(2)],
  ticketUrl: "https://exemplo.test/pedidos/abc123",
};

describe("buildTicketsEmail", () => {
  it("monta assunto com a data da sessão, detalhes e link dos ingressos", () => {
    const email = buildTicketsEmail(base);

    expect(email.subject).toBe("Seus ingressos — Noite de Forró · sáb 10/10 às 19h00");
    expect(email.html).toContain("Olá, Maria!");
    expect(email.html).toContain("2 ingressos");
    expect(email.html).toContain("Sábado, 10 de outubro de 2026 · 19h00");
    expect(email.html).toContain('href="https://exemplo.test/pedidos/abc123"');
    expect(email.text).toContain("Onde: Espaço Byla");
    expect(email.text).toContain("https://exemplo.test/pedidos/abc123");
  });

  it("mostra o número do pedido uma vez no topo, nunca o token", () => {
    const email = buildTicketsEmail(base);
    expect(email.html.match(/A1B2C3D4/g)).toHaveLength(1);
    expect(email.text).toContain("Pedido nº A1B2C3D4");
    expect(email.html).not.toContain(">abc123<");
  });

  it("sessão única sem nome: nenhuma palavra “Sessão” sobra sozinha", () => {
    const email = buildTicketsEmail(base);
    expect(email.html).not.toContain("Sessão");
    expect(email.text).not.toContain("Sessão");
  });

  it("sessão com nome e término aparece no topo e em cada ingresso", () => {
    const email = buildTicketsEmail({
      ...base,
      sessionName: "Sessão infantil",
      startsAt: "2026-10-10T19:00:00.000Z",
      endsAt: "2026-10-10T20:30:00.000Z",
    });
    expect(email.text).toContain("Sessão: Sessão infantil");
    expect(email.text).toContain("Quando: Sábado, 10 de outubro de 2026 · 16h00 – 17h30");
    expect(email.html.match(/Sábado, 10 de outubro de 2026 · 16h00 – 17h30/g)).toHaveLength(3);
    expect(email.html.match(/Sessão infantil/g)).toHaveLength(3);
  });

  it("mostra o QR e o código manual de cada ingresso", () => {
    const email = buildTicketsEmail(base);

    expect(email.html).toContain('src="cid:ingresso-1"');
    expect(email.html).toContain('src="cid:ingresso-2"');
    expect(email.html).toContain("Ingresso 2 de 2");
    expect(email.html).toContain("CODIGO-1");
    expect(email.html).toContain("Meia-entrada");
    expect(email.text).toContain("Ingresso 2 de 2: Maria Souza (Meia-entrada) — código CODIGO-2");
  });

  it("usa singular para um ingresso", () => {
    const email = buildTicketsEmail({ ...base, tickets: [ticket(1)] });
    expect(email.html).toContain("1 ingresso<");
    expect(email.html).toContain("Seu ingresso");
    expect(email.html).not.toContain("de 1<");
  });

  const summary = {
    items: [
      { name: "Inteira", quantity: 2, lineTotalCents: 10000 },
      { name: "Meia-entrada", quantity: 1, lineTotalCents: 2500 },
    ],
    feeCents: 625,
    totalCents: 13125,
  };

  it("mostra o resumo do pedido com itens, taxa de serviço e total pago", () => {
    const email = buildTicketsEmail({ ...base, summary });
    expect(email.html).toContain("Resumo do pedido");
    expect(email.html).toContain("2× Inteira");
    expect(email.html).toContain("Taxa de serviço");
    expect(email.html).toMatch(/Total pago<\/td>[\s\S]*R\$\s131,25/);
    expect(email.text).toContain("Resumo do pedido:");
    expect(email.text).toMatch(/- 2× Inteira: R\$\s100,00/);
    expect(email.text).toMatch(/- 1× Meia-entrada: R\$\s25,00/);
    expect(email.text).toMatch(/- Taxa de serviço: R\$\s6,25/);
    expect(email.text).toMatch(/Total pago: R\$\s131,25/);
  });

  it("pedido sem taxa: resumo sem a linha de taxa", () => {
    const email = buildTicketsEmail({
      ...base,
      summary: { ...summary, feeCents: 0, totalCents: 12500 },
    });
    expect(email.text).toMatch(/Total pago: R\$\s125,00/);
    for (const content of [email.html, email.text]) expect(content).not.toMatch(/taxa/i);
  });

  it.each([
    ["cortesia (total 0)", { items: [{ name: "Cortesia", quantity: 1, lineTotalCents: 0 }], feeCents: 0, totalCents: 0 }],
    ["sem dados", null],
  ])("%s: sem bloco de resumo", (_caso, value) => {
    const email = buildTicketsEmail({ ...base, summary: value });
    for (const content of [email.html, email.text]) {
      expect(content).not.toContain("Resumo do pedido");
      expect(content).not.toContain("Total pago");
    }
  });

  it("escapa o nome dos itens no resumo", () => {
    const email = buildTicketsEmail({
      ...base,
      summary: { ...summary, items: [{ name: "<b>VIP</b>", quantity: 1, lineTotalCents: 13125 }] },
    });
    expect(email.html).not.toContain("<b>VIP</b>");
    expect(email.html).toContain("&lt;b&gt;VIP&lt;/b&gt;");
  });

  it("escapa HTML vindo dos dados do pedido", () => {
    const email = buildTicketsEmail({
      ...base,
      buyerName: "<script>x</script>",
      eventName: 'Show "A&B"',
      sessionName: "<b>Sessão</b>",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>Sessão</b>");
    expect(email.html).toContain("Show &quot;A&amp;B&quot;");
  });
});
