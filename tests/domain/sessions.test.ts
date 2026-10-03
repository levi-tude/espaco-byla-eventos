import { describe, expect, it } from "vitest";

import {
  formatSessionShort,
  formatSessionSubject,
  formatSessionTime,
  formatSessionWhen,
} from "@/lib/datetime";
import {
  orderNumber,
  salesClosedPixMessage,
  sessionName,
  sessionSalesClosesAt,
  suggestCheckInSession,
  wrongSessionMessage,
} from "@/lib/domain/sessions";

// 2026-10-10 é sábado; 19h00 em Brasília = 22h00 UTC.
const SAT_19H = "2026-10-10T22:00:00.000Z";

describe("data e horário da sessão (Brasília)", () => {
  it("formato longo com o h brasileiro", () => {
    expect(formatSessionWhen(SAT_19H)).toBe("Sábado, 10 de outubro de 2026 · 19h00");
  });

  it("com término no mesmo dia", () => {
    expect(formatSessionWhen(SAT_19H, "2026-10-11T00:30:00.000Z")).toBe(
      "Sábado, 10 de outubro de 2026 · 19h00 – 21h30",
    );
  });

  it("término depois da meia-noite mostra o dia", () => {
    expect(formatSessionWhen("2026-10-11T02:00:00.000Z", "2026-10-11T04:00:00.000Z")).toBe(
      "Sábado, 10 de outubro de 2026 · 23h00 – 01h00 (domingo)",
    );
  });

  it("formato curto, horário e assunto", () => {
    expect(formatSessionShort(SAT_19H)).toBe("sáb, 10/10 · 19h00");
    expect(formatSessionTime("2026-10-10T19:05:00.000Z")).toBe("16h05");
    expect(formatSessionSubject(SAT_19H)).toBe("sáb 10/10 às 19h00");
  });

  it("datas inválidas viram texto vazio", () => {
    expect(formatSessionWhen("x")).toBe("");
    expect(formatSessionShort(null)).toBe("");
    expect(formatSessionWhen(SAT_19H, "x")).toBe("Sábado, 10 de outubro de 2026 · 19h00");
  });
});

describe("regras da sessão para a tela", () => {
  it("venda fecha 5 min depois do início", () => {
    expect(sessionSalesClosesAt(SAT_19H).toISOString()).toBe("2026-10-10T22:05:00.000Z");
  });

  it("número do pedido: 8 primeiros caracteres em maiúsculas", () => {
    expect(orderNumber("a1b2c3d4-e5f6-4711-8899-aabbccddeeff")).toBe("A1B2C3D4");
  });

  it("nome da sessão só quando existe", () => {
    expect(sessionName(null)).toBeNull();
    expect(sessionName("   ")).toBeNull();
    expect(sessionName(" Sessão infantil ")).toBe("Sessão infantil");
  });

  it("PIX recusado depois do fim da venda oferece o cartão até o fim da reserva", () => {
    expect(salesClosedPixMessage("2026-10-10T22:12:00.000Z")).toBe(
      "As vendas desta sessão foram encerradas. Se quiser, pague com cartão até 19h12.",
    );
    expect(salesClosedPixMessage(null)).toBe("As vendas desta sessão foram encerradas.");
  });

  it("sessão errada: horário e dia, com o nome se houver", () => {
    expect(wrongSessionMessage(null, "2026-10-10T23:30:00.000Z")).toBe(
      "Sessão errada — este ingresso é da sessão das 20h30 (sáb, 10/10)",
    );
    expect(wrongSessionMessage("Sessão infantil", "2026-10-10T19:00:00.000Z")).toBe(
      "Sessão errada — este ingresso é da sessão “Sessão infantil”, das 16h00 (sáb, 10/10)",
    );
    expect(wrongSessionMessage(null, null)).toBe("Sessão errada");
  });
});

describe("sessão sugerida na portaria", () => {
  const session = (id: string, startsAt: string, extra: Partial<{ endsAt: string; status: "ativa" | "cancelada" }> = {}) => ({
    id,
    name: null,
    startsAt,
    endsAt: extra.endsAt ?? null,
    status: extra.status ?? "ativa",
  });
  const s16 = session("s16", "2026-10-10T19:00:00.000Z", { endsAt: "2026-10-10T20:30:00.000Z" });
  const s19 = session("s19", SAT_19H);
  const at = (iso: string) => Date.parse(iso);

  it("a que está acontecendo (de 2 h antes até o término)", () => {
    expect(suggestCheckInSession([s19, s16], at("2026-10-10T17:30:00.000Z"))?.id).toBe("s16");
    expect(suggestCheckInSession([s19, s16], at("2026-10-10T20:00:00.000Z"))?.id).toBe("s16");
  });

  it("sem término: até 4 h depois do início", () => {
    expect(suggestCheckInSession([s16, s19], at("2026-10-11T01:30:00.000Z"))?.id).toBe("s19");
  });

  it("senão a próxima; depois de todas, a última", () => {
    expect(suggestCheckInSession([s16, s19], at("2026-10-09T12:00:00.000Z"))?.id).toBe("s16");
    expect(suggestCheckInSession([s16, s19], at("2026-10-12T12:00:00.000Z"))?.id).toBe("s19");
  });

  it("ignora sessão cancelada", () => {
    const cancelled = { ...s16, status: "cancelada" as const };
    expect(suggestCheckInSession([cancelled, s19], at("2026-10-10T19:30:00.000Z"))?.id).toBe("s19");
    expect(suggestCheckInSession([cancelled])).toBeNull();
  });
});
