import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  financeRole: vi.fn(),
  eventLookup: vi.fn(),
  revalidatePath: vi.fn(),
  notifyOrganizer: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.serverRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: mocks.eventLookup };
      return chain;
    },
  }),
}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  organizerNoticeLink: (path: string) => `https://site.example${path}`,
}));

import {
  addOrganizerAdjustment,
  loadPayoutDetails,
  loadPendingFees,
  markOrganizerPaid,
  markRefundReceived,
  setEventFeeTotal,
  setManualFee,
} from "@/app/equipe/repasses/actions";
import { todayKey } from "@/lib/domain/fee-payout";

const eventId = "00000000-0000-4000-8000-000000000001";
const orderId = "00000000-0000-4000-8000-000000000010";
const organizerId = "00000000-0000-4000-8000-0000000000bb";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";

const ADMIN_ONLY = "Acesso restrito ao Admin do Espaço.";
const DEVELOPER = "A conta do desenvolvedor não pode registrar repasses, ajustes ou contestações.";

const rpcResults: Record<string, { data: unknown; error: { message: string; code?: string } | null }> = {};

function writeCalls() {
  return mocks.adminRpc.mock.calls.filter(([name]) => name !== "staff_finance_role");
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(rpcResults)) delete rpcResults[key];
  mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
  mocks.serverRpc.mockResolvedValue({ data: true, error: null });
  mocks.financeRole.mockResolvedValue({ data: "admin", error: null });
  mocks.eventLookup.mockResolvedValue({ data: { name: "Show Teste" }, error: null });
  mocks.notifyOrganizer.mockResolvedValue("sent");
  mocks.adminRpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === "staff_finance_role") return mocks.financeRole(args);
    return rpcResults[name] ?? { data: null, error: { message: `rpc inesperada ${name}` } };
  });
});

const validPayout = () => ({ eventId, expectedAmountCents: 43905, pixDate: todayKey(), note: "pix 123" });

describe("markOrganizerPaid", () => {
  it("grava com o valor da tela e avisa o organizador sem dados da chave", async () => {
    rpcResults.record_organizer_payout = {
      data: { payout_id: "p1", kind: "repasse", amount_cents: 43905, discount_cents: 0, organizer_id: organizerId },
      error: null,
    };
    const result = await markOrganizerPaid(validPayout());
    expect(result).toEqual({ ok: true, data: { amountCents: 43905, kind: "repasse" } });
    expect(writeCalls()).toEqual([
      [
        "record_organizer_payout",
        {
          p_admin: staffUserId,
          p_event_id: eventId,
          p_expected_amount_cents: 43905,
          p_pix_date: todayKey(),
          p_note: "pix 123",
        },
      ],
    ]);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(organizerId, "org_repasse_registrado", {
      eventName: "Show Teste",
      amountCents: 43905,
      day: todayKey(),
      link: `https://site.example/organizador/eventos/${eventId}?aba=financeiro`,
    });
  });

  it("compensação (valor 0) vai sem data do PIX", async () => {
    rpcResults.record_organizer_payout = {
      data: { kind: "compensacao", amount_cents: 0, organizer_id: organizerId },
      error: null,
    };
    const result = await markOrganizerPaid({ eventId, expectedAmountCents: 0, pixDate: null });
    expect(result.ok).toBe(true);
    expect(writeCalls()[0][1]).toMatchObject({ p_expected_amount_cents: 0, p_pix_date: null });
  });

  it.each([
    ["desenvolvedor", "admin_dev", DEVELOPER],
    ["secretaria", "secretaria", ADMIN_ONLY],
  ])("recusa a conta %s sem gravar", async (_label, role, message) => {
    mocks.financeRole.mockResolvedValue({ data: role, error: null });
    expect(await markOrganizerPaid(validPayout())).toEqual({ ok: false, error: message });
    expect(writeCalls()).toEqual([]);
  });

  it("recusa sem login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await markOrganizerPaid(validPayout())).toEqual({ ok: false, error: ADMIN_ONLY });
    expect(writeCalls()).toEqual([]);
  });

  it.each([
    ["evento inválido", { ...validPayout(), eventId: "x" }],
    ["valor negativo", { ...validPayout(), expectedAmountCents: -1 }],
    ["valor quebrado", { ...validPayout(), expectedAmountCents: 1.5 }],
    ["data futura", { ...validPayout(), pixDate: "2999-01-01" }],
    ["sem data com valor", { ...validPayout(), pixDate: null }],
    ["nota com quebra", { ...validPayout(), note: "a\nb" }],
  ])("valida a entrada: %s", async (_label, input) => {
    const result = await markOrganizerPaid(input as never);
    expect(result.ok).toBe(false);
    expect(writeCalls()).toEqual([]);
  });

  it("valor mudou vira mensagem com o novo valor e não avisa ninguém", async () => {
    rpcResults.record_organizer_payout = { data: null, error: { message: "ORG_MUDOU:40000" } };
    const result = await markOrganizerPaid(validPayout());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("400,00");
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it("troca de chave pendente bloqueia com mensagem clara", async () => {
    rpcResults.record_organizer_payout = { data: null, error: { message: "ORG_PIX_PENDENTE: troca" } };
    expect(await markOrganizerPaid(validPayout())).toEqual({
      ok: false,
      error: "Existe uma troca de chave PIX aguardando decisão.",
    });
  });

  it("erro desconhecido do banco fica genérico", async () => {
    rpcResults.record_organizer_payout = { data: null, error: { message: "duplicate key value pix_key" } };
    expect(await markOrganizerPaid(validPayout())).toEqual({
      ok: false,
      error: "Não foi possível registrar o repasse.",
    });
  });
});

describe("loadPayoutDetails", () => {
  it("devolve a chave completa só para o Admin que grava", async () => {
    rpcResults.organizer_payout_details = {
      data: {
        pix_key_type: "cpf",
        pix_key: "52998224725",
        pix_holder_name: "Fulano",
        pix_holder_document: "52998224725",
        expected_amount_cents: 1000,
        kind: "repasse",
        balance_cents: 1500,
        pending_fee_orders: 0,
        discounts: [{ event_id: eventId, event_name: "Outro", cents: 500 }],
        release_until: "2026-11-01",
      },
      error: null,
    };
    const result = await loadPayoutDetails(eventId);
    expect(result.ok && result.data.pixKey).toBe("52998224725");
    expect(result.ok && result.data.discounts).toEqual([{ eventId, eventName: "Outro", cents: 500 }]);

    vi.clearAllMocks();
    mocks.financeRole.mockResolvedValue({ data: "admin_dev", error: null });
    expect(await loadPayoutDetails(eventId)).toEqual({ ok: false, error: DEVELOPER });
    expect(writeCalls()).toEqual([]);
  });

  it("resposta fora do formato fica genérica", async () => {
    rpcResults.organizer_payout_details = { data: { expected_amount_cents: "10" }, error: null };
    expect(await loadPayoutDetails(eventId)).toEqual({
      ok: false,
      error: "Não foi possível abrir os dados do repasse.",
    });
  });
});

describe("addOrganizerAdjustment", () => {
  beforeEach(() => {
    rpcResults.record_organizer_payout_adjustment = { data: { payout_id: "a1" }, error: null };
  });

  it.each([
    ["espaco", 2500],
    ["organizador", -2500],
  ] as const)("lado %s grava o sinal certo", async (direction, expected) => {
    const result = await addOrganizerAdjustment({ eventId, direction, amountCents: 2500, reason: "Correção do PIX" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(writeCalls()[0][1]).toEqual({
      p_admin: staffUserId,
      p_event_id: eventId,
      p_amount_cents: expected,
      p_reason: "Correção do PIX",
    });
  });

  it.each([
    ["sem lado", { direction: "x", amountCents: 100, reason: "Motivo ok" }],
    ["valor zero", { direction: "espaco", amountCents: 0, reason: "Motivo ok" }],
    ["valor negativo", { direction: "espaco", amountCents: -5, reason: "Motivo ok" }],
    ["motivo curto", { direction: "espaco", amountCents: 100, reason: "abc" }],
  ])("valida: %s", async (_label, input) => {
    const result = await addOrganizerAdjustment({ eventId, ...input } as never);
    expect(result.ok).toBe(false);
    expect(writeCalls()).toEqual([]);
  });
});

describe("markRefundReceived", () => {
  it("grava a devolução e informa o que falta", async () => {
    rpcResults.record_organizer_refund_received = {
      data: { payout_id: "d1", amount_cents: 2000, remaining_cents: 2739 },
      error: null,
    };
    const result = await markRefundReceived({ organizerId, amountCents: 2000, pixDate: todayKey() });
    expect(result).toEqual({ ok: true, data: { remainingCents: 2739 } });
    expect(writeCalls()[0]).toEqual([
      "record_organizer_refund_received",
      { p_admin: staffUserId, p_organizer_id: organizerId, p_amount_cents: 2000, p_pix_date: todayKey(), p_note: null },
    ]);
  });

  it("valor acima do devido vira mensagem do banco", async () => {
    rpcResults.record_organizer_refund_received = { data: null, error: { message: "ORG_VALOR:4739" } };
    const result = await markRefundReceived({ organizerId, amountCents: 9000, pixDate: todayKey() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("47,39");
  });
});

describe("tarifa do banco", () => {
  it("lista os pedidos sem tarifa também para o desenvolvedor (leitura)", async () => {
    mocks.financeRole.mockResolvedValue({ data: "admin_dev", error: null });
    rpcResults.event_fee_pending_orders = {
      data: [{ order_id: orderId, created_at: "2026-10-01T10:00:00Z", total_cents: 5000, status: "pago", attempts: 2, last_error: "x" }],
      error: null,
    };
    const result = await loadPendingFees(eventId);
    expect(result.ok && result.data).toEqual([
      expect.objectContaining({ orderId, totalCents: 5000, status: "pago" }),
    ]);
    expect(result.ok && "lastError" in result.data[0]).toBe(false);
  });

  it("tarifa de um pedido exige a origem do valor", async () => {
    expect((await setManualFee({ eventId, orderId, feeCents: 99, note: "  " })).ok).toBe(false);
    expect(writeCalls()).toEqual([]);
    rpcResults.record_payment_fee_manual = { data: {}, error: null };
    expect(await setManualFee({ eventId, orderId, feeCents: 99, note: "extrato" })).toEqual({ ok: true, data: undefined });
  });

  it("total do evento manda o que a tela mostrava e traduz a lista que mudou", async () => {
    rpcResults.record_event_fee_total = { data: null, error: { message: "TARIFA_MUDOU:3" } };
    const result = await setEventFeeTotal({
      eventId,
      expectedOrders: 2,
      expectedPendingCents: 10000,
      totalFeeCents: 498,
      note: "extrato outubro",
    });
    expect(result).toEqual({ ok: false, error: "A lista de pedidos sem tarifa mudou. Confira e tente de novo." });
    expect(writeCalls()[0][1]).toEqual({
      p_admin: staffUserId,
      p_event_id: eventId,
      p_expected_orders: 2,
      p_expected_pending_cents: 10000,
      p_total_fee_cents: 498,
      p_note: "extrato outubro",
    });
  });

  it("tarifa zero (banco não cobrou) é aceita", async () => {
    rpcResults.record_event_fee_total = { data: {}, error: null };
    const result = await setEventFeeTotal({
      eventId,
      expectedOrders: 1,
      expectedPendingCents: 5000,
      totalFeeCents: 0,
      note: "sem tarifa no extrato",
    });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("desenvolvedor não lança tarifa", async () => {
    mocks.financeRole.mockResolvedValue({ data: "admin_dev", error: null });
    expect(await setManualFee({ eventId, orderId, feeCents: 99, note: "extrato" })).toEqual({
      ok: false,
      error: DEVELOPER,
    });
    expect(writeCalls()).toEqual([]);
  });
});
