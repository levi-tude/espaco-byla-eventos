import { describe, expect, it } from "vitest";

import { buildRefundEmail } from "@/lib/email/refund-template";
import { buildScheduleChangeEmail, buildSessionCancelledEmail } from "@/lib/email/session-notice-template";

const VENDORS = /mercado\s*pago|supabase|vercel|resend/i;

const common = {
  buyerName: "Maria Souza",
  eventName: "Noite de Forró",
  venue: "Espaço Byla",
  sessionName: null,
  orderUrl: "https://exemplo.test/pedidos/abc123",
  replyAvailable: true,
};

describe("buildScheduleChangeEmail", () => {
  const data = {
    ...common,
    previousStartsAt: "2026-10-10T22:00:00.000Z",
    newStartsAt: "2026-10-10T23:00:00.000Z",
    newEndsAt: null,
  };

  it("mostra o novo horário em destaque e o antigo riscado", () => {
    const email = buildScheduleChangeEmail(data);
    expect(email.subject).toBe("Mudança de horário — Noite de Forró");
    expect(email.text).toContain("Olá, Maria!");
    expect(email.text).toContain("Novo horário: Sábado, 10 de outubro de 2026 · 20h00");
    expect(email.text).toContain("Antes: sáb, 10/10 · 19h00");
    expect(email.html).toContain('<s style="color:#888888;">sáb, 10/10 · 19h00</s>');
    expect(email.text).toContain("Local: Espaço Byla");
    expect(email.text).toContain("Seus ingressos continuam valendo. Não precisa fazer nada.");
    expect(email.html).toContain('href="https://exemplo.test/pedidos/abc123"');
    expect(email.html).toContain("Ver meus ingressos");
  });

  it("não promete reembolso", () => {
    const email = buildScheduleChangeEmail(data);
    for (const content of [email.html, email.text]) {
      expect(content).not.toMatch(/reembols|devolu|estorn/i);
    }
  });

  it("convida a responder só quando há e-mail de contato", () => {
    expect(buildScheduleChangeEmail(data).text).toContain("Em caso de dúvidas, responda este e-mail.");
    const noReply = buildScheduleChangeEmail({ ...data, replyAvailable: false });
    expect(noReply.text).not.toContain("responda este e-mail");
    expect(noReply.text).toContain("fale com a equipe do Espaço Byla");
  });

  it("cita o nome da sessão quando existe", () => {
    expect(buildScheduleChangeEmail({ ...data, sessionName: "Matinê" }).text).toContain(
      "Novo horário: Matinê · Sábado, 10 de outubro de 2026 · 20h00",
    );
  });

  it("não cita fornecedores e escapa HTML", () => {
    const email = buildScheduleChangeEmail({ ...data, buyerName: "<b>x</b>", eventName: 'Show "A&B"' });
    for (const content of [email.html, email.text]) expect(content).not.toMatch(VENDORS);
    expect(email.html).not.toContain("<b>x</b>");
    expect(email.html).toContain("Show &quot;A&amp;B&quot;");
  });
});

describe("buildSessionCancelledEmail", () => {
  const data = {
    ...common,
    startsAt: "2026-10-10T22:00:00.000Z",
    endsAt: null,
    reason: "Chuva forte, espaço alagado",
    isCourtesy: false,
  };

  it("informa cancelamento, motivo, ingressos sem validade e devolução", () => {
    const email = buildSessionCancelledEmail(data);
    expect(email.subject).toBe("Sessão cancelada — Noite de Forró");
    expect(email.text).toContain(
      "A sessão de Noite de Forró (Sábado, 10 de outubro de 2026 · 19h00) foi cancelada.",
    );
    expect(email.text).toContain("Motivo: Chuva forte, espaço alagado");
    expect(email.text).toContain("Seus ingressos não valem mais para entrada.");
    expect(email.text).toContain("O valor pago será devolvido integralmente");
    expect(email.html).toContain("Ver pedido");
  });

  it("cortesia não fala de devolução", () => {
    const email = buildSessionCancelledEmail({ ...data, isCourtesy: true });
    for (const content of [email.html, email.text]) expect(content).not.toMatch(/devolvid|valor pago/i);
  });

  it("não cita fornecedores e escapa o motivo", () => {
    const email = buildSessionCancelledEmail({ ...data, reason: "<script>x</script>" });
    for (const content of [email.html, email.text]) expect(content).not.toMatch(VENDORS);
    expect(email.html).not.toContain("<script>");
  });
});

describe("buildRefundEmail — sessão cancelada", () => {
  it("usa o assunto e a abertura de sessão cancelada, com o mesmo valor e prazos", () => {
    const email = buildRefundEmail({
      buyerName: "Maria Souza",
      eventName: "Noite de Forró",
      startsAt: "2026-10-10T22:00:00.000Z",
      amountCents: 5000,
      tickets: [{ holderName: "Maria Souza", kindLabel: "Inteira" }],
      orderUrl: "https://exemplo.test/pedidos/abc123",
      sessionCancelled: true,
    });
    expect(email.subject).toBe("Sessão cancelada — valor devolvido — Noite de Forró");
    expect(email.html).toContain("Sessão cancelada — valor devolvido</h1>");
    expect(email.text).toContain(
      "A sessão de Noite de Forró (Sábado, 10 de outubro de 2026 · 19h00) foi cancelada e o seu pedido foi estornado.",
    );
    expect(email.text).toMatch(/R\$\s50,00/);
    expect(email.text).toContain("em até 2 faturas");
    for (const content of [email.html, email.text]) expect(content).not.toMatch(VENDORS);
  });
});
