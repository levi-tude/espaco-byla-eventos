import { describe, expect, it } from "vitest";

import {
  buildOrganizerNotice,
  ORGANIZER_NOTICE_KINDS,
  type OrganizerNoticeKind,
} from "@/lib/email/organizer-notice-template";

const link = "https://site.example/organizador/eventos/00000000-0000-4000-8000-000000000001";
const VENDORS = ["Mercado Pago", "Supabase", "Resend", "Google", "Cloudflare"];

describe("buildOrganizerNotice", () => {
  it.each([
    ["equipe_pedido_site", {}, "Novo pedido para fazer evento"],
    ["equipe_evento_enviado", { eventName: "Festa Junina" }, "Evento para aprovar: Festa Junina"],
    [
      "equipe_pedido_organizador",
      { eventName: "Festa Junina", requestKind: "estorno" },
      "Pedido do organizador: Estorno — Festa Junina",
    ],
    [
      "equipe_pedido_organizador",
      { eventName: "Festa Junina", requestKind: "exclusao" },
      "Pedido do organizador: Exclusão — Festa Junina",
    ],
    [
      "equipe_pedido_organizador",
      { eventName: "Festa Junina", requestKind: "mudanca" },
      "Pedido do organizador: Mudança — Festa Junina",
    ],
    ["org_evento_aprovado", { eventName: "Festa Junina" }, "Seu evento foi aprovado"],
    ["org_evento_recusado", { eventName: "Festa Junina", note: "Falta a capa" }, "Seu evento precisa de ajustes"],
    [
      "org_pedido_respondido",
      { eventName: "Festa Junina", requestKind: "estorno", outcome: "atendido" },
      "Resposta ao seu pedido",
    ],
    ["org_conta_suspensa", {}, "Sua conta foi suspensa"],
    ["org_repasse_registrado", { eventName: "Festa Junina", amountCents: 100 }, "Repasse registrado"],
    ["org_pix_troca_pedida", {}, "Pedido de troca da chave PIX"],
    ["org_pix_troca_confirmada", {}, "Chave PIX trocada"],
    ["org_pix_troca_recusada", { note: "Titular diferente" }, "Troca da chave PIX recusada"],
    ["equipe_pix_troca_pedida", { organizerName: "Produtora X" }, "Troca de chave PIX pedida: Produtora X"],
  ] as const)("%s tem o assunto do spec", (kind, data, subject) => {
    expect(buildOrganizerNotice(kind, { ...data, link }).subject).toBe(subject);
  });

  it("leva o link no botão e no texto", () => {
    const notice = buildOrganizerNotice("org_evento_aprovado", { eventName: "Festa", link });
    expect(notice.html).toContain(`href="${link}"`);
    expect(notice.text).toContain(link);
  });

  it("escapa nome do evento e nota no HTML", () => {
    const notice = buildOrganizerNotice("org_evento_recusado", {
      eventName: 'Festa <b>"A&B"</b>',
      note: 'Ajuste <script>alert("x")</script> & capa',
      link,
    });
    expect(notice.html).not.toContain("<b>");
    expect(notice.html).not.toContain("<script>");
    expect(notice.html).toContain("Festa &lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
    expect(notice.html).toContain("Ajuste &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; capa");
    expect(notice.text).toContain('Ajuste <script>alert("x")</script> & capa');
  });

  it("assunto não aceita quebra de linha vinda do nome do evento", () => {
    const notice = buildOrganizerNotice("equipe_evento_enviado", {
      eventName: "Festa\r\nBcc: alguem@exemplo.com",
      link,
    });
    expect(notice.subject).not.toMatch(/[\r\n]/);
    expect(notice.subject).toBe("Evento para aprovar: Festa Bcc: alguem@exemplo.com");
  });

  it("pedido do site resume quantos chegaram", () => {
    expect(buildOrganizerNotice("equipe_pedido_site", { count: 3, link }).text).toContain("3 pedidos novos");
    expect(buildOrganizerNotice("equipe_pedido_site", { count: 1, link }).text).toContain("1 pedido novo");
    expect(buildOrganizerNotice("equipe_pedido_site", { link }).text).toContain("pedido novo");
  });

  it("pedido do organizador traz o motivo e o tipo", () => {
    const notice = buildOrganizerNotice("equipe_pedido_organizador", {
      eventName: "Festa",
      requestKind: "exclusao",
      note: "Evento adiado",
      link,
    });
    expect(notice.text).toContain("exclusão do evento");
    expect(notice.text).toContain("Motivo: Evento adiado");
  });

  it("resposta ao pedido diz se foi atendido ou recusado", () => {
    const done = buildOrganizerNotice("org_pedido_respondido", {
      eventName: "Festa",
      requestKind: "estorno",
      outcome: "atendido",
      link,
    });
    expect(done.text).toContain("foi atendido");
    const declined = buildOrganizerNotice("org_pedido_respondido", {
      eventName: "Festa",
      requestKind: "mudanca",
      outcome: "recusado",
      note: "Preço já divulgado",
      link,
    });
    expect(declined.text).toContain("foi recusado");
    expect(declined.text).toContain("Preço já divulgado");
  });

  it("recusa do evento traz o motivo", () => {
    const notice = buildOrganizerNotice("org_evento_recusado", {
      eventName: "Festa",
      note: "Falta a capa",
      link,
    });
    expect(notice.text).toContain("Falta a capa");
  });

  it("repasse registrado traz valor, evento e data do PIX", () => {
    const notice = buildOrganizerNotice("org_repasse_registrado", {
      eventName: "Festa",
      amountCents: 43905,
      day: "2026-10-29",
      link,
    });
    expect(notice.subject).toBe("Repasse registrado");
    expect(notice.text).toContain("R$\u00a0439,05");
    expect(notice.text).toContain("Festa");
    expect(notice.text).toContain("29/10/2026");
    expect(notice.text).not.toMatch(/chave|CPF|CNPJ/i);
  });

  it("troca de PIX: organizador sabe o que fazer se não foi ele; equipe vê quando pode confirmar", () => {
    const own = buildOrganizerNotice("org_pix_troca_pedida", { link });
    expect(own.text).toContain("Se não foi você, cancele na sua conta e avise o Espaço Byla.");
    const team = buildOrganizerNotice("equipe_pix_troca_pedida", {
      organizerName: "Produtora X",
      confirmAfter: "2026-10-16T18:30:00Z",
      link,
    });
    expect(team.text).toContain("pode ser confirmada a partir de 16/10 às 15:30");
    const refused = buildOrganizerNotice("org_pix_troca_recusada", { note: "Titular diferente", link });
    expect(refused.text).toContain("Motivo: Titular diferente");
  });

  it("devolução pendente traz valor, prazo e chave do Espaço (ou diz que ela vai chegar)", () => {
    const withKey = buildOrganizerNotice("org_devolucao_pendente", {
      eventName: "Festa",
      amountCents: 4739,
      day: "2026-12-09",
      espacoPixKey: "financeiro@espaco.example",
      link,
    });
    expect(withKey.text).toContain("Devolva R$\u00a047,39 por PIX ao Espaço Byla até 09/12.");
    expect(withKey.text).toContain("Chave PIX do Espaço Byla: financeiro@espaco.example");
    const withoutKey = buildOrganizerNotice("org_devolucao_pendente", { eventName: "Festa", amountCents: 4739, link });
    expect(withoutKey.text).toContain("O Espaço Byla vai te mandar a chave PIX");
  });

  it("pedido estornado com número e aviso de desconto", () => {
    const notice = buildOrganizerNotice("org_pedido_estornado", { eventName: "Festa", orderNumber: "ABCDEF12", link });
    expect(notice.subject).toBe("Pedido estornado no seu evento");
    expect(notice.text).toContain("O pedido Nº ABCDEF12 do evento Festa foi estornado.");
    expect(notice.text).toContain("Se o repasse já foi feito, o valor será descontado do próximo.");
  });

  it("resumo da equipe só com contagens", () => {
    const notice = buildOrganizerNotice("equipe_repasses_resumo", {
      summary: { latePayouts: 3, latePayoutsCents: 123456, lateRefunds: 1, feesPending: 2, calendarMissingYear: 2027 },
      link,
    });
    expect(notice.text).toContain("3 repasses atrasados (R$\u00a01.234,56)");
    expect(notice.text).toContain("1 devolução atrasada");
    expect(notice.text).toContain("2 tarifas a conferir");
    expect(notice.text).toContain("Feriados de 2027");
  });

  it("acerto sem PIX não mostra valor nem data", () => {
    const notice = buildOrganizerNotice("org_repasse_registrado", { eventName: "Festa", amountCents: 0, link });
    expect(notice.text).toContain("sem PIX");
    expect(notice.text).not.toContain("R$");
  });

  it("link que não é endereço web não vira botão", () => {
    const notice = buildOrganizerNotice("org_conta_suspensa", { link: "javascript:alert(1)" });
    expect(notice.html).not.toContain("javascript:");
    expect(notice.text).not.toContain("javascript:");
  });

  it.each(ORGANIZER_NOTICE_KINDS)("%s não cita fornecedores", (kind: OrganizerNoticeKind) => {
    const notice = buildOrganizerNotice(kind, {
      eventName: "Festa",
      note: "Motivo qualquer",
      requestKind: "estorno",
      outcome: "recusado",
      count: 2,
      link,
    });
    for (const vendor of VENDORS) {
      expect(notice.subject).not.toContain(vendor);
      expect(notice.html).not.toContain(vendor);
      expect(notice.text).not.toContain(vendor);
    }
  });

  it("o tipo de dados não aceita nome nem e-mail de comprador", () => {
    const notice = buildOrganizerNotice("equipe_pedido_organizador", {
      eventName: "Festa",
      requestKind: "estorno",
      link,
      // @ts-expect-error dados de comprador não fazem parte do aviso
      buyerEmail: "fulana@exemplo.com",
    });
    expect(notice.html).not.toContain("fulana@exemplo.com");
    expect(notice.text).not.toContain("fulana@exemplo.com");
  });
});
