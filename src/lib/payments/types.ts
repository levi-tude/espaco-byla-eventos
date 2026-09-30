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

export type PixData = {
  qrCode: string;
  qrCodeBase64: string;
  expiresAt?: string;
};

export type CreatePaymentResult =
  | { status: "approved"; paymentId: string }
  | { status: "pending"; paymentId: string; pix?: PixData }
  | { status: "rejected"; paymentId?: string; reason: string };

export type WebhookResult =
  | { kind: "paid"; externalId: string }
  | { kind: "ignored"; externalId?: string };

export type OrderPaymentLookup =
  | { kind: "paid" }
  | { kind: "pending_pix"; pix: PixData }
  | { kind: "none" };
