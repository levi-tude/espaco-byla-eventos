import { PagBankPaymentProvider } from "./pagbank";
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
  parseWebhook(req: Request): Promise<WebhookResult>;
}

export function getPaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? "pagbank";

  if (provider === "pagbank") {
    return new PagBankPaymentProvider();
  }

  throw new Error(
    `Provedor de pagamento não suportado: "${provider}". Use PAYMENT_PROVIDER=pagbank.`,
  );
}
