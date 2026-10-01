import type { CartKind } from "@/lib/cart/browser-cart";

/** Pedidos que podem preencher de novo o checkout (`?retomar=<token>`). */
const RESUMABLE_STATUSES = new Set(["pendente", "cancelado", "expirado"]);

export type CheckoutResume = {
  publicToken: string;
  quantities: Record<CartKind, number>;
  buyer: { name: string; email: string; phone: string };
  /** Algum item do pedido não está mais à venda e ficou de fora. */
  droppedItems: boolean;
  /** Fim da reserva quando o pedido ainda aguarda pagamento; senão `null`. */
  awaitingUntil: string | null;
};

type ResumableOrder = {
  status: string;
  public_token: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  expires_at: string | null;
};

/**
 * Monta os valores iniciais do checkout a partir de um pedido não pago do mesmo
 * evento. As quantidades ainda passam pelo limite de lugares na tela, e o banco
 * revalida tudo ao criar o novo pedido.
 */
export function buildCheckoutResume({
  order,
  ticketKinds,
  offeredKinds,
  now = Date.now(),
}: {
  order: ResumableOrder;
  ticketKinds: readonly string[];
  offeredKinds: readonly CartKind[];
  now?: number;
}): CheckoutResume | null {
  if (!RESUMABLE_STATUSES.has(order.status)) return null;

  const quantities: Record<CartKind, number> = { inteira: 0, meia: 0 };
  let droppedItems = false;
  for (const kind of ticketKinds) {
    if ((offeredKinds as readonly string[]).includes(kind)) {
      quantities[kind as CartKind] += 1;
    } else {
      droppedItems = true;
    }
  }

  const expiresAt = order.expires_at ? Date.parse(order.expires_at) : Number.NaN;
  const awaiting =
    order.status === "pendente" && Number.isFinite(expiresAt) && expiresAt > now;

  return {
    publicToken: order.public_token,
    quantities,
    buyer: {
      name: order.buyer_name,
      email: order.buyer_email,
      phone: order.buyer_phone ?? "",
    },
    droppedItems,
    awaitingUntil: awaiting ? order.expires_at : null,
  };
}
