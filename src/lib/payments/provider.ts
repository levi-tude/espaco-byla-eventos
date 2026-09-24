import { MercadoPagoPaymentProvider } from "./mercadopago";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  WebhookResult,
} from "./types";

export interface PaymentProvider {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  reconcileCheckout?(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult | null>;
  /** Confirma pagamento pelo id do redirect (fallback se o webhook falhar). */
  confirmPayment?(paymentId: string): Promise<WebhookResult>;
  parseWebhook(req: Request): Promise<WebhookResult>;
}

export function getPaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? "mercadopago";

  if (provider === "mercadopago") {
    return new MercadoPagoPaymentProvider();
  }

  throw new Error(
    `Provedor de pagamento não suportado: "${provider}". Use PAYMENT_PROVIDER=mercadopago.`,
  );
}
