import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { orderNumber } from "@/lib/domain/sessions";
import { notifyOrganizer, organizerNoticeLink } from "@/lib/organizer/notify";

/**
 * Pedido estornado num evento de organizador: um único aviso por pedido (o banco marca
 * antes de devolver a linha). Se foi o organizador quem pediu, a resposta do pedido;
 * senão, o aviso de estorno. Nunca lança: o estorno já aconteceu.
 */
export async function notifyOrganizerOrderRefunded(admin: SupabaseAdmin, orderId: string): Promise<void> {
  try {
    const { data: requests, error } = await admin.rpc("claim_refund_request_notice", { p_order_id: orderId });
    if (error) {
      console.error("[estorno] Falha ao conferir pedido de estorno do organizador.", error.code ?? "sem-codigo");
      return;
    }
    if (requests && requests.length > 0) {
      for (const request of requests) {
        await notifyOrganizer(request.requested_by, "org_pedido_respondido", {
          eventName: request.event_name,
          requestKind: "estorno",
          outcome: "atendido",
          link: organizerNoticeLink(`/organizador/eventos/${request.event_id}?aba=financeiro`),
        });
      }
      return;
    }

    const { data: events, error: eventError } = await admin.rpc("claim_event_refund_notice", { p_order_id: orderId });
    if (eventError) {
      console.error("[estorno] Falha ao registrar o aviso de estorno ao organizador.", eventError.code ?? "sem-codigo");
      return;
    }
    const row = events?.[0];
    if (!row) return;
    await notifyOrganizer(row.organizer_id, "org_pedido_estornado", {
      eventName: row.event_name,
      orderNumber: orderNumber(orderId),
      link: organizerNoticeLink(`/organizador/eventos/${row.event_id}?aba=financeiro`),
    });
  } catch (error) {
    console.error(
      "[estorno] Falha ao avisar o organizador do estorno.",
      error instanceof Error ? error.name : "desconhecido",
    );
  }
}
