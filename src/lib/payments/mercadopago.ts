import type { PaymentProvider } from "./provider";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  OrderPaymentLookup,
  PixData,
  WebhookResult,
} from "./types";

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  payment_method_id?: string;
  external_reference?: string;
  date_of_expiration?: string | null;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string };
  };
  message?: string;
  error?: string;
  cause?: Array<{ description?: string; code?: string | number }>;
};

type MercadoPagoOptions = {
  accessToken?: string;
  appUrl?: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
};

const PIX_EXPIRATION_MINUTES = 30;

const REJECTION_MESSAGES: Record<string, string> = {
  cc_rejected_insufficient_amount:
    "Cartão sem limite suficiente. Tente outro cartão ou pague com PIX.",
  cc_rejected_bad_filled_security_code:
    "Código de segurança (CVV) inválido. Confira e tente de novo.",
  cc_rejected_bad_filled_date:
    "Data de validade inválida. Confira e tente de novo.",
  cc_rejected_bad_filled_card_number:
    "Número do cartão inválido. Confira e tente de novo.",
  cc_rejected_bad_filled_other:
    "Algum dado do cartão está incorreto. Confira e tente de novo.",
  cc_rejected_call_for_authorize:
    "O banco pediu autorização. Ligue para o seu banco ou use outro cartão.",
  cc_rejected_card_disabled:
    "Cartão desativado. Ative com o seu banco ou use outro cartão.",
  cc_rejected_duplicated_payment:
    "Já existe um pagamento igual recente. Aguarde ou use outro meio.",
  cc_rejected_high_risk:
    "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX.",
  cc_rejected_max_attempts:
    "Limite de tentativas atingido. Use outro cartão ou pague com PIX.",
};

const DEFAULT_REJECTION =
  "Pagamento recusado. Tente outro cartão ou pague com PIX.";

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

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertCreatePaymentInput(input);

    const isPix = input.paymentMethodId === "pix";
    const body: Record<string, unknown> = {
      transaction_amount: Number((input.amountCents / 100).toFixed(2)),
      description: input.description.slice(0, 256),
      payment_method_id: input.paymentMethodId,
      external_reference: input.orderId,
      statement_descriptor: "ESPACO BYLA",
      payer: {
        email: input.payer.email,
        ...(input.payer.identification
          ? { identification: input.payer.identification }
          : {}),
      },
    };

    if (isPix) {
      body.date_of_expiration = pixExpiration(new Date());
    } else {
      body.token = input.cardToken;
      body.installments = input.installments ?? 1;
      if (input.issuerId) body.issuer_id = input.issuerId;
    }

    // Sem https público (ex.: localhost) o site confirma consultando o pedido.
    if (this.appUrl && isPublicHttpsUrl(this.appUrl)) {
      body.notification_url = `${this.appUrl}/api/payments/webhook`;
    }

    const response = await this.request(`${this.apiBaseUrl}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const payment = (await response.json()) as MercadoPagoPayment;

    if (!response.ok || payment.id == null) {
      const detail =
        payment.cause?.[0]?.description || payment.message || payment.error;
      throw new Error(
        `Mercado Pago recusou o pagamento${detail ? `: ${detail}` : "."}`,
      );
    }

    const paymentId = String(payment.id);

    if (payment.status === "approved") {
      return { status: "approved", paymentId };
    }

    if (payment.status === "pending" || payment.status === "in_process") {
      const pix = pixFromPayment(payment);
      return pix
        ? { status: "pending", paymentId, pix }
        : { status: "pending", paymentId };
    }

    return {
      status: "rejected",
      paymentId,
      reason:
        (payment.status_detail && REJECTION_MESSAGES[payment.status_detail]) ||
        DEFAULT_REJECTION,
    };
  }

  async findOrderPayment(orderId: string): Promise<OrderPaymentLookup> {
    if (!this.accessToken) return { kind: "none" };

    const params = new URLSearchParams({
      external_reference: orderId,
      sort: "date_created",
      criteria: "desc",
    });
    const response = await this.request(
      `${this.apiBaseUrl}/v1/payments/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if (!response.ok) return { kind: "none" };

    const { results = [] } = (await response.json()) as {
      results?: MercadoPagoPayment[];
    };
    const own = results.filter(
      (payment) => payment.external_reference?.trim() === orderId,
    );

    if (own.some((payment) => payment.status === "approved")) {
      return { kind: "paid" };
    }

    const now = Date.now();
    for (const payment of own) {
      if (payment.status !== "pending" || payment.payment_method_id !== "pix") {
        continue;
      }
      const expiresAt = payment.date_of_expiration
        ? Date.parse(payment.date_of_expiration)
        : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= now) continue;

      const pix = pixFromPayment(payment);
      if (pix) return { kind: "pending_pix", pix };
    }

    return { kind: "none" };
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
      return { kind: "ignored" };
    }

    const payment = await this.fetchPayment(paymentId);
    const externalId = payment?.external_reference?.trim();
    if (!payment || !externalId) {
      return { kind: "ignored" };
    }

    // Recusa ou PIX expirado não cancelam o pedido: o comprador pode tentar de novo.
    if (payment.status === "approved") {
      return { kind: "paid", externalId };
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
        "MERCADOPAGO_ACCESS_TOKEN não configurado. Adicione a credencial em .env.local.",
      );
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("O valor do pagamento deve ser positivo e em centavos.");
    }
    if (input.paymentMethodId !== "pix" && !input.cardToken) {
      throw new Error("Dados do cartão ausentes. Preencha o cartão novamente.");
    }
  }
}

function pixFromPayment(payment: MercadoPagoPayment): PixData | null {
  const data = payment.point_of_interaction?.transaction_data;
  if (!data?.qr_code || !data.qr_code_base64) return null;
  return {
    qrCode: data.qr_code,
    qrCodeBase64: data.qr_code_base64,
    ...(payment.date_of_expiration
      ? { expiresAt: payment.date_of_expiration }
      : {}),
  };
}

function pixExpiration(now: Date): string {
  const expires = new Date(now.getTime() + PIX_EXPIRATION_MINUTES * 60_000);
  return expires.toISOString().replace("Z", "+00:00");
}

function isPublicHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}
