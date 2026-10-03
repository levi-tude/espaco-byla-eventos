import { describe, expect, it } from "vitest";

import { buildReminderEmail } from "@/lib/email/reminder-template";

const base = {
  buyerName: "Maria Souza",
  eventName: "Noite de Forró",
  venue: "Espaço Byla",
  startsAt: "2026-10-10T23:00:00.000Z",
  items: [
    { name: "Inteira", quantity: 2 },
    { name: "Casadinha", quantity: 1 },
  ],
  resumeUrl: "https://exemplo.test/eventos/forro/checkout?retomar=abc123",
  unsubscribeUrl: `https://exemplo.test/lembretes/cancelar?t=${"a".repeat(64)}`,
};

describe("buildReminderEmail", () => {
  it("convida a continuar a compra com a seleção e o link de descadastro", () => {
    const email = buildReminderEmail(base);

    expect(email.subject).toBe("Você não terminou sua compra para Noite de Forró");
    expect(email.text).toContain("Olá, Maria!");
    expect(email.text).toContain("2 × Inteira");
    expect(email.text).toContain("1 × Casadinha");
    expect(email.text).toContain("Onde: Espaço Byla");
    expect(email.text).toContain(`Continuar compra: ${base.resumeUrl}`);
    expect(email.text).toContain(`Não quero receber lembretes: ${base.unsubscribeUrl}`);
    expect(email.html).toContain("Continuar compra</a>");
    expect(email.html).toContain(`href="${base.resumeUrl}"`);
    expect(email.html).toContain(`href="${base.unsubscribeUrl}"`);
    expect(email.html).toContain("Não quero receber lembretes</a>");
    expect(email.html).toContain("#4080FC");
  });

  it("mostra a sessão do pedido no formato padrão", () => {
    expect(buildReminderEmail(base).text).toContain(
      "Quando: Sábado, 10 de outubro de 2026 · 20h00",
    );
    const email = buildReminderEmail({
      ...base,
      sessionName: "Sessão infantil",
      startsAt: "2026-10-10T19:00:00.000Z",
      endsAt: "2026-10-10T20:30:00.000Z",
    });
    expect(email.text).toContain(
      "Quando: Sessão infantil · Sábado, 10 de outubro de 2026 · 16h00 – 17h30",
    );
    expect(email.html).toContain("Sessão infantil");
  });

  it("não cita fornecedores nem traz dados de pagamento", () => {
    const email = buildReminderEmail(base);
    for (const content of [email.html, email.text]) {
      expect(content).not.toMatch(/mercado\s*pago|supabase|vercel|resend|pix|cart[aã]o|cpf/i);
    }
    expect(email.html).not.toContain("cid:");
  });

  it("escapa HTML vindo dos dados do pedido", () => {
    const email = buildReminderEmail({
      ...base,
      buyerName: "<script>x</script>",
      eventName: 'Show "A&B"',
      items: [{ name: "<img src=x>", quantity: 1 }],
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x>");
    expect(email.html).toContain("Show &quot;A&amp;B&quot;");
  });

  it("sem itens, não mostra a lista", () => {
    const email = buildReminderEmail({ ...base, items: [] });
    expect(email.text).not.toContain("Sua seleção");
    expect(email.html).not.toContain("Sua seleção");
  });
});
