import { describe, expect, it } from "vitest";

import { buildTicketsEmail } from "@/lib/email/tickets-template";

const base = {
  buyerName: "Maria Souza",
  eventName: "Noite de Forró",
  venue: "Espaço Byla",
  startsAt: "2026-10-10T23:00:00.000Z",
  ticketCount: 2,
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
    expect(email.text).toContain("Ver meus ingressos: https://exemplo.test/pedidos/abc123");
    expect(email.text).toContain("Onde: Espaço Byla");
  });

  it("usa singular para um ingresso", () => {
    const email = buildTicketsEmail({ ...base, ticketCount: 1 });
    expect(email.html).toContain("1 ingresso<");
    expect(email.text).toContain("Quantidade: 1 ingresso\n");
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
