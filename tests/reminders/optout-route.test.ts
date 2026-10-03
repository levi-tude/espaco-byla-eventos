import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  tryConsumeRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMITS: { reminderOptoutPerIp: { bucket: "reminder-optout:ip", limit: 30, windowSeconds: 600 } },
  clientIp: async () => "203.0.113.7",
  tryConsumeRateLimit: mocks.tryConsumeRateLimit,
}));

import * as route from "@/app/api/lembretes/cancelar/route";

const token = "c".repeat(64);
const base = "https://eventos.exemplo/api/lembretes/cancelar";

function buttonRequest(t: string | null) {
  const body = new URLSearchParams();
  if (t !== null) body.set("t", t);
  return new Request(base, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function oneClickRequest(t: string) {
  return new Request(`${base}?t=${encodeURIComponent(t)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
}

function redirectTarget(response: Response) {
  expect(response.status).toBe(303);
  return new URL(response.headers.get("location") ?? "");
}

describe("POST /api/lembretes/cancelar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tryConsumeRateLimit.mockResolvedValue("allowed");
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("não existe GET: abrir o link nunca descadastra", () => {
    expect("GET" in route).toBe(false);
  });

  it("botão da página registra e volta com a confirmação", async () => {
    const target = redirectTarget(await route.POST(buttonRequest(token)));

    expect(target.pathname).toBe("/lembretes/cancelar");
    expect(target.searchParams.get("feito")).toBe("1");
    expect(target.searchParams.has("t")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("register_reminder_optout", { p_token: token });
    expect(mocks.tryConsumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucket: "reminder-optout:ip" }),
      "203.0.113.7",
    );
  });

  it("descadastro com um clique do programa de e-mail responde 200", async () => {
    const response = await route.POST(oneClickRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("register_reminder_optout", { p_token: token });
  });

  it("token mal formado é recusado antes do banco", async () => {
    for (const bad of [null, "", "x".repeat(64), `${token}'--`]) {
      const target = redirectTarget(await route.POST(buttonRequest(bad)));
      expect(target.searchParams.get("erro")).toBe("invalido");
    }
    expect((await route.POST(oneClickRequest("abc"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.tryConsumeRateLimit).not.toHaveBeenCalled();
  });

  it("token desconhecido no banco: link inválido", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const target = redirectTarget(await route.POST(buttonRequest(token)));
    expect(target.searchParams.get("erro")).toBe("invalido");
  });

  it("muitas tentativas ou falha no limite: pede para tentar depois, sem registrar", async () => {
    for (const outcome of ["limited", "error"]) {
      mocks.tryConsumeRateLimit.mockResolvedValueOnce(outcome);
      const target = redirectTarget(await route.POST(buttonRequest(token)));
      expect(target.searchParams.get("erro")).toBe("tente-depois");
      expect(target.searchParams.get("t")).toBe(token);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("falha do banco: pede para tentar depois", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "falhou" } });

    const target = redirectTarget(await route.POST(buttonRequest(token)));
    expect(target.searchParams.get("erro")).toBe("tente-depois");
    expect((await route.POST(oneClickRequest(token))).status).toBe(503);
  });
});
