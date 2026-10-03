import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SendReminderEmailInput } from "@/lib/email/send-reminder";
import { runAbandonedReminders } from "@/lib/reminders/process";
import {
  REMINDER_BATCH_SIZE,
  REMINDER_DAILY_CAP,
  REMINDER_MIN_POLICY_VERSION,
  REMINDER_SEND_INTERVAL_MS,
} from "@/lib/reminders/rules";

const config = { apiKey: "chave-teste", from: "Espaço Byla <teste@exemplo.test>", appUrl: "https://eventos.exemplo" };

function row(n: number) {
  return {
    order_id: `00000000-0000-4000-8000-00000000000${n}`,
    public_token: `token-${n}`,
    buyer_name: "Comprador Teste",
    buyer_email: `comprador${n}@example.com`,
    optout_token: String(n).repeat(64),
    event_name: "Show Teste",
    event_slug: "show teste",
    event_venue: "Local",
    event_starts_at: "2026-12-01T23:00:00.000Z",
    session_id: "00000000-0000-4000-8000-0000000000aa",
    session_name: "Sessão das 20h",
    session_starts_at: "2026-12-01T23:00:00.000Z",
    session_ends_at: null,
    items: [{ name: "Inteira", quantity: 2 }, { bad: true }],
  };
}

function adminMock(claim: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_abandoned_order_reminders") return claim;
    return { data: true, error: null };
  });
  return { rpc, admin: { rpc } as never };
}

describe("runAbandonedReminders", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sem envio de e-mail configurado, não reivindica nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rpc, admin } = adminMock({ data: [row(1)], error: null });
    const send = vi.fn();

    await expect(runAbandonedReminders(admin, { config: null, send })).resolves.toEqual({ status: "not_configured" });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("reivindica com o limite por execução, o teto diário e a versão mínima da política", async () => {
    const { rpc, admin } = adminMock({ data: [], error: null });

    await expect(runAbandonedReminders(admin, { config, send: vi.fn() })).resolves.toEqual({
      status: "ok",
      claimed: 0,
      sent: 0,
      failed: 0,
    });
    expect(rpc).toHaveBeenCalledWith("claim_abandoned_order_reminders", {
      p_limit: REMINDER_BATCH_SIZE,
      p_daily_cap: REMINDER_DAILY_CAP,
      p_min_policy_version: REMINDER_MIN_POLICY_VERSION,
    });
  });

  it("envia com retomada, descadastro e chave por pedido; marca o enviado", async () => {
    const { rpc, admin } = adminMock({ data: [row(1)], error: null });
    const send = vi.fn(async (input: SendReminderEmailInput) => {
      void input;
      return "sent" as const;
    });

    const result = await runAbandonedReminders(admin, { config, send, pause: vi.fn() });

    expect(result).toEqual({ status: "ok", claimed: 1, sent: 1, failed: 0 });
    const input = send.mock.calls[0][0];
    expect(input.to).toBe("comprador1@example.com");
    expect(input.idempotencyKey).toBe("lembrete-abandono/00000000-0000-4000-8000-000000000001");
    expect(input.oneClickUnsubscribeUrl).toBe(`https://eventos.exemplo/api/lembretes/cancelar?t=${"1".repeat(64)}`);
    expect(input.content.subject).toBe("Você não terminou sua compra para Show Teste");
    expect(input.content.text).toContain(
      "Continuar compra: https://eventos.exemplo/eventos/show%20teste/checkout?retomar=token-1",
    );
    expect(input.content.text).toContain(`https://eventos.exemplo/lembretes/cancelar?t=${"1".repeat(64)}`);
    expect(input.content.text).toContain("2 × Inteira");
    expect(input.content.text).toContain(
      "Quando: Sessão das 20h · Terça-feira, 1 de dezembro de 2026 · 20h00",
    );
    expect(rpc).toHaveBeenCalledWith("mark_abandoned_reminder_sent", { p_order_id: row(1).order_id });
    expect(rpc).not.toHaveBeenCalledWith("release_abandoned_reminder", expect.anything());
  });

  it("envio que falha é liberado para nova tentativa", async () => {
    const { rpc, admin } = adminMock({ data: [row(1), row(2)], error: null });
    const send = vi.fn().mockResolvedValueOnce("failed").mockResolvedValueOnce("sent");

    const result = await runAbandonedReminders(admin, { config, send, pause: vi.fn() });

    expect(result).toEqual({ status: "ok", claimed: 2, sent: 1, failed: 1 });
    expect(rpc).toHaveBeenCalledWith("release_abandoned_reminder", { p_order_id: row(1).order_id });
    expect(rpc).toHaveBeenCalledWith("mark_abandoned_reminder_sent", { p_order_id: row(2).order_id });
    expect(rpc).not.toHaveBeenCalledWith("mark_abandoned_reminder_sent", { p_order_id: row(1).order_id });
  });

  it("espera entre um envio e outro", async () => {
    const { admin } = adminMock({ data: [row(1), row(2), row(3)], error: null });
    const pause = vi.fn(async () => {});

    await runAbandonedReminders(admin, { config, send: vi.fn().mockResolvedValue("sent"), pause });

    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(REMINDER_SEND_INTERVAL_MS);
  });

  it("falha do banco ao reivindicar não envia nada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = adminMock({ data: null, error: { message: "falhou" } });
    const send = vi.fn();

    await expect(runAbandonedReminders(admin, { config, send })).resolves.toEqual({ status: "error" });
    expect(send).not.toHaveBeenCalled();
  });

  it("não registra e-mails nos logs", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) =>
      name === "claim_abandoned_order_reminders"
        ? { data: [row(1)], error: null }
        : { data: null, error: { message: "falhou" } },
    );

    await runAbandonedReminders({ rpc } as never, { config, send: vi.fn().mockResolvedValue("sent"), pause: vi.fn() });

    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("@example.com");
  });
});
