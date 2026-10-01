import "server-only";

import type { SupabaseAdmin } from "@/lib/domain/orders";
import { PIX_EXPIRATION_MINUTES } from "@/lib/payments/mercadopago";
import type { PixData } from "@/lib/payments/types";

/**
 * Estende a reserva do pedido até o vencimento do PIX (regra e teto no banco,
 * uma vez só). Sem a data do PIX, usa a validade pedida ao provedor.
 * Devolve o novo fim da reserva, ou `null` se não foi possível; nunca lança.
 */
export async function extendHoldForPix(
  admin: SupabaseAdmin,
  orderId: string,
  pix: PixData,
): Promise<string | null> {
  const informed = pix.expiresAt ? Date.parse(pix.expiresAt) : Number.NaN;
  const pixExpiresAt = Number.isFinite(informed)
    ? new Date(informed)
    : new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000);

  try {
    const { data, error } = await admin.rpc("extend_order_hold_for_pix", {
      p_order_id: orderId,
      p_pix_expires_at: pixExpiresAt.toISOString(),
    });
    if (error) {
      console.error("[pagamento] Falha ao estender a reserva pelo PIX.", { orderId });
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error("[pagamento] Falha ao estender a reserva pelo PIX.", { orderId, error });
    return null;
  }
}
