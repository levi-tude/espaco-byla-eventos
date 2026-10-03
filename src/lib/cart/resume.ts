/** Pedidos que podem preencher de novo o checkout (`?retomar=<token>`). */
const RESUMABLE_STATUSES = new Set(["pendente", "cancelado", "expirado"]);

export type CheckoutResume = {
  publicToken: string;
  /** Unidades por id de tipo de ingresso. */
  quantities: Record<string, number>;
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

type ResumableItem = { ticket_type_id: string; quantity: number };

/**
 * Monta os valores iniciais do checkout a partir de um pedido não pago do mesmo
 * evento. As quantidades ainda passam pelos limites na tela, e o banco revalida
 * tudo ao criar o novo pedido.
 */
export function buildCheckoutResume({
  order,
  items,
  offeredTypeIds,
  now = Date.now(),
}: {
  order: ResumableOrder;
  items: readonly ResumableItem[];
  offeredTypeIds: readonly string[];
  now?: number;
}): CheckoutResume | null {
  if (!RESUMABLE_STATUSES.has(order.status)) return null;

  const quantities: Record<string, number> = {};
  let droppedItems = false;
  for (const item of items) {
    if (offeredTypeIds.includes(item.ticket_type_id)) {
      quantities[item.ticket_type_id] =
        (quantities[item.ticket_type_id] ?? 0) + item.quantity;
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
