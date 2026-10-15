import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notifyOrganizer: vi.fn(), rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/organizer/notify", () => ({
  notifyOrganizer: mocks.notifyOrganizer,
  organizerNoticeLink: (path: string) => `https://ingressos.exemplo.com${path}`,
}));

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { notifyOrganizerOrderRefunded } from "@/lib/organizer/refund-notice";

const orderId = "abcdef12-0000-4000-8000-000000000010";
const organizerId = "00000000-0000-4000-8000-0000000000aa";
const eventId = "00000000-0000-4000-8000-000000000001";
const admin = { rpc: mocks.rpc } as unknown as SupabaseAdmin;

function rpcResults(results: Record<string, { data?: unknown; error?: unknown }>) {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: results[name]?.data ?? [],
    error: results[name]?.error ?? null,
  }));
}

describe("notifyOrganizerOrderRefunded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyOrganizer.mockResolvedValue("sent");
  });

  it("estorno pedido pelo organizador vira resposta do pedido, sem segundo aviso", async () => {
    rpcResults({
      claim_refund_request_notice: {
        data: [{ request_id: "r-1", requested_by: organizerId, event_id: eventId, event_name: "Peça Y" }],
      },
    });
    await notifyOrganizerOrderRefunded(admin, orderId);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_refund_request_notice", { p_order_id: orderId });
    expect(mocks.rpc).not.toHaveBeenCalledWith("claim_event_refund_notice", expect.anything());
    expect(mocks.notifyOrganizer).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(organizerId, "org_pedido_respondido", {
      eventName: "Peça Y",
      requestKind: "estorno",
      outcome: "atendido",
      link: `https://ingressos.exemplo.com/organizador/eventos/${eventId}?aba=financeiro`,
    });
  });

  it("estorno feito pela equipe por conta própria avisa com o número do pedido", async () => {
    rpcResults({
      claim_event_refund_notice: {
        data: [{ organizer_id: organizerId, event_id: eventId, event_name: "Peça Y" }],
      },
    });
    await notifyOrganizerOrderRefunded(admin, orderId);
    expect(mocks.notifyOrganizer).toHaveBeenCalledWith(organizerId, "org_pedido_estornado", {
      eventName: "Peça Y",
      orderNumber: "ABCDEF12",
      link: `https://ingressos.exemplo.com/organizador/eventos/${eventId}?aba=financeiro`,
    });
  });

  it("aviso já registrado (ou evento do Espaço) não manda nada", async () => {
    rpcResults({});
    await notifyOrganizerOrderRefunded(admin, orderId);
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
  });

  it("falha no banco ou no envio nunca lança e não loga dados", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResults({ claim_refund_request_notice: { error: { code: "57014" } } });
    await expect(notifyOrganizerOrderRefunded(admin, orderId)).resolves.toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalledWith("claim_event_refund_notice", expect.anything());

    rpcResults({ claim_event_refund_notice: { error: { code: "57014" } } });
    await expect(notifyOrganizerOrderRefunded(admin, orderId)).resolves.toBeUndefined();

    mocks.rpc.mockRejectedValue(new Error("rede caiu"));
    await expect(notifyOrganizerOrderRefunded(admin, orderId)).resolves.toBeUndefined();
    expect(mocks.notifyOrganizer).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Peça Y|@|abcdef12/i);
  });
});
