import { createHmac, timingSafeEqual } from "node:crypto";

import type { PaymentProvider } from "./provider";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  OrderPaymentLookup,
  OrderReference,
  PixData,
  WebhookResult,
} from "./types";

type MercadoPagoOrderPayment = {
  id?: string;
  status?: string;
  status_detail?: string;
  date_of_expiration?: string | null;
  payment_method?: {
    id?: string | null;
    type?: string | null;
    qr_code?: string | null;
    qr_code_base64?: string | null;
  } | null;
};

type MercadoPagoOrder = {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string | number;
  total_paid_amount?: string | number;
  transactions?: { payments?: MercadoPagoOrderPayment[] } | null;
  errors?: Array<{ code?: string; message?: string; details?: string[] }>;
  message?: string;
  error?: string;
};

type MercadoPagoOptions = {
  accessToken?: string;
  webhookSecret?: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
};

const PIX_EXPIRATION = "PT30M";
/** Folga na busca por data para cobrir diferença de relógio entre servidores. */
const SEARCH_MARGIN_MS = 10 * 60_000;
const STATEMENT_DESCRIPTOR = "ESPACO BYLA";

const REJECTION_MESSAGES: Record<string, string> = {
  card_insufficient_amount:
    "Cartão sem limite suficiente. Tente outro cartão ou pague com PIX.",
  insufficient_amount:
    "Cartão sem limite suficiente. Tente outro cartão ou pague com PIX.",
  bad_filled_card_data:
    "Algum dado do cartão está incorreto. Confira e tente de novo.",
  invalid_card_token:
    "Não foi possível validar o cartão. Preencha os dados de novo.",
  required_call_for_authorize:
    "O banco pediu autorização. Ligue para o seu banco ou use outro cartão.",
  card_disabled:
    "Cartão desativado. Ative com o seu banco ou use outro cartão.",
  cc_rejected_duplicated_payment:
    "Já existe um pagamento igual recente. Aguarde ou use outro meio.",
  high_risk:
    "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX.",
  max_attempts_exceeded:
    "Limite de tentativas atingido. Use outro cartão ou pague com PIX.",
  invalid_installments:
    "Número de parcelas não aceito. Escolha outra opção.",
};

const DEFAULT_REJECTION =
  "Pagamento recusado. Tente outro cartão ou pague com PIX.";

export class MercadoPagoPaymentProvider implements PaymentProvider {
  readonly name = "mercadopago";
  private readonly accessToken?: string;
  private readonly webhookSecret?: string;
  private readonly apiBaseUrl: string;
  private readonly request: typeof fetch;

  constructor(options: MercadoPagoOptions = {}) {
    this.accessToken =
      options.accessToken ?? process.env.MERCADOPAGO_ACCESS_TOKEN;
    this.webhookSecret =
      options.webhookSecret ?? process.env.MERCADOPAGO_WEBHOOK_SECRET;
    this.apiBaseUrl = (
      options.apiBaseUrl ?? "https://api.mercadopago.com"
    ).replace(/\/$/, "");
    this.request = options.fetch ?? fetch;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertCreatePaymentInput(input);

    const amount = (input.amountCents / 100).toFixed(2);
    const isPix = input.paymentMethodId === "pix";
    const payment = isPix
      ? {
          amount,
          expiration_time: PIX_EXPIRATION,
          payment_method: { id: "pix", type: "bank_transfer" },
        }
      : {
          amount,
          payment_method: {
            id: input.paymentMethodId,
            type: input.cardType ?? "credit_card",
            token: input.cardToken,
            installments: input.installments ?? 1,
            statement_descriptor: STATEMENT_DESCRIPTOR,
          },
        };

    const body = {
      type: "online",
      processing_mode: "automatic",
      external_reference: input.orderId,
      total_amount: amount,
      description: input.description.slice(0, 256),
      payer: {
        email: input.payer.email,
        ...(input.payer.identification
          ? { identification: input.payer.identification }
          : {}),
      },
      transactions: { payments: [payment] },
    };

    const response = await this.request(`${this.apiBaseUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const order = (await response.json()) as MercadoPagoOrder & {
      data?: MercadoPagoOrder;
    };

    // 402: a order foi criada, mas a cobrança falhou (ex.: cartão recusado).
    // A order vem em `data` e o motivo também em `errors[].details`.
    if (response.status === 402) {
      const failed = order.data ?? order;
      return {
        status: "rejected",
        ...(failed.id ? { paymentId: failed.id } : {}),
        reason: rejectionReason({ ...failed, errors: order.errors }),
      };
    }

    if (!response.ok || !order.id) {
      const detail =
        order.errors?.[0]?.message || order.message || order.error;
      throw new Error(
        `Mercado Pago recusou o pagamento${detail ? `: ${detail}` : "."}`,
      );
    }

    if (order.status === "processed") {
      return { status: "approved", paymentId: order.id };
    }

    if (order.status === "failed") {
      return {
        status: "rejected",
        paymentId: order.id,
        reason: rejectionReason(order),
      };
    }

    const pix = pixFromOrder(order);
    return pix
      ? { status: "pending", paymentId: order.id, pix }
      : { status: "pending", paymentId: order.id };
  }

  async findOrderPayment(order: OrderReference): Promise<OrderPaymentLookup> {
    if (!this.accessToken) return { kind: "none" };

    const createdAt = Date.parse(order.createdAt);
    const begin = new Date(
      (Number.isFinite(createdAt) ? createdAt : Date.now()) - SEARCH_MARGIN_MS,
    );
    const end = new Date(Date.now() + SEARCH_MARGIN_MS);
    const params = new URLSearchParams({
      begin_date: begin.toISOString(),
      end_date: end.toISOString(),
      external_reference: order.id,
      sort_by: "created_date",
      sort_order: "desc",
    });
    const response = await this.request(
      `${this.apiBaseUrl}/v1/orders?${params.toString()}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    if (!response.ok) return { kind: "none" };

    const { data = [] } = (await response.json()) as {
      data?: MercadoPagoOrder[];
    };
    const own = data.filter(
      (found) => found.external_reference?.trim() === order.id,
    );

    const processed = own.find((found) => found.status === "processed");
    if (processed) {
      let amountCents = amountCentsFromOrder(processed);
      if (amountCents === null && processed.id) {
        amountCents = amountCentsFromOrder(await this.fetchOrder(processed.id));
      }
      return { kind: "paid", amountCents };
    }

    for (const found of own) {
      if (
        found.status !== "action_required" ||
        found.transactions?.payments?.[0]?.payment_method?.id !== "pix"
      ) {
        continue;
      }

      // A busca vem sem QR e sem validade; nesse caso a order completa é consultada.
      const full =
        pixFromOrder(found) || !found.id ? found : await this.fetchOrder(found.id);
      const pix = pixFromOrder(full);
      if (!pix) continue;

      const expiresAt = pix.expiresAt ? Date.parse(pix.expiresAt) : Number.NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) continue;

      return { kind: "pending_pix", pix };
    }

    return { kind: "none" };
  }

  async parseWebhook(req: Request): Promise<WebhookResult> {
    if (!this.accessToken) {
      return { kind: "ignored" };
    }

    const url = new URL(req.url);
    if (
      this.webhookSecret &&
      !isValidWebhookSignature(req.headers, url.searchParams.get("data.id"), this.webhookSecret)
    ) {
      return { kind: "invalid_signature" };
    }

    let orderId = url.searchParams.get("data.id") || undefined;
    let topic = url.searchParams.get("type") || undefined;

    if (!orderId || !topic) {
      try {
        const payload = (await req.json()) as {
          type?: string;
          data?: { id?: string | number };
        };
        if (!orderId && payload.data?.id != null) {
          orderId = String(payload.data.id);
        }
        topic ??= payload.type;
      } catch {
        return { kind: "ignored" };
      }
    }

    if (!orderId || topic !== "order") {
      return { kind: "ignored" };
    }

    // O aviso só diz qual order mudou; o status vem sempre da API.
    const order = await this.fetchOrder(orderId);
    const externalId = order?.external_reference?.trim();
    if (!order || !externalId) {
      return { kind: "ignored" };
    }

    // Recusa ou PIX expirado não cancelam o pedido: o comprador pode tentar de novo.
    if (order.status === "processed") {
      return { kind: "paid", externalId, amountCents: amountCentsFromOrder(order) };
    }

    return { kind: "ignored", externalId };
  }

  private async fetchOrder(orderId: string): Promise<MercadoPagoOrder | null> {
    const response = await this.request(
      `${this.apiBaseUrl}/v1/orders/${encodeURIComponent(orderId)}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as MercadoPagoOrder;
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

function rejectionReason(order: MercadoPagoOrder | null): string {
  const detail = order?.transactions?.payments?.[0]?.status_detail;
  if (detail && REJECTION_MESSAGES[detail]) return REJECTION_MESSAGES[detail];

  // Formato observado: { code: "failed", details: ["PAY01…: insufficient_amount"] }.
  for (const error of order?.errors ?? []) {
    for (const candidate of [error.code, ...(error.details ?? [])]) {
      const code = candidate?.split(":").pop()?.trim();
      if (code && REJECTION_MESSAGES[code]) {
        return REJECTION_MESSAGES[code];
      }
    }
  }
  return DEFAULT_REJECTION;
}

function amountCentsFromOrder(order: MercadoPagoOrder | null): number | null {
  const raw = order?.total_paid_amount ?? order?.total_amount;
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * Assinatura do aviso: HMAC-SHA256 de `id:{data.id};request-id:{x-request-id};ts:{ts};`
 * com a chave secreta do app (partes ausentes saem do texto). Orders assina o
 * data.id como veio; a doc antiga (Payments) pede minúsculas — aceitamos os dois.
 */
function isValidWebhookSignature(
  headers: Headers,
  dataId: string | null,
  secret: string,
): boolean {
  const signature = headers.get("x-signature") ?? "";
  const parts = new Map(
    signature.split(",").map((part) => {
      const [key, ...value] = part.split("=");
      return [key.trim(), value.join("=").trim()] as const;
    }),
  );
  const ts = parts.get("ts");
  const received = parts.get("v1");
  if (!ts || !received || !/^[0-9a-f]{64}$/i.test(received)) return false;

  const requestId = headers.get("x-request-id");
  const receivedBytes = Buffer.from(received, "hex");
  const ids = dataId ? [...new Set([dataId, dataId.toLowerCase()])] : [null];
  return ids.some((id) => {
    const manifest =
      (id ? `id:${id};` : "") +
      (requestId ? `request-id:${requestId};` : "") +
      `ts:${ts};`;
    const expected = createHmac("sha256", secret).update(manifest).digest();
    return timingSafeEqual(expected, receivedBytes);
  });
}

function pixFromOrder(order: MercadoPagoOrder | null): PixData | null {
  const payment = order?.transactions?.payments?.[0];
  const method = payment?.payment_method;
  if (!method?.qr_code || !method.qr_code_base64) return null;
  return {
    qrCode: method.qr_code,
    qrCodeBase64: method.qr_code_base64,
    ...(payment?.date_of_expiration
      ? { expiresAt: payment.date_of_expiration }
      : {}),
  };
}
