import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverRpc: vi.fn(),
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
  createAdminClient: vi.fn(),
  sendOrderTicketsEmail: vi.fn(),
  revalidatePath: vi.fn(),
  refundPaidOrder: vi.fn(),
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
vi.mock("@/lib/payments/confirm-order", () => ({
  sendOrderTicketsEmail: mocks.sendOrderTicketsEmail,
}));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProvider: () => ({ name: "mercadopago" }),
}));
vi.mock("@/lib/payments/refund", () => ({ refundPaidOrder: mocks.refundPaidOrder }));

import { acceptPaidOrder, refundOrder } from "@/app/equipe/eventos/order-actions";
import { ActionError } from "@/lib/action-result";

const orderId = "00000000-0000-4000-8000-000000000010";
const staffUserId = "00000000-0000-4000-8000-0000000000ff";

function orderLookup(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };
  return chain;
}

describe("acceptPaidOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
    mocks.serverRpc.mockResolvedValue({ data: true, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc, from: mocks.adminFrom });
    mocks.adminFrom.mockImplementation(() =>
      orderLookup({ event_id: "evento-1", events: { slug: "show" } }),
    );
    mocks.adminRpc.mockResolvedValue({ data: "accepted", error: null });
    mocks.sendOrderTicketsEmail.mockResolvedValue(true);
  });

  it.each([
    ["sem login", () => mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })],
    ["logado mas fora da equipe", () => mocks.serverRpc.mockResolvedValue({ data: false, error: null })],
    [
      "checagem de equipe falhou",
      () => mocks.serverRpc.mockResolvedValue({ data: null, error: { message: "falhou" } }),
    ],
  ])("%s é recusado antes de tocar no banco", async (_caso, arrange) => {
    arrange();
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: false,
      error: "Acesso restrito à equipe.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each(["", "abc", `${orderId}' or 1=1`, 123])(
    "recusa identificador inválido (%s)",
    async (invalid) => {
      expect(await acceptPaidOrder(invalid as string)).toEqual({
        ok: false,
        error: "Pedido inválido.",
      });
      expect(mocks.adminRpc).not.toHaveBeenCalled();
    },
  );

  it("aceita registrando quem decidiu e envia os ingressos", async () => {
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: true,
      data: { alreadyAccepted: false, emailSent: true },
    });
    expect(mocks.adminRpc).toHaveBeenCalledWith("accept_paid_order", {
      p_order_id: orderId,
      p_staff_user_id: staffUserId,
    });
    expect(mocks.sendOrderTicketsEmail).toHaveBeenCalledWith(expect.anything(), orderId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/eventos/evento-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });

  it("informa quando o e-mail não saiu", async () => {
    mocks.sendOrderTicketsEmail.mockResolvedValue(false);
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: true,
      data: { alreadyAccepted: false, emailSent: false },
    });
  });

  it("segundo clique não reenvia e-mail", async () => {
    mocks.adminRpc.mockResolvedValue({ data: "noop", error: null });
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: true,
      data: { alreadyAccepted: true, emailSent: true },
    });
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
  });

  it("pedido que não aguarda decisão vira mensagem clara", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "O pedido não está aguardando decisão." },
    });
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: false,
      error: "Este pedido já foi resolvido. Atualize a página.",
    });
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled();
  });

  it("erro inesperado vira mensagem genérica, sem detalhes internos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused 10.0.0.1:5432" },
    });
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: false,
      error: "Não foi possível aceitar o pedido.",
    });
  });

  it("pedido inexistente é recusado", async () => {
    mocks.adminFrom.mockImplementation(() => orderLookup(null));
    expect(await acceptPaidOrder(orderId)).toEqual({
      ok: false,
      error: "Pedido não encontrado.",
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("refundOrder", () => {
  const reason = "Comprador pediu cancelamento";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: staffUserId } }, error: null });
    mocks.serverRpc.mockResolvedValue({ data: true, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.adminRpc, from: mocks.adminFrom });
    mocks.adminFrom.mockImplementation(() =>
      orderLookup({ event_id: "evento-1", public_token: "token-1", events: { slug: "show" } }),
    );
    mocks.refundPaidOrder.mockResolvedValue({ status: "refunded", emailSent: true });
  });

  it.each([
    ["sem login", () => mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })],
    ["logado mas fora da equipe", () => mocks.serverRpc.mockResolvedValue({ data: false, error: null })],
  ])("%s é recusado antes de tocar no banco ou no provedor", async (_caso, arrange) => {
    arrange();
    expect(await refundOrder(orderId, reason)).toEqual({
      ok: false,
      error: "Acesso restrito à equipe.",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.refundPaidOrder).not.toHaveBeenCalled();
  });

  it.each(["", "abc", `${orderId}' or 1=1`])("recusa identificador inválido (%s)", async (invalid) => {
    expect(await refundOrder(invalid, reason)).toEqual({ ok: false, error: "Pedido inválido." });
    expect(mocks.refundPaidOrder).not.toHaveBeenCalled();
  });

  it.each(["", "  ok  ", "a".repeat(501), 42])("recusa motivo inválido (%s)", async (invalid) => {
    expect(await refundOrder(orderId, invalid as string)).toEqual({
      ok: false,
      error: "Escreva o motivo do estorno (de 5 a 500 caracteres).",
    });
    expect(mocks.refundPaidOrder).not.toHaveBeenCalled();
  });

  it("estorna registrando quem pediu e o motivo (sem espaços nas pontas)", async () => {
    expect(await refundOrder(orderId, `  ${reason}  `)).toEqual({
      ok: true,
      data: { status: "refunded", emailSent: true },
    });
    expect(mocks.refundPaidOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "mercadopago" }),
      { orderId, staffUserId, reason },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/eventos/evento-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pedidos/token-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/eventos/show");
  });

  it("pedido com check-in volta com a mensagem do bloqueio e atualiza a tela", async () => {
    mocks.refundPaidOrder.mockRejectedValue(
      new ActionError("Não é possível estornar: há ingresso com entrada registrada."),
    );
    expect(await refundOrder(orderId, reason)).toEqual({
      ok: false,
      error: "Não é possível estornar: há ingresso com entrada registrada.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/equipe/eventos/evento-1");
  });

  it("erro inesperado vira mensagem genérica", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.refundPaidOrder.mockRejectedValue(new Error("timeout 10.0.0.1"));
    expect(await refundOrder(orderId, reason)).toEqual({
      ok: false,
      error: "Não foi possível estornar o pedido.",
    });
  });

  it("pedido inexistente é recusado", async () => {
    mocks.adminFrom.mockImplementation(() => orderLookup(null));
    expect(await refundOrder(orderId, reason)).toEqual({
      ok: false,
      error: "Pedido não encontrado.",
    });
    expect(mocks.refundPaidOrder).not.toHaveBeenCalled();
  });
});
