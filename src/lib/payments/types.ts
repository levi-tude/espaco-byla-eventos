export type CardPaymentType = "credit_card" | "debit_card";

export type CreatePaymentInput = {
  orderId: string;
  amountCents: number;
  description: string;
  paymentMethodId: string;
  payer: {
    email: string;
    identification?: { type: string; number: string };
  };
  /** Token do cartão gerado no navegador (ausente no PIX). */
  cardToken?: string;
  cardType?: CardPaymentType;
  installments?: number;
};

/** Pedido do site usado para localizar cobranças no provedor. */
export type OrderReference = {
  id: string;
  createdAt: string;
};

/** IDs da cobrança no provedor (order ORD… e pagamento PAY… no Mercado Pago). */
export type ProviderIds = {
  providerOrderId?: string;
  providerPaymentId?: string;
};

export type PixData = {
  qrCode: string;
  qrCodeBase64: string;
  expiresAt?: string;
};

export type CreatePaymentResult =
  | ({ status: "approved"; paymentId: string } & ProviderIds)
  | { status: "pending"; paymentId: string; pix?: PixData }
  | { status: "rejected"; paymentId?: string; reason: string };

export type WebhookResult =
  | ({ kind: "paid"; externalId: string; amountCents: number | null } & ProviderIds)
  | { kind: "refunded"; externalId: string; providerOrderId?: string }
  | { kind: "ignored"; externalId?: string }
  | { kind: "invalid_signature" }
  /** Sem a chave secreta não há como validar o aviso: ele é recusado. */
  | { kind: "not_configured" };

export type RefundOrderInput = {
  providerOrderId: string;
  /** Chave guardada no banco: a mesma em toda nova tentativa do mesmo estorno. */
  idempotencyKey: string;
};

/**
 * `pending`: resposta incerta (rede, 5xx, estorno em processamento); tentar de novo
 * com a mesma chave. `rejected`: recusa definitiva, com o código do provedor.
 */
export type RefundOrderResult =
  | { status: "refunded"; providerRefundId?: string }
  | { status: "pending" }
  | { status: "rejected"; code: string };

export type OrderPaymentLookup =
  | ({ kind: "paid"; amountCents: number | null } & ProviderIds)
  | { kind: "pending_pix"; pix: PixData }
  | { kind: "none" };

/** Tarifa real de um pagamento, lida no provedor (centavos inteiros). */
export type PaymentFee = {
  grossCents: number;
  feeCents: number;
  breakdown: { type: string; cents: number }[];
  releaseDate: string | null; // YYYY-MM-DD
  refunded: boolean;
};

/** Pedido do site com o que é preciso para achar o pagamento e conferir o valor. */
export type PaymentFeeOrder = OrderReference & {
  providerOrderId: string | null;
  totalCents: number;
};

export type PaymentFeeLookup =
  | { kind: "found"; fee: PaymentFee }
  | { kind: "not_found" }
  | { kind: "error"; code: "timeout" | "http" | "parse" | "ambiguous" };

/**
 * Resultado de encerrar as cobranças em aberto de um pedido antes de cancelá-lo.
 * `paid`: já há pagamento aprovado (confirmar, não cancelar). `processing`: há
 * pagamento em análise. `cleared`: nenhuma cobrança pode mais ser paga.
 * `unavailable`: não foi possível consultar ou confirmar o cancelamento.
 */
export type CancelChargesResult =
  | ({ kind: "paid"; amountCents: number | null } & ProviderIds)
  | { kind: "processing" }
  | { kind: "cleared" }
  | { kind: "unavailable" };
