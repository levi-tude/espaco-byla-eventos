import { MercadoPagoPaymentProvider } from "./mercadopago";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  OrderPaymentLookup,
  WebhookResult,
} from "./types";

export interface PaymentProvider {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Consulta o provedor pelo pedido (fallback quando o webhook não chega). */
  findOrderPayment(orderId: string): Promise<OrderPaymentLookup>;
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
