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
  | { kind: "ignored"; externalId?: string }
  | { kind: "invalid_signature" };

export type OrderPaymentLookup =
  | ({ kind: "paid"; amountCents: number | null } & ProviderIds)
  | { kind: "pending_pix"; pix: PixData }
  | { kind: "none" };
