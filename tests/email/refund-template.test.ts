import { describe, expect, it } from "vitest";

import { buildRefundEmail } from "@/lib/email/refund-template";

const base = {
  buyerName: "Maria Souza",
  eventName: "Noite de Forró",
  startsAt: "2026-10-10T23:00:00.000Z",
  amountCents: 7500,
  tickets: [
    { holderName: "Maria Souza", kindLabel: "Inteira" },
    { holderName: "Maria Souza", kindLabel: "Meia-entrada" },
  ],
  orderUrl: "https://exemplo.test/pedidos/abc123",
};

describe("buildRefundEmail", () => {
  it("informa evento, valor devolvido, ingressos cancelados e prazos", () => {
    const email = buildRefundEmail(base);

    expect(email.subject).toBe("Seu pedido foi estornado — Noite de Forró");
    expect(email.text).toContain("Olá, Maria!");
    expect(email.text).toMatch(/R\$\s75,00/);
    expect(email.text).toContain("100% do pedido");
    expect(email.text).toContain("Ingressos cancelados (2 ingressos)");
    expect(email.text).toContain("Meia-entrada");
    expect(email.text).toContain("em até 2 faturas");
    expect(email.text).toContain("conta de origem");
    expect(email.html).toContain('href="https://exemplo.test/pedidos/abc123"');
  });

  it("sem taxa no pedido, não menciona taxa de serviço", () => {
    const email = buildRefundEmail({ ...base, serviceFeeCents: 0 });
    expect(email.text).toContain("(100% do pedido), para o mesmo meio");
    for (const content of [email.html, email.text]) expect(content).not.toMatch(/taxa/i);
  });

  it("com taxa no pedido, deixa claro que ela também foi devolvida", () => {
    const email = buildRefundEmail({ ...base, amountCents: 7875, serviceFeeCents: 375 });
    expect(email.text).toMatch(
      /Valor devolvido: R\$\s78,75 \(100% do pedido, incluindo a taxa de serviço\)/,
    );
    expect(email.html).toContain("(100% do pedido, incluindo a taxa de serviço)");
  });

  it("cita a sessão do pedido", () => {
    expect(buildRefundEmail(base).text).toContain(
      "O pedido para Noite de Forró (Sábado, 10 de outubro de 2026 · 20h00) foi estornado.",
    );
    const email = buildRefundEmail({ ...base, sessionName: "Sessão infantil" });
    expect(email.text).toContain("(Sessão infantil · Sábado, 10 de outubro de 2026 · 20h00)");
  });

  it("não cita fornecedores nem mostra QR Code", () => {
    const email = buildRefundEmail(base);
    for (const content of [email.html, email.text]) {
      expect(content).not.toMatch(/mercado\s*pago|supabase|vercel|resend/i);
    }
    expect(email.html).not.toContain("cid:");
  });

  it("escapa HTML vindo dos dados do pedido", () => {
    const email = buildRefundEmail({
      ...base,
      buyerName: "<script>x</script>",
      eventName: 'Show "A&B"',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Show &quot;A&amp;B&quot;");
  });
});
