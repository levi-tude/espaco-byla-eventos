import "server-only";

import { alertTeam } from "@/lib/alerts/team-alert";
import type { SupabaseAdmin } from "@/lib/domain/orders";
import { orderNumber } from "@/lib/domain/sessions";
import { getPaymentProvider, type PaymentProvider } from "@/lib/payments/provider";
import type { PaymentFeeLookup } from "@/lib/payments/types";

export type CaptureOutcome = "salvo" | "manual" | "ignorado" | "nao_encontrada" | "falhou";

type CaptureOptions = { afterRefund?: boolean; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LIMIT = 20;
const DEFAULT_BUDGET_MS = 25_000;
/** `orders_missing_fee` só devolve pedidos com menos de 5 tentativas: a 5ª é a última. */
const ALERT_AFTER_ATTEMPTS = 5;
/** Pedidos que chegaram a ser pagos (os mesmos de `order_has_bank_fee` no banco). */
const FEE_STATUSES = new Set(["pago", "estornado", "aguardando_decisao"]);
const RECORD_OUTCOMES = new Set<CaptureOutcome>(["salvo", "manual", "ignorado"]);

/** Desligada por padrão: só liga com PAYMENT_FEE_CAPTURE=on. */
export function isFeeCaptureEnabled(): boolean {
  return process.env.PAYMENT_FEE_CAPTURE?.trim() === "on";
}

type Attempt = { outcome: CaptureOutcome; attempts: number | null };

/**
 * Lê no banco de pagamento a tarifa real do pedido e grava pelo banco de dados.
 * Nunca lança e responde em até `timeoutMs` (padrão 5 s) na consulta ao provedor:
 * roda dentro da confirmação do pagamento, depois do e-mail dos ingressos.
 */
export async function capturePaymentFee(
  admin: SupabaseAdmin,
  provider: PaymentProvider,
  orderId: string,
  options: CaptureOptions = {},
): Promise<CaptureOutcome> {
  if (!isFeeCaptureEnabled()) return "ignorado";
  return (await attemptCapture(admin, provider, orderId, options)).outcome;
}

/** Para quem não tem o provedor em mãos (confirmação, aceite, aviso de estorno). Nunca lança. */
export async function captureOrderFee(
  admin: SupabaseAdmin,
  orderId: string,
  options: { afterRefund?: boolean } = {},
): Promise<CaptureOutcome> {
  if (!isFeeCaptureEnabled()) return "ignorado";
  let provider: PaymentProvider;
  try {
    provider = getPaymentProvider();
  } catch {
    console.error("[tarifa] Provedor de pagamento indisponível.", { orderId, code: "provedor" });
    return "falhou";
  }
  return capturePaymentFee(admin, provider, orderId, options);
}

/**
 * Cron diário: tenta de novo os pedidos sem tarifa (ou estornados sem nova consulta).
 * Para quando passa de `budgetMs`. Na 5ª tentativa sem sucesso avisa a equipe
 * (1 alerta por pedido por dia). Nunca lança.
 */
export async function captureMissingFees(
  admin: SupabaseAdmin,
  provider: PaymentProvider,
  options: { limit?: number; budgetMs?: number } = {},
): Promise<{ salvo: number; falhou: number; alertados: number }> {
  const totals = { salvo: 0, falhou: 0, alertados: 0 };
  if (!isFeeCaptureEnabled()) return totals;

  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = Date.now();
  let rows: unknown;
  try {
    const { data, error } = await admin.rpc("orders_missing_fee", {
      p_limit: options.limit ?? DEFAULT_LIMIT,
    });
    if (error) {
      console.error("[tarifa] Falha ao ler os pedidos sem tarifa.", { code: error.code ?? "db" });
      return totals;
    }
    rows = data;
  } catch {
    console.error("[tarifa] Falha ao ler os pedidos sem tarifa.", { code: "excecao" });
    return totals;
  }
  if (!Array.isArray(rows)) return totals;

  for (const row of rows as { order_id?: unknown; after_refund?: unknown }[]) {
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    if (typeof row?.order_id !== "string") continue;
    const orderId = row.order_id;

    const { outcome, attempts } = await attemptCapture(admin, provider, orderId, {
      afterRefund: row.after_refund === true,
      timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, remainingMs),
    });
    if (outcome === "salvo") totals.salvo += 1;
    if (outcome === "falhou" || outcome === "nao_encontrada") totals.falhou += 1;

    if (attempts !== null && attempts >= ALERT_AFTER_ATTEMPTS) {
      await alertTeam(
        admin,
        "tarifa_nao_encontrada",
        orderId,
        `Tarifa do pedido Nº ${orderNumber(orderId)} não encontrada; lance pelo extrato na página Repasses.`,
      );
      totals.alertados += 1;
    }
  }
  return totals;
}

/** `attempts`: contador devolvido pelo banco quando a tentativa falha e é registrada. */
async function attemptCapture(
  admin: SupabaseAdmin,
  provider: PaymentProvider,
  orderId: string,
  options: CaptureOptions,
): Promise<Attempt> {
  try {
    const { data: order, error } = await admin
      .from("orders")
      .select("id, created_at, provider_order_id, total_cents, status")
      .eq("id", orderId)
      .maybeSingle();
    if (error) {
      console.error("[tarifa] Falha ao ler o pedido.", { orderId, code: "db" });
      return { outcome: "falhou", attempts: null };
    }
    if (!order || !(order.total_cents > 0) || !FEE_STATUSES.has(order.status)) {
      return { outcome: "ignorado", attempts: null };
    }

    let lookup: PaymentFeeLookup;
    try {
      lookup = await lookupWithTimeout(
        provider,
        {
          id: order.id,
          createdAt: order.created_at,
          providerOrderId: order.provider_order_id ?? null,
          totalCents: order.total_cents,
        },
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    } catch {
      lookup = { kind: "error", code: "http" };
    }

    if (lookup.kind === "not_found") {
      return { outcome: "nao_encontrada", attempts: await recordFailure(admin, orderId, "not_found") };
    }
    if (lookup.kind === "error") {
      console.warn("[tarifa] Tarifa não lida no banco de pagamento.", { orderId, code: lookup.code });
      return { outcome: "falhou", attempts: await recordFailure(admin, orderId, lookup.code) };
    }

    const { fee } = lookup;
    const { data: saved, error: saveError } = await admin.rpc("record_payment_fee", {
      p_order_id: orderId,
      p_gross_cents: fee.grossCents,
      p_fee_cents: fee.feeCents,
      p_breakdown: fee.breakdown,
      p_release_date: fee.releaseDate,
      p_after_refund: options.afterRefund === true,
    });
    if (saveError) {
      if (saveError.message?.startsWith("TARIFA_VALOR")) {
        console.error("[tarifa] Valor lido não confere com o pedido.", { orderId, code: "valor" });
        await alertTeam(
          admin,
          "valor_divergente",
          orderId,
          "A tarifa lida no banco de pagamento não confere com o valor do pedido e não foi gravada. Confira o pagamento e lance a tarifa pelo extrato na página Repasses.",
        );
        return { outcome: "falhou", attempts: await recordFailure(admin, orderId, "valor") };
      }
      console.error("[tarifa] Falha ao gravar a tarifa.", { orderId, code: "db" });
      return { outcome: "falhou", attempts: null };
    }
    if (!RECORD_OUTCOMES.has(saved as CaptureOutcome)) {
      console.error("[tarifa] Resposta inesperada ao gravar a tarifa.", { orderId, code: "resposta" });
      return { outcome: "falhou", attempts: null };
    }
    return { outcome: saved as CaptureOutcome, attempts: null };
  } catch {
    console.error("[tarifa] Falha ao capturar a tarifa.", { orderId, code: "excecao" });
    return { outcome: "falhou", attempts: null };
  }
}

/** Aborta a consulta no tempo limite, mesmo que o provedor ignore o sinal. */
async function lookupWithTimeout(
  provider: PaymentProvider,
  order: Parameters<PaymentProvider["findPaymentFee"]>[0],
  timeoutMs: number,
): Promise<PaymentFeeLookup> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PaymentFeeLookup>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "error", code: "timeout" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      provider.findPaymentFee(order, { signal: controller.signal }),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Registra a tentativa sem sucesso; devolve o contador do banco (null se não gravou). */
async function recordFailure(
  admin: SupabaseAdmin,
  orderId: string,
  code: string,
): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc("record_payment_fee_failure", {
      p_order_id: orderId,
      p_code: code,
    });
    if (error || typeof data !== "number") {
      console.error("[tarifa] Falha ao registrar a tentativa.", { orderId, code: "db" });
      return null;
    }
    return data;
  } catch {
    console.error("[tarifa] Falha ao registrar a tentativa.", { orderId, code: "excecao" });
    return null;
  }
}
