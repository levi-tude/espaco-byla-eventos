import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentProvider } from "./provider";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  WebhookResult,
} from "./types";

type PagBankWebhook = {
  id?: unknown;
  reference_id?: unknown;
  status?: unknown;
  charges?: Array<{ status?: unknown }>;
};

type PagBankCheckoutResponse = {
  id?: string;
  links?: Array<{ rel?: string; href?: string }>;
  error_messages?: Array<{ description?: string }>;
};

type PagBankOptions = {
  token?: string;
  apiUrl?: string;
  appUrl?: string;
  fetch?: typeof fetch;
};

export class PagBankPaymentProvider implements PaymentProvider {
  readonly name = "pagbank";
  private readonly token?: string;
  private readonly apiUrl: string;
  private readonly appUrl?: string;
  private readonly request: typeof fetch;

  constructor(options: PagBankOptions = {}) {
    this.token = options.token ?? process.env.PAGBANK_TOKEN;
    this.apiUrl = (
      options.apiUrl ??
      process.env.PAGBANK_API_URL ??
      "https://sandbox.api.pagseguro.com"
    ).replace(/\/$/, "");
    this.appUrl = (options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL)?.replace(
      /\/$/,
      "",
    );
    this.request = options.fetch ?? fetch;
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    if (!this.token) {
      throw new Error(
        "PAGBANK_TOKEN não configurado. Adicione a credencial do sandbox em .env.local.",
      );
    }
    if (!this.appUrl) {
      throw new Error("NEXT_PUBLIC_APP_URL não configurada.");
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error("O valor do pagamento deve ser positivo e em centavos.");
    }

    const webhookUrl = `${this.appUrl}/api/payments/webhook`;
    const response = await this.request(`${this.apiUrl}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference_id: input.orderId,
        customer: { email: input.buyerEmail },
        customer_modifiable: true,
        items: [
          {
            reference_id: input.orderId,
            name: input.description.slice(0, 100),
            quantity: 1,
            unit_amount: input.amountCents,
          },
        ],
        payment_methods: [{ type: "PIX" }],
        redirect_url: input.successUrl,
        return_url: input.failureUrl,
        notification_urls: [webhookUrl],
        payment_notification_urls: [webhookUrl],
      }),
    });

    const body = (await response.json()) as PagBankCheckoutResponse;
    const checkoutUrl = body.links?.find((link) => link.rel === "PAY")?.href;

    if (!response.ok || !body.id || !checkoutUrl) {
      const detail = body.error_messages?.[0]?.description;
      throw new Error(
        `Não foi possível criar o checkout no PagBank${detail ? `: ${detail}` : "."}`,
      );
    }

    // O reference_id volta no webhook e permite localizar o pedido sem
    // depender do ID da cobrança, que só é criado após abrir o checkout.
    return { externalId: input.orderId, checkoutUrl };
  }

  async parseWebhook(req: Request): Promise<WebhookResult> {
    const rawBody = await req.text();

    if (this.token && !this.hasValidSignature(req, rawBody)) {
      return { kind: "ignored" };
    }

    let payload: PagBankWebhook;
    try {
      payload = JSON.parse(rawBody) as PagBankWebhook;
    } catch {
      return { kind: "ignored" };
    }

    const externalId =
      typeof payload.reference_id === "string"
        ? payload.reference_id
        : undefined;
    if (!externalId) {
      return { kind: "ignored" };
    }

    const statuses = [
      payload.status,
      ...(Array.isArray(payload.charges)
        ? payload.charges.map((charge) => charge.status)
        : []),
    ];

    if (statuses.includes("PAID")) {
      return { kind: "paid", externalId };
    }
    if (
      statuses.some((status) =>
        ["CANCELED", "DECLINED", "EXPIRED"].includes(String(status)),
      )
    ) {
      return { kind: "cancelled", externalId };
    }

    return { kind: "ignored", externalId };
  }

  private hasValidSignature(req: Request, rawBody: string): boolean {
    const received = req.headers.get("x-authenticity-token");
    if (!received || !this.token) return false;

    const expected = createHash("sha256")
      .update(`${this.token}-${rawBody}`)
      .digest("hex");
    const receivedBuffer = Buffer.from(received, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    return (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  }
}
