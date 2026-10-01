/** Campos da order do Mercado Pago (API de Orders) usados para decidir o estado. */
export type ClassifiableOrder = {
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: ReadonlyArray<{ payment_method?: { id?: string | null } | null }>;
    refunds?: ReadonlyArray<{ status?: string }>;
  } | null;
};

export type OrderClassification =
  | "paid"
  | "refunded"
  | "pending_pix"
  | "failed"
  | "other";

const REFUNDED_DETAILS = new Set(["refunded", "partially_refunded"]);

/**
 * A doc mostra o estorno como `processed/refunded` e também `refunded/refunded`;
 * as duas formas (e reembolsos processados na lista) contam como estornada.
 * Só `processed` sem estorno é pago.
 */
export function classifyMercadoPagoOrder(
  order: ClassifiableOrder | null | undefined,
): OrderClassification {
  if (!order) return "other";

  const refunded =
    order.status === "refunded" ||
    REFUNDED_DETAILS.has(order.status_detail ?? "") ||
    (order.transactions?.refunds ?? []).some(
      (refund) => refund?.status === "processed",
    );
  if (refunded) return "refunded";

  if (order.status === "processed") return "paid";
  if (order.status === "failed") return "failed";
  if (
    order.status === "action_required" &&
    order.transactions?.payments?.[0]?.payment_method?.id === "pix"
  ) {
    return "pending_pix";
  }
  return "other";
}
