import { describe, expect, it } from "vitest";

import { formatSessionChip } from "@/lib/datetime";
import {
  homeChipSessions,
  pickBuyerSession,
  type SessionSaleSummary,
} from "@/lib/domain/sessions";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");

function session(id: string, startsAt: string, extra: Partial<SessionSaleSummary> = {}): SessionSaleSummary {
  return {
    id,
    name: null,
    startsAt,
    endsAt: null,
    status: "ativa",
    salesOpen: true,
    selling: true,
    soldOut: false,
    remaining: 50,
    minPriceCents: 3000,
    ...extra,
  };
}

const s19 = session("s19", "2026-10-10T22:00:00.000Z");
const s20 = session("s20", "2026-10-10T23:30:00.000Z");

describe("sessão marcada para o comprador", () => {
  it("usa a sessão pedida em ?sessao= quando ela está visível", () => {
    expect(pickBuyerSession([s19, s20], "s20")?.id).toBe("s20");
  });

  it("ignora id desconhecido ou que não é texto", () => {
    expect(pickBuyerSession([s19, s20], "outra")).toBeNull();
    expect(pickBuyerSession([s19, s20], ["s20"])).toBeNull();
  });

  it("sessão única fica marcada sozinha", () => {
    expect(pickBuyerSession([s19], undefined)?.id).toBe("s19");
  });

  it("várias sessões, só uma à venda: marca essa", () => {
    const closed = { ...s19, selling: false };
    expect(pickBuyerSession([closed, s20], undefined)?.id).toBe("s20");
  });

  it("várias à venda: o comprador escolhe", () => {
    expect(pickBuyerSession([s19, s20], undefined)).toBeNull();
  });
});

describe("chips da home", () => {
  it("mostra futuras vendendo ou esgotadas, em ordem", () => {
    const soldOut = session("lotada", "2026-10-10T20:00:00.000Z", { selling: false, soldOut: true });
    const closed = session("fechada", "2026-10-10T21:00:00.000Z", { selling: false });
    const past = session("passou", "2026-10-10T10:00:00.000Z");
    const cancelled = session("cancelada", "2026-10-11T22:00:00.000Z", { status: "cancelada" });
    expect(homeChipSessions([s20, past, closed, soldOut, cancelled, s19], NOW).map((s) => s.id)).toEqual([
      "lotada",
      "s19",
      "s20",
    ]);
  });

  it("texto do chip: dia curto e horário", () => {
    expect(formatSessionChip(s19.startsAt)).toBe("sáb 10/10 · 19h00");
  });
});
