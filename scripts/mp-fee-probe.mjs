// Teste da tarifa no banco de pagamento (fase 3, Tarefa 1): cria um pagamento de
// cartão de teste pela API de Orders, procura o mesmo pagamento na API de Payments,
// mostra bruto, líquido, tarifa do vendedor e data de liberação, estorna e repete;
// depois cria um PIX de teste (não pago) e repete a consulta.
// Só roda com credenciais de TESTE: antes de qualquer cobrança confere em /users/me
// que a conta é usuário de teste e aborta se não for.
// Nunca imprime token, chave, e-mail, ID de cartão nem resposta inteira.
//
// Uso: node --env-file=<arquivo fora do repositório> scripts/mp-fee-probe.mjs
// Variáveis: MP_TEST_ACCESS_TOKEN, MP_TEST_PUBLIC_KEY (APP_USR- do vendedor de teste).

import { randomUUID } from "node:crypto";

const API = "https://api.mercadopago.com";
const TOKEN = process.env.MP_TEST_ACCESS_TOKEN?.trim();
const PUBLIC_KEY = process.env.MP_TEST_PUBLIC_KEY?.trim();

if (!TOKEN || !PUBLIC_KEY) {
  console.error("Defina MP_TEST_ACCESS_TOKEN e MP_TEST_PUBLIC_KEY (credenciais de teste).");
  process.exit(2);
}

const AMOUNT = "10.00";
const TIMEOUT_MS = 20_000;
const SEARCH_ATTEMPTS = 5;
const SEARCH_WAIT_MS = 3_000;
const REFUND_WAIT_MS = 10_000;
const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,100}$/i;

/** Cartão aprovado da documentação de testes (titular APRO = aprovado). */
const TEST_CARD = {
  card_number: "5031433215406351",
  expiration_month: 11,
  expiration_year: 2030,
  security_code: "123",
  cardholder: { name: "APRO", identification: { type: "CPF", number: "12345678909" } },
};
const TEST_CARD_METHOD = "master";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cents = (value) => {
  const number = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(number)
    ? null
    : Math.round(number * 100);
};
const brl = (value) => (value === null ? "—" : `R$ ${(value / 100).toFixed(2)}`);

async function call(method, path, { body, idempotencyKey } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, json };
}

/** Só o código do erro (formato conferido), nunca a mensagem nem o corpo. */
function errorCode(json) {
  for (const candidate of [json?.errors?.[0]?.code, json?.error, json?.cause?.[0]?.code]) {
    if (typeof candidate === "string" && ERROR_CODE_PATTERN.test(candidate)) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  return "sem_codigo";
}

function fail(step, result, exitCode = 1) {
  console.error(`Falhou em ${step}: HTTP ${result.status} (${errorCode(result.json)}).`);
  process.exit(exitCode);
}

async function assertTestAccount() {
  const me = await call("GET", "/users/me").catch(() => null);
  const tags = Array.isArray(me?.json?.tags) ? me.json.tags : [];
  if (!me?.ok || !tags.includes("test_user")) {
    console.error("Abortado: a credencial não é de usuário de teste. Nenhuma cobrança foi criada.");
    process.exit(3);
  }
  console.log("Conta de teste confirmada.");
}

async function createCardToken() {
  const result = await call(
    "POST",
    `/v1/card_tokens?public_key=${encodeURIComponent(PUBLIC_KEY)}`,
    { body: TEST_CARD },
  );
  if (!result.ok || typeof result.json?.id !== "string") fail("token do cartão", result);
  return result.json.id;
}

async function createOrder(externalReference, payment) {
  const result = await call("POST", "/v1/orders", {
    idempotencyKey: randomUUID(),
    body: {
      type: "online",
      processing_mode: "automatic",
      external_reference: externalReference,
      total_amount: AMOUNT,
      description: "Teste da tarifa (fase 3)",
      payer: { email: `probe_${randomUUID().slice(0, 8)}@testuser.com` },
      transactions: { payments: [{ amount: AMOUNT, ...payment }] },
    },
  });
  const order = result.status === 402 ? result.json?.data : result.json;
  if (!order?.id) fail("criar order", result);
  const first = order.transactions?.payments?.[0] ?? {};
  console.log(`Order criada: status=${order.status ?? "—"}/${order.status_detail ?? "—"}.`);
  return { orderId: order.id, paymentId: first.id, referenceId: first.reference_id };
}

/** Tenta (a) busca por external_reference, (b) reference_id, (c) id do pagamento da order. */
async function findPayment({ externalReference, paymentId, referenceId }) {
  const found = { a: null, b: null, c: null };

  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS && !found.a; attempt++) {
    const params = new URLSearchParams({ external_reference: externalReference });
    const result = await call("GET", `/v1/payments/search?${params}`).catch(() => null);
    const hit = result?.ok ? result.json?.results?.[0] : null;
    if (hit) found.a = hit;
    else if (attempt < SEARCH_ATTEMPTS) await sleep(SEARCH_WAIT_MS);
  }

  for (const [path, id] of [["b", referenceId], ["c", paymentId]]) {
    if (id === undefined || id === null || id === "") continue;
    const result = await call("GET", `/v1/payments/${encodeURIComponent(String(id))}`).catch(() => null);
    if (result?.ok && result.json?.id !== undefined) found[path] = result.json;
  }

  const worked = Object.entries(found).filter(([, payment]) => payment).map(([path]) => path);
  console.log(`Caminhos que acharam o pagamento: ${worked.length ? worked.join(", ") : "nenhum"}.`);
  const path = worked[0] ?? null;
  return path ? { path, payment: found[path] } : null;
}

function report(label, found, { afterRefund = false } = {}) {
  console.log(`\n== ${label} ==`);
  if (!found) {
    console.log("Pagamento não encontrado na API de Payments.");
    return;
  }
  const { path, payment } = found;
  const gross = cents(payment.transaction_amount);
  const net = cents(payment.transaction_details?.net_received_amount);
  const collectorFees = (Array.isArray(payment.fee_details) ? payment.fee_details : [])
    .filter((fee) => fee?.fee_payer === "collector");
  const feeSum = collectorFees.reduce((sum, fee) => sum + (cents(fee.amount) ?? 0), 0);
  const feeTypes = [...new Set(collectorFees.map((fee) => String(fee.type ?? "—")))];

  console.log(`caminho: ${path}`);
  console.log(`status: ${payment.status ?? "—"}/${payment.status_detail ?? "—"}`);
  console.log(`transaction_amount: ${brl(gross)}`);
  console.log(`net_received_amount: ${brl(net)}`);
  console.log(`fee_details (collector): ${brl(feeSum)} [${feeTypes.join(", ") || "nenhum"}]`);
  console.log(`money_release_date: ${payment.money_release_date ?? "ausente"}`);
  console.log(
    `campos presentes: fee_details=${Array.isArray(payment.fee_details)}, ` +
      `net_received_amount=${net !== null}, money_release_date=${Boolean(payment.money_release_date)}, ` +
      `charges_details=${Array.isArray(payment.charges_details)}`,
  );
  console.log(
    `bruto − líquido bate com fee_details: ${
      gross !== null && net !== null ? (gross - net === feeSum ? "sim" : `não (${brl(gross - net)})`) : "sem dados"
    }`,
  );

  if (afterRefund) {
    console.log(`transaction_amount_refunded: ${brl(cents(payment.transaction_amount_refunded))}`);
    const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
    console.log(
      `refunds[]: ${
        refunds.length
          ? refunds.map((refund) => `${brl(cents(refund?.amount))} (${refund?.status ?? "—"})`).join("; ")
          : "vazio"
      }`,
    );
  }
}

async function main() {
  await assertTestAccount();

  console.log("\n-- Cartão de teste --");
  const cardReference = randomUUID();
  const cardToken = await createCardToken();
  const card = await createOrder(cardReference, {
    payment_method: { id: TEST_CARD_METHOD, type: "credit_card", token: cardToken, installments: 1 },
  });
  const cardIds = { externalReference: cardReference, ...card };
  report("Cartão aprovado", await findPayment(cardIds));

  const refund = await call("POST", `/v1/orders/${encodeURIComponent(card.orderId)}/refund`, {
    idempotencyKey: randomUUID(),
  });
  console.log(`\nEstorno pedido: HTTP ${refund.status}${refund.ok ? "" : ` (${errorCode(refund.json)})`}.`);
  await sleep(REFUND_WAIT_MS);
  report("Cartão depois do estorno total", await findPayment(cardIds), { afterRefund: true });

  console.log("\n-- PIX de teste (não pago) --");
  const pixReference = randomUUID();
  const pix = await createOrder(pixReference, {
    expiration_time: "PT30M",
    payment_method: { id: "pix", type: "bank_transfer" },
  });
  report("PIX pendente", await findPayment({ externalReference: pixReference, ...pix }));
}

main().catch((error) => {
  console.error(`Erro inesperado: ${error instanceof Error ? error.name : "desconhecido"}.`);
  process.exit(1);
});
