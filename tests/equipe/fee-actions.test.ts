import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  financeRole: vi.fn(),
  eventLookup: vi.fn(),
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  alertTeamFeePayout: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.serverRpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/alerts/team-alert", () => ({
  alertTeamFeePayout: mocks.alertTeamFeePayout,
}));

import {
  addFeeAdjustment,
  markFeePaid,
  registerChargeback,
} from "@/app/equipe/taxa-servico/actions";
import { todayKey } from "@/lib/domain/fee-payout";

const eventId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000010";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";
const payoutId = "00000000-0000-4000-8000-0000000000aa";

const ADMIN_ONLY = "Acesso restrito ao Admin do Espaço.";
const DEVELOPER = "A conta do desenvolvedor não pode registrar repasses, ajustes ou contestações.";

function writeRpcCalls() {
  return mocks.adminRpc.mock.calls.filter(([name]) => name !== "staff_finance_role");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
  mocks.serverRpc.mockResolvedValue({ data: true, error: null });
  mocks.financeRole.mockResolvedValue({ data: "admin", error: null });
  mocks.eventLookup.mockResolvedValue({ data: { name: "Show Teste" }, error: null });
  mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === "staff_finance_role") return mocks.financeRole(args);
    if (name === "record_service_fee_payout") {
      return {
        data: { payout_id: payoutId, amount_cents: 1875, created_by_name: "Ana" },
        error: null,
      };
    }
    if (name === "record_service_fee_adjustment") return { data: { payout_id: payoutId }, error: null };
    if (name === "register_order_chargeback") {
      return { data: { id: "cb-1", kind: "contestacao", event_id: eventId }, error: null };
    }
    return { data: null, error: { message: `rpc inesperada ${name}` } };
  });
  mocks.createAdminClient.mockReturnValue({
    rpc: mocks.adminRpc,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: mocks.eventLookup };
      return chain;
    },
  });
  mocks.alertTeamFeePayout.mockResolvedValue(undefined);
});

const validPayout = () => ({
  eventId,
  expectedAmountCents: 1875,
  pixDate: todayKey(),
  note: "  E1234  ",
});

const actions = [
  ["markFeePaid", () => markFeePaid(validPayout())],
  ["addFeeAdjustment", () => addFeeAdjustment({ eventId, amountCents: -250, reason: "Repasse a mais" })],
  [
    "registerChargeback",
    () => registerChargeback({ orderId, kind: "contestacao", reason: "Aviso do banco" }),
  ],
] as const;

describe.each(actions)("%s — acesso", (_name, run) => {
  it.each([
    ["sem login", () => mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })],
    ["fora da equipe", () => mocks.serverRpc.mockResolvedValue({ data: false, error: null })],
    ["secretaria", () => mocks.financeRole.mockResolvedValue({ data: "secretaria", error: null })],
    ["sem papel", () => mocks.financeRole.mockResolvedValue({ data: null, error: null })],
  ])("%s é recusado sem gravar nada", async (_caso, arrange) => {
    arrange();
    expect(await run()).toEqual({ ok: false, error: ADMIN_ONLY });
    expect(writeRpcCalls()).toEqual([]);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("conta do desenvolvedor só lê: escrita recusada", async () => {
    mocks.financeRole.mockResolvedValue({ data: "admin_dev", error: null });
    expect(await run()).toEqual({ ok: false, error: DEVELOPER });
    expect(writeRpcCalls()).toEqual([]);
  });

  it("falha ao conferir o papel nega o acesso", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.financeRole.mockResolvedValue({ data: null, error: { message: "timeout" } });
    expect(await run()).toEqual({ ok: false, error: ADMIN_ONLY });
    expect(writeRpcCalls()).toEqual([]);
  });
});

describe("markFeePaid", () => {
  it("grava o repasse com os parâmetros certos, atualiza as telas e avisa a equipe", async () => {
    expect(await markFeePaid(validPayout())).toEqual({ ok: true, data: { amountCents: 1875 } });
    expect(writeRpcCalls()).toEqual([
      [
        "record_service_fee_payout",
        {
          p_event_id: eventId,
          p_staff_user_id: staffUserId,
          p_expected_amount_cents: 1875,
          p_pix_date: todayKey(),
          p_note: "E1234",
        },
      ],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/equipe/eventos/${eventId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/taxa-servico");
    expect(mocks.alertTeamFeePayout).toHaveBeenCalledWith(expect.anything(), {
      payoutId,
      amountCents: 1875,
      staffName: "Ana",
      eventId,
      eventName: "Show Teste",
      pixDate: todayKey(),
      note: "E1234",
    });
  });

  it("nota vazia vai como nula", async () => {
    await markFeePaid({ ...validPayout(), note: "   " });
    expect(writeRpcCalls()[0][1]).toMatchObject({ p_note: null });
  });

  it("falha no alerta não desfaz o repasse", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.eventLookup.mockRejectedValue(new Error("rede caiu"));
    expect(await markFeePaid(validPayout())).toEqual({ ok: true, data: { amountCents: 1875 } });
  });

  it.each([
    ["evento inválido", { eventId: "abc" }, "Evento inválido."],
    ["evento com injeção", { eventId: `${eventId}' or 1=1` }, "Evento inválido."],
    ["valor zero", { expectedAmountCents: 0 }, "Valor inválido."],
    ["valor negativo", { expectedAmountCents: -100 }, "Valor inválido."],
    ["valor quebrado", { expectedAmountCents: 10.5 }, "Valor inválido."],
    ["valor como texto", { expectedAmountCents: "1875" }, "Valor inválido."],
    ["valor acima do limite", { expectedAmountCents: 10_000_001 }, "Valor inválido."],
    ["data em outro formato", { pixDate: "06/10/2026" }, "Informe a data do PIX (não pode ser futura)."],
    ["data inexistente", { pixDate: "2026-02-30" }, "Informe a data do PIX (não pode ser futura)."],
    ["data futura", { pixDate: "2999-01-01" }, "Informe a data do PIX (não pode ser futura)."],
    [
      "nota com quebra de linha",
      { note: "linha 1\nlinha 2" },
      "A nota pode ter até 140 caracteres, sem quebra de linha.",
    ],
    [
      "nota longa",
      { note: "a".repeat(141) },
      "A nota pode ter até 140 caracteres, sem quebra de linha.",
    ],
  ])("recusa %s sem chamar o banco", async (_caso, patch, message) => {
    const input = { ...validPayout(), ...patch } as Parameters<typeof markFeePaid>[0];
    expect(await markFeePaid(input)).toEqual({ ok: false, error: message });
    expect(writeRpcCalls()).toEqual([]);
  });

  it("valor mudou (TAXA_MUDOU) volta com mensagem clara e sem alerta", async () => {
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "staff_finance_role"
        ? mocks.financeRole(args)
        : { data: null, error: { message: "TAXA_MUDOU:1625" } },
    );
    expect(await markFeePaid(validPayout())).toEqual({
      ok: false,
      error: "Os valores mudaram desde que a tela foi aberta. Confira e tente de novo.",
    });
    expect(mocks.alertTeamFeePayout).not.toHaveBeenCalled();
  });

  it("nada a pagar (TAXA_NADA) — segundo clique não paga em dobro", async () => {
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "staff_finance_role"
        ? mocks.financeRole(args)
        : { data: null, error: { message: "TAXA_NADA: Nada a pagar neste evento." } },
    );
    expect(await markFeePaid(validPayout())).toEqual({
      ok: false,
      error: "Nada a pagar agora. Os descontos pendentes continuam para o próximo repasse.",
    });
  });

  it("erro inesperado vira mensagem genérica", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "staff_finance_role"
        ? mocks.financeRole(args)
        : { data: null, error: { message: "connection refused 10.0.0.1:5432" } },
    );
    expect(await markFeePaid(validPayout())).toEqual({
      ok: false,
      error: "Não foi possível registrar o repasse.",
    });
  });
});

describe("addFeeAdjustment", () => {
  it("lança o ajuste com valor e motivo sem espaços nas pontas", async () => {
    expect(
      await addFeeAdjustment({ eventId, amountCents: -250, reason: "  Repasse registrado a mais  " }),
    ).toEqual({ ok: true, data: undefined });
    expect(writeRpcCalls()).toEqual([
      [
        "record_service_fee_adjustment",
        {
          p_event_id: eventId,
          p_staff_user_id: staffUserId,
          p_amount_cents: -250,
          p_reason: "Repasse registrado a mais",
        },
      ],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/equipe/eventos/${eventId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/taxa-servico");
  });

  it.each([
    ["evento inválido", { eventId: "x" }, "Evento inválido."],
    ["valor zero", { amountCents: 0 }, "Informe um valor diferente de zero (até R$ 100.000,00)."],
    ["valor quebrado", { amountCents: 1.5 }, "Informe um valor diferente de zero (até R$ 100.000,00)."],
    [
      "valor acima do limite",
      { amountCents: -10_000_001 },
      "Informe um valor diferente de zero (até R$ 100.000,00).",
    ],
    ["motivo curto", { reason: " abc " }, "Escreva o motivo (de 5 a 500 caracteres)."],
    ["motivo longo", { reason: "a".repeat(501) }, "Escreva o motivo (de 5 a 500 caracteres)."],
  ])("recusa %s sem chamar o banco", async (_caso, patch, message) => {
    const input = { eventId, amountCents: 200, reason: "PIX extra", ...patch } as Parameters<
      typeof addFeeAdjustment
    >[0];
    expect(await addFeeAdjustment(input)).toEqual({ ok: false, error: message });
    expect(writeRpcCalls()).toEqual([]);
  });
});

describe("registerChargeback", () => {
  it.each(["contestacao", "reversao"] as const)("registra %s do pedido", async (kind) => {
    expect(await registerChargeback({ orderId, kind, reason: "Aviso do banco" })).toEqual({
      ok: true,
      data: { kind },
    });
    expect(writeRpcCalls()).toEqual([
      [
        "register_order_chargeback",
        { p_order_id: orderId, p_staff_user_id: staffUserId, p_kind: kind, p_reason: "Aviso do banco" },
      ],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/equipe/eventos/${eventId}`);
  });

  it.each([
    ["pedido inválido", { orderId: "1" }, "Pedido inválido."],
    ["tipo desconhecido", { kind: "estorno" }, "Escolha registrar ou desfazer a contestação."],
    ["motivo curto", { reason: "oi" }, "Escreva o motivo (de 5 a 500 caracteres)."],
  ])("recusa %s sem chamar o banco", async (_caso, patch, message) => {
    const input = { orderId, kind: "contestacao", reason: "Aviso do banco", ...patch } as Parameters<
      typeof registerChargeback
    >[0];
    expect(await registerChargeback(input)).toEqual({ ok: false, error: message });
    expect(writeRpcCalls()).toEqual([]);
  });

  it("pedido já contestado vira mensagem clara", async () => {
    mocks.adminRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "staff_finance_role"
        ? mocks.financeRole(args)
        : { data: null, error: { message: "TAXA_CONTESTACAO_JA: Pedido já contestado." } },
    );
    expect(await registerChargeback({ orderId, kind: "contestacao", reason: "Aviso do banco" })).toEqual({
      ok: false,
      error: "Este pedido já está com contestação registrada.",
    });
  });
});
