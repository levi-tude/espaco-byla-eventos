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
  startsAt: "2026-10-10T23:00:00.000Z",
  tickets: [ticket(1), ticket(2)],
  ticketUrl: "https://exemplo.test/pedidos/abc123",
};

describe("buildTicketsEmail", () => {
  it("monta assunto, detalhes do evento e link dos ingressos", () => {
    const email = buildTicketsEmail(base);

    expect(email.subject).toBe("Seus ingressos — Noite de Forró");
    expect(email.html).toContain("Olá, Maria!");
    expect(email.html).toContain("2 ingressos");
    expect(email.html).toContain("20:00");
    expect(email.html).toContain('href="https://exemplo.test/pedidos/abc123"');
    expect(email.text).toContain("Onde: Espaço Byla");
    expect(email.text).toContain("https://exemplo.test/pedidos/abc123");
  });

  it("mostra o QR e o código manual de cada ingresso", () => {
    const email = buildTicketsEmail(base);

    expect(email.html).toContain('src="cid:ingresso-1"');
    expect(email.html).toContain('src="cid:ingresso-2"');
    expect(email.html).toContain("Ingresso 2 de 2");
    expect(email.html).toContain("CODIGO-1");
    expect(email.html).toContain("Meia-entrada");
    expect(email.text).toContain("Ingresso 2: Maria Souza (Meia-entrada) — código CODIGO-2");
  });

  it("usa singular para um ingresso", () => {
    const email = buildTicketsEmail({ ...base, tickets: [ticket(1)] });
    expect(email.html).toContain("1 ingresso<");
    expect(email.html).toContain("Seu ingresso");
    expect(email.html).not.toContain("de 1");
  });

  it("escapa HTML vindo dos dados do pedido", () => {
    const email = buildTicketsEmail({
      ...base,
      buyerName: "<script>x</script>",
      eventName: 'Show "A&B"',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Show &quot;A&amp;B&quot;");
  });
});
