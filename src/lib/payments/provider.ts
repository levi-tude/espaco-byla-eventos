import { MercadoPagoPaymentProvider } from "./mercadopago";
import type {
  CancelChargesResult,
  CreatePaymentInput,
  CreatePaymentResult,
  OrderPaymentLookup,
  OrderReference,
  RefundOrderInput,
  RefundOrderResult,
  WebhookResult,
} from "./types";

export interface PaymentProvider {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Consulta o provedor pelo pedido (fallback quando o webhook não chega). */
  findOrderPayment(order: OrderReference): Promise<OrderPaymentLookup>;
  parseWebhook(req: Request): Promise<WebhookResult>;
  /** Estorno total da cobrança. Nunca lança por falha de rede: devolve `pending`. */
  refundOrder(input: RefundOrderInput): Promise<RefundOrderResult>;
  /** Cancela no provedor as cobranças ainda pagáveis do pedido (ex.: PIX gerado). Nunca lança. */
  cancelPendingCharges(order: OrderReference): Promise<CancelChargesResult>;
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
