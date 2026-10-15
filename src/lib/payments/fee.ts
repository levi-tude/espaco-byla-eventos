import type { PaymentFee } from "./types";

const MAX_BREAKDOWN_ITEMS = 10;
const MAX_TYPE_LENGTH = 40;
const FEE_TYPE_PATTERN = /^[a-z_]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REFUNDED_STATUSES = new Set(["refunded", "charged_back"]);
/** Pagamentos em que o dinheiro chegou a entrar (inclusive os estornados depois). */
const CAPTURED_STATUSES = new Set(["approved", "refunded", "charged_back", "in_mediation"]);

type JsonObject = { [key: string]: unknown };

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Só aceita número finito e não negativo (texto da API é recusado). */
function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Tarifa do lado do vendedor = bruto − líquido. O detalhamento (`fee_details` do
 * vendedor) é só informativo e não precisa somar a tarifa. Valores fora do
 * esperado devolvem `null` (ninguém grava tarifa duvidosa).
 */
export function parsePaymentFee(payment: unknown): PaymentFee | null {
  if (!isRecord(payment)) return null;

  const grossCents = toCents(payment.transaction_amount);
  const details = isRecord(payment.transaction_details) ? payment.transaction_details : null;
  const netCents = toCents(details?.net_received_amount);
  if (grossCents === null || grossCents <= 0 || netCents === null) return null;

  const feeCents = grossCents - netCents;
  if (feeCents < 0 || feeCents > grossCents) return null;

  const breakdown: PaymentFee["breakdown"] = [];
  const feeDetails = Array.isArray(payment.fee_details) ? payment.fee_details : [];
  for (const item of feeDetails) {
    if (breakdown.length >= MAX_BREAKDOWN_ITEMS) break;
    if (!isRecord(item) || item.fee_payer !== "collector") continue;
    const cents = toCents(item.amount);
    if (cents === null) continue;
    const type = typeof item.type === "string" ? item.type.slice(0, MAX_TYPE_LENGTH) : "";
    breakdown.push({ type: FEE_TYPE_PATTERN.test(type) ? type : "outro", cents });
  }

  const release =
    typeof payment.money_release_date === "string" ? payment.money_release_date.slice(0, 10) : "";
  const refundedCents = toCents(payment.transaction_amount_refunded);

  return {
    grossCents,
    feeCents,
    breakdown,
    releaseDate: DATE_PATTERN.test(release) ? release : null,
    refunded:
      REFUNDED_STATUSES.has(String(payment.status)) ||
      (refundedCents !== null && refundedCents >= grossCents),
  };
}

/**
 * Entre as tentativas de um pedido, escolhe o pagamento em que o dinheiro entrou.
 * Mais de um candidato: vale o único com o valor do pedido; senão é ambíguo. Um
 * único candidato com outro valor é devolvido assim mesmo (o banco recusa e alerta).
 */
export function pickPaymentForOrder(
  payments: unknown[],
  totalCents: number,
): unknown | "ambiguous" | null {
  const captured = payments.filter(
    (payment) => isRecord(payment) && CAPTURED_STATUSES.has(String(payment.status)),
  ) as JsonObject[];
  if (captured.length === 0) return null;
  if (captured.length === 1) return captured[0];

  const sameAmount = captured.filter(
    (payment) => toCents(payment.transaction_amount) === totalCents,
  );
  return sameAmount.length === 1 ? sameAmount[0] : "ambiguous";
}
