import { beforeEach, describe, expect, it, vi } from "vitest";

const { continueSessionNotices } = vi.hoisted(() => ({ continueSessionNotices: vi.fn() }));
vi.mock("@/app/equipe/eventos/session-actions", () => ({ continueSessionNotices }));

import type { NoticeSendResult } from "@/app/equipe/eventos/session-actions";
import { noticeSendMessage, sendAllNoticeBatches } from "@/components/equipe/session-notice-send";

const NOTICE = "5b0c3c1e-3f4b-4b8e-9c55-7f0f3e2a1b10";

function progress(partial: Partial<NoticeSendResult>): NoticeSendResult {
  return { noticeId: NOTICE, total: 30, sent: 0, pending: 0, failed: 0, skipped: 0, pausedUntil: null, ...partial };
}
const ok = (data: NoticeSendResult) => ({ ok: true as const, data });

describe("sendAllNoticeBatches", () => {
  beforeEach(() => continueSessionNotices.mockReset());

  it("continua os lotes até não sobrar pendente", async () => {
    continueSessionNotices
      .mockResolvedValueOnce(ok(progress({ sent: 20, pending: 10 })))
      .mockResolvedValueOnce(ok(progress({ sent: 30 })));
    const seen: number[] = [];
    const result = await sendAllNoticeBatches(
      async () => ok(progress({ sent: 10, pending: 20 })),
      (p) => seen.push(p.sent),
    );
    expect(result).toEqual(ok(progress({ sent: 30 })));
    expect(seen).toEqual([10, 20, 30]);
    expect(continueSessionNotices).toHaveBeenCalledWith(NOTICE);
  });

  it("para quando a fila foi pausada pelo limite diário", async () => {
    const paused = progress({ sent: 8, pending: 22, pausedUntil: "2026-10-05T00:00:00.000Z" });
    const result = await sendAllNoticeBatches(async () => ok(paused), () => {});
    expect(result).toEqual(ok(paused));
    expect(continueSessionNotices).not.toHaveBeenCalled();
  });

  it("para quando um lote não avança (evita repetir sem fim)", async () => {
    continueSessionNotices.mockResolvedValue(ok(progress({ sent: 10, pending: 20 })));
    await sendAllNoticeBatches(async () => ok(progress({ sent: 10, pending: 20 })), () => {});
    expect(continueSessionNotices).toHaveBeenCalledTimes(1);
  });

  it("devolve o erro da ação sem continuar", async () => {
    const result = await sendAllNoticeBatches(async () => ({ ok: false as const, error: "Acesso restrito à equipe." }), () => {});
    expect(result).toEqual({ ok: false, error: "Acesso restrito à equipe." });
    expect(continueSessionNotices).not.toHaveBeenCalled();
  });
});

describe("noticeSendMessage", () => {
  it("explica pendentes pausados e falhas em linguagem da equipe", () => {
    const text = noticeSendMessage(
      progress({ sent: 8, pending: 20, failed: 2, pausedUntil: "2026-10-05T00:00:00.000Z" }),
    );
    expect(text).toContain("Enviados 8 de 30.");
    expect(text).toContain("depois das 21h00");
    expect(text).toContain("Tentar de novo");
  });
});
