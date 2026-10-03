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
