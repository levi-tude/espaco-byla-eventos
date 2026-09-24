import type { PaymentProvider } from "./provider";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  WebhookResult,
} from "./types";

type PreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
  message?: string;
  error?: string;
  cause?: Array<{ description?: string; code?: string }>;
};

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  external_reference?: string;
};

type MercadoPagoOptions = {
  accessToken?: string;
  appUrl?: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
};

export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = "mercadopago";
  private readonly accessToken?: string;
  private readonly appUrl?: string;
  private readonly apiBaseUrl: string;
  private readonly request: typeof fetch;

  constructor(options: MercadoPagoOptions = {}) {
    this.accessToken =
      options.accessToken ?? process.env.MERCADOPAGO_ACCESS_TOKEN;
    this.appUrl = (options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL)?.replace(
      /\/$/,
      "",
    );
    this.apiBaseUrl = (
      options.apiBaseUrl ?? "https://api.mercadopago.com"
    ).replace(/\/$/, "");
    this.request = options.fetch ?? fetch;
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    this.assertCreatePaymentInput(input);

    const unitPrice = Number((input.amountCents / 100).toFixed(2));
    const notificationUrl = `${this.appUrl}/api/payments/webhook`;

    const response = await this.request(
      `${this.apiBaseUrl}/checkout/preferences`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          external_reference: input.orderId,
          items: [
            {
              id: input.orderId,
              title: input.description.slice(0, 256),
              quantity: 1,
              currency_id: "BRL",
              unit_price: unitPrice,
            },
          ],
          payer: { email: input.buyerEmail },
          back_urls: {
            success: input.successUrl,
            failure: input.failureUrl,
            pending: input.successUrl,
          },
          auto_return: "approved",
          notification_url: notificationUrl,
          statement_descriptor: "ESPACO BYLA",
        }),
      },
    );

    const body = (await response.json()) as PreferenceResponse;
    // Checkout Pro: usar sempre init_point (sandbox_init_point foi descontinuado
    // e pode deixar a tela de pagamento carregando para sempre).
    const checkoutUrl = body.init_point;

    if (!response.ok || !body.id || !checkoutUrl) {
      const detail =
        body.cause?.[0]?.description || body.message || body.error;
      throw new Error(
        `Não foi possível criar o checkout no Mercado Pago${detail ? `: ${detail}` : "."}`,
      );
    }

    // external_reference (= orderId) volta no pagamento e no webhook
    return { externalId: input.orderId, checkoutUrl };
  }

  /** Confirma pagamento pelo id do redirect (quando o webhook atrasa ou falha). */
  async confirmPayment(paymentId: string): Promise<WebhookResult> {
    if (!this.accessToken || !paymentId.trim()) {
      return { kind: "ignored" };
    }
    return this.resultFromPayment(await this.fetchPayment(paymentId.trim()));
  }

  async parseWebhook(req: Request): Promise<WebhookResult> {
    if (!this.accessToken) {
      return { kind: "ignored" };
    }

    const url = new URL(req.url);
    let paymentId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id") ||
      undefined;

    const topic =
      url.searchParams.get("type") ||
      url.searchParams.get("topic") ||
      undefined;

    if (!paymentId) {
      try {
        const payload = (await req.json()) as {
          type?: string;
          action?: string;
          data?: { id?: string | number };
        };
        if (payload.data?.id != null) {
          paymentId = String(payload.data.id);
        }
        if (
          payload.type &&
          payload.type !== "payment" &&
          !payload.action?.includes("payment")
        ) {
          return { kind: "ignored" };
        }
      } catch {
        return { kind: "ignored" };
      }
    }

    if (!paymentId) {
      return { kind: "ignored" };
    }

    if (topic && topic !== "payment" && !topic.includes("payment")) {
      return { kind: "ignored", externalId: undefined };
    }

    return this.resultFromPayment(await this.fetchPayment(paymentId));
  }

  private resultFromPayment(
    payment: MercadoPagoPayment | null,
  ): WebhookResult {
    if (!payment) {
      return { kind: "ignored" };
    }

    const externalId =
      typeof payment.external_reference === "string" &&
      payment.external_reference.trim()
        ? payment.external_reference.trim()
        : undefined;

    if (!externalId) {
      return { kind: "ignored" };
    }

    if (payment.status === "approved") {
      return { kind: "paid", externalId };
    }

    if (
      payment.status === "cancelled" ||
      payment.status === "rejected" ||
      payment.status === "refunded"
    ) {
      return { kind: "cancelled", externalId };
    }

    return { kind: "ignored", externalId };
  }

  private async fetchPayment(
    paymentId: string,
  ): Promise<MercadoPagoPayment | null> {
    const response = await this.request(
      `${this.apiBaseUrl}/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as MercadoPagoPayment;
  }

  private assertCreatePaymentInput(input: CreatePaymentInput): void {
    if (!this.accessToken) {
      throw new Error(
        "MERCADOPAGO_ACCESS_TOKEN não configurado. Adicione a credencial de teste em .env.local.",
      );
    }
    if (!this.appUrl) {
      throw new Error("NEXT_PUBLIC_APP_URL não configurada.");
    }
    if (!this.isPublicHttpsUrl(this.appUrl)) {
      throw new Error(
        "O Mercado Pago precisa de URL pública https em NEXT_PUBLIC_APP_URL (ex.: túnel ngrok). Reinicie o servidor depois de alterar.",
      );
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("O valor do pagamento deve ser positivo e em centavos.");
    }
  }

  private isPublicHttpsUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
    } catch {
      return false;
    }
  }
}
