export type CreatePaymentInput = {
  orderId: string;
  amountCents: number;
  description: string;
  buyerEmail: string;
  successUrl: string;
  failureUrl: string;
};

export type CreatePaymentResult = {
  externalId: string;
  checkoutUrl: string;
};

export type WebhookResult =
  | { kind: "paid"; externalId: string }
  | { kind: "cancelled" | "ignored"; externalId?: string };
