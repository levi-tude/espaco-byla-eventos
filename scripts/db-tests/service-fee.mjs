// Testa a migration da taxa de serviço (spec 2026-10-04-taxa-servico-design) num
// Postgres temporário: aplica as migrations anteriores, cria pedidos "antigos", aplica
// a nova e confere preenchimento, checkout com a taxa ligada/desligada, estorno,
// papéis, repasse, desconto, ajuste, contestação, imutabilidade e permissões.
// Não usa banco real nem o provedor de pagamento.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg instalados> node scripts/db-tests/service-fee.mjs

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOLS = process.env.BYLA_PG_TOOLS;
if (!TOOLS) {
  console.error("Defina BYLA_PG_TOOLS (pasta com embedded-postgres e pg).");
  process.exit(2);
}
const toolsRequire = createRequire(join(TOOLS, "package.json"));
const load = async (name) => (await import(pathToFileURL(toolsRequire.resolve(name)).href)).default;
const EmbeddedPostgres = await load("embedded-postgres");
const pg = await load("pg");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = process.env.BYLA_MIGRATIONS_DIR ?? join(ROOT, "supabase", "migrations");
const THIS_MIGRATION = "20261013100000_service_fee.sql";
const PORT = 54896;
const DATA_DIR = join(TOOLS, "data-taxa-servico");
const PASSWORD = randomUUID();
const POLICY = "2026-10-03";

let failures = 0;
function check(name, ok, extra = "") {
  if (ok) console.log(`ok   - ${name}`);
  else {
    failures += 1;
    console.log(`FAIL - ${name} ${extra}`);
  }
}
async function rejects(name, fn, pattern) {
  try {
    await fn();
    check(name, false, "(não deu erro)");
  } catch (error) {
    check(name, pattern.test(error.message), `(erro: ${error.message})`);
  }
}

rmSync(DATA_DIR, { recursive: true, force: true });
const server = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: PASSWORD,
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
  onLog: (m) => process.env.PGLOG && console.log("[pg]", String(m).trim()),
  onError: (m) => console.log("[pg-err]", String(m).trim()),
});
await server.initialise();
await server.start();
await server.createDatabase("byla");

try {
  const db = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: "byla" });
  db.on("error", () => {});
  await db.connect();

  await db.query(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create schema extensions;
    create schema vault;
    create table vault.secrets (name text primary key, secret text not null);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const thisIdx = files.indexOf(THIS_MIGRATION);
  check("migration da taxa vem logo depois do cancelamento de sessão",
    thisIdx > 0 && files[thisIdx - 1] === "20261012100000_session_notices_cancel.sql", files.slice(-3).join(","));
  for (const file of files.slice(0, thisIdx)) await db.query(readFileSync(join(MIGRATIONS, file), "utf8"));

  async function asRole(role, sql, params = [], claims = null) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      if (claims) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [claims]);
      const result = await db.query(sql, params);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }
  const svc = (sql, params) => asRole("service_role", sql, params).then((r) => r.rows);
  const one = async (sql, params) => (await svc(sql, params))[0];
  const scalar = async (sql, params) => Object.values((await svc(sql, params))[0])[0];

  const newStaff = async (name) => {
    const id = randomUUID();
    await db.query("insert into auth.users (id) values ($1)", [id]);
    await db.query("insert into public.staff_profiles (user_id, display_name) values ($1, $2)", [id, name]);
    return id;
  };
  const staffId = await newStaff("Secretaria Teste");
  const adminId = await newStaff("Admin Teste");
  const devId = await newStaff("Dev Teste");
  const outsiderId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [outsiderId]);

  const types = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
  ];
  const days = (n, h = 19) => {
    const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    d.setUTCHours(h + 3, 0, 0, 0);
    return d.toISOString();
  };
  const price = (type_index, price_cents) => ({ type_index, price_cents, max_units: null, on_sale: true });
  const session = (overrides = {}) => ({
    id: null, name: null, starts_at: days(7), ends_at: null, capacity: 30, inteira_quota: null, meia_quota: null,
    prices: [price(0, 5000), price(1, 2500)],
    ...overrides,
  });
  async function createEvent(name, sessions = [session()]) {
    const { rows } = await db.query(
      `insert into public.events (slug, name, venue, starts_at, capacity, sales_open)
       values ($1, $2, 'Local Teste', now() + interval '7 days', 30, true) returning id`,
      [randomUUID(), name],
    );
    await svc("select public.save_event_with_sessions($1, $2, 'Local Teste', 'Descrição', null, $3::jsonb, $4::jsonb, $5)",
      [rows[0].id, name, JSON.stringify(types), JSON.stringify(sessions), staffId]);
    return rows[0].id;
  }
  const sessionsOf = async (eventId) => (await db.query(
    "select * from public.event_sessions where event_id = $1 and archived_at is null order by starts_at", [eventId])).rows;
  const typeOf = async (eventId, preset) => (await db.query(
    "select id from public.ticket_types where event_id = $1 and preset = $2", [eventId, preset])).rows[0].id;
  const checkout = async (eventId, sessionId, items, extra = "", extraParams = []) => (await asRole("service_role",
    `select * from public.create_checkout_order(
       p_event_id => $1, p_buyer_name => 'Comprador Teste', p_buyer_email => 'comprador@example.com',
       p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
       p_items => $3::jsonb, p_privacy_policy_version => $4, p_session_id => $5${extra})`,
    [eventId, randomUUID(), JSON.stringify(items), POLICY, sessionId, ...extraParams])).rows[0];
  const pay = async (orderId) => (await one("select public.mark_order_paid_by_external('mercadopago', $1) as r", [orderId])).r;
  const orderRow = async (id) => (await db.query("select * from public.orders where id = $1", [id])).rows[0];
  const refundNow = async (orderId, staff = staffId) => {
    const r = await one("select * from public.begin_order_refund($1, $2, 'Pedido do comprador')", [orderId, staff]);
    await one("select public.complete_order_refund($1, 'REF-TESTE') as r", [r.refund_id]);
    return r;
  };
  const endEvent = (eventId, daysAgo = 2) => db.query(
    "update public.event_sessions set starts_at = now() - make_interval(days => $2) where event_id = $1",
    [eventId, daysAgo]);

  // ======================= A) PEDIDOS ANTIGOS =======================
  const evOld = await createEvent("Evento Antigo");
  const [sOld] = await sessionsOf(evOld);
  const oldOrder = (await asRole("service_role",
    `select * from public.create_checkout_order(
       p_event_id => $1, p_buyer_name => 'Comprador Antigo', p_buyer_email => 'antigo@example.com',
       p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
       p_items => $3::jsonb, p_privacy_policy_version => $4, p_session_id => $5)`,
    [evOld, randomUUID(), JSON.stringify([{ ticket_type_id: await typeOf(evOld, "inteira"), qty: 2 }]), POLICY, sOld.id])).rows[0];
  await pay(oldOrder.order_id);

  await db.query(readFileSync(join(MIGRATIONS, THIS_MIGRATION), "utf8"));
  console.log(`aplicadas ${files.length} migrations`);

  const old = await orderRow(oldOrder.order_id);
  check("pedido antigo: subtotal = total, taxa 0",
    old.tickets_subtotal_cents === 10000 && old.total_cents === 10000 && old.service_fee_cents === 0
      && old.service_fee_rate_bps === 0, JSON.stringify(old));
  check("itens antigos com taxa 0", (await scalar(
    "select count(*)::int from public.order_items where order_id = $1 and service_fee_unit_cents = 0 and service_fee_total_cents = 0",
    [oldOrder.order_id])) === 1);
  check("contas atuais viram secretaria, sem marca de desenvolvedor", (await scalar(
    "select count(*)::int from public.staff_profiles where role = 'secretaria' and not is_developer")) === 3);
  check("taxa entra desligada", (await one("select * from public.service_fee_policy()")).enabled === false);

  // ======================= B) FÓRMULA =======================
  const examples = [[2500, 125], [5000, 250], [9000, 450], [1000, 100], [2490, 125], [3330, 167], [800, 100], [1, 100], [2000, 100], [2010, 101], [0, 0]];
  for (const [p, fee] of examples) {
    check(`fórmula SQL = TS: ${p} → ${fee}`, (await scalar("select public.service_fee_for_price($1, 500, 100)", [p])) === fee);
  }
  check("percentual e mínimo zerados = 0", (await scalar("select public.service_fee_for_price(5000, 0, 0)")) === 0);

  // ======================= C) CHECKOUT =======================
  const ev1 = await createEvent("Evento Um");
  const [s1] = await sessionsOf(ev1);
  const inteira1 = await typeOf(ev1, "inteira");
  const meia1 = await typeOf(ev1, "meia");
  const items1 = [{ ticket_type_id: inteira1, qty: 2 }, { ticket_type_id: meia1, qty: 1 }];

  const off = await checkout(ev1, s1.id, items1);
  check("desligada, chamada antiga (sem termos): total como antes", off.total_cents === 12500 && off.service_fee_cents === 0);
  const offRow = await orderRow(off.order_id);
  check("desligada: subtotal = total, taxa 0", offRow.tickets_subtotal_cents === 12500 && offRow.service_fee_cents === 0);
  const offExpected = await checkout(ev1, s1.id, items1, ", p_expected_fee_rate_bps => $6, p_expected_fee_min_cents => $7", [0, 0]);
  check("desligada com termos 0/0 (código novo): aceita", offExpected.service_fee_cents === 0);
  await rejects("desligada, tela mostrou taxa: TAXA_MUDOU",
    () => checkout(ev1, s1.id, items1, ", p_expected_fee_rate_bps => $6, p_expected_fee_min_cents => $7", [500, 100]), /TAXA_MUDOU/);

  await db.query("update public.service_fee_settings set enabled = true where id = 1");
  check("updated_at atualizado ao ligar", (await scalar(
    "select updated_at > now() - interval '1 minute' from public.service_fee_settings")) === true);
  await rejects("ligada, tela sem taxa (0/0): TAXA_MUDOU",
    () => checkout(ev1, s1.id, items1, ", p_expected_fee_rate_bps => $6, p_expected_fee_min_cents => $7", [0, 0]), /TAXA_MUDOU/);
  await rejects("ligada, mínimo diferente: TAXA_MUDOU",
    () => checkout(ev1, s1.id, items1, ", p_expected_fee_rate_bps => $6, p_expected_fee_min_cents => $7", [500, 50]), /TAXA_MUDOU/);
  const on = await checkout(ev1, s1.id, items1, ", p_expected_fee_rate_bps => $6, p_expected_fee_min_cents => $7", [500, 100]);
  check("ligada: 2 inteiras + 1 meia = 125,00 + 6,25", on.total_cents === 13125 && on.service_fee_cents === 625, JSON.stringify(on));
  const onRow = await orderRow(on.order_id);
  check("pedido grava subtotal, taxa, percentual e mínimo",
    onRow.tickets_subtotal_cents === 12500 && onRow.service_fee_cents === 625
      && onRow.service_fee_rate_bps === 500 && onRow.service_fee_min_cents === 100);
  const onItems = (await db.query(
    "select kind, quantity, service_fee_unit_cents, service_fee_total_cents from public.order_items where order_id = $1 order by kind",
    [on.order_id])).rows;
  check("itens com taxa por unidade", JSON.stringify(onItems.map((i) => [i.kind, i.service_fee_unit_cents, i.service_fee_total_cents]))
    === JSON.stringify([["inteira", 250, 500], ["meia", 125, 125]]), JSON.stringify(onItems));
  check("ingressos continuam só com o preço (soma = subtotal)", (await scalar(
    "select sum(price_cents)::int from public.tickets where order_id = $1", [on.order_id])) === 12500);
  const oldCall = await checkout(ev1, s1.id, [{ ticket_type_id: inteira1, qty: 1 }]);
  check("ligada, chamada antiga (sem termos): cobra a taxa sem conferir", oldCall.total_cents === 5250 && oldCall.service_fee_cents === 250);

  const courtesy = (await one(
    "select * from public.issue_courtesy_ticket($1, 'Convidado Teste', 'convidado@example.com', $2, $3)",
    [ev1, randomUUID(), s1.id])).order_id;
  const cRow = await orderRow(courtesy);
  check("cortesia (função antiga) segue funcionando: total 0, taxa 0",
    cRow.total_cents === 0 && cRow.tickets_subtotal_cents === 0 && cRow.service_fee_cents === 0);

  await rejects("valores do pedido não mudam depois", () => db.query(
    "update public.orders set service_fee_cents = 0, total_cents = 12500 where id = $1", [on.order_id]), /TAXA_IMUTAVEL/);
  await rejects("constraint total = subtotal + taxa", () => db.query(
    `insert into public.orders (event_id, session_id, buyer_name, buyer_email, total_cents, tickets_subtotal_cents, service_fee_cents, public_token)
     values ($1, $2, 'X', 'x@example.com', 100, 50, 10, $3)`, [ev1, s1.id, randomUUID()]), /orders_fee_total_check/);

  // Pagamento e estorno com taxa.
  check("pagamento confirma o pedido com taxa", (await pay(on.order_id)) === "paid" || (await orderRow(on.order_id)).status === "pago");
  await pay(oldCall.order_id);
  const refunded = await refundNow(oldCall.order_id);
  check("estorno pela secretaria devolve 100% com a taxa", refunded.amount_cents === 5250);

  // ======================= D) PAPÉIS =======================
  check("papel: secretaria", (await scalar("select public.staff_finance_role($1)", [staffId])) === "secretaria");
  check("papel: fora da equipe = null", (await scalar("select public.staff_finance_role($1)", [outsiderId])) === null);
  await db.query("update public.staff_profiles set role = 'admin' where user_id = $1", [adminId]);
  await db.query("update public.staff_profiles set role = 'admin', is_developer = true where user_id = $1", [devId]);
  check("papel: admin", (await scalar("select public.staff_finance_role($1)", [adminId])) === "admin");
  check("papel: admin do desenvolvedor", (await scalar("select public.staff_finance_role($1)", [devId])) === "admin_dev");
  check("is_admin() pela sessão logada", (await asRole("authenticated", "select public.is_admin() as a", [], adminId)).rows[0].a === true
    && (await asRole("authenticated", "select public.is_admin() as a", [], staffId)).rows[0].a === false);
  await rejects("equipe logada não muda o próprio papel",
    () => asRole("authenticated", "update public.staff_profiles set role = 'admin' where user_id = $1", [staffId], staffId), /permission denied/);
  check("equipe logada ainda lê o próprio cadastro", (await asRole("authenticated",
    "select role from public.staff_profiles", [], staffId)).rows[0]?.role === "secretaria");

  const summary = (eventId, staff = adminId) => one("select public.event_finance_summary($1, $2) as s", [eventId, staff]).then((r) => r.s);
  await rejects("secretaria não vê o financeiro", () => summary(ev1, staffId), /TAXA_ADMIN/);
  await rejects("fora da equipe não vê o financeiro", () => summary(ev1, outsiderId), /TAXA_ADMIN/);
  const devSummary = await summary(ev1, devId);
  check("desenvolvedor vê o financeiro", devSummary.event_id === ev1);

  // ======================= E) CONTAS DO EVENTO =======================
  let s = await summary(ev1);
  check("resumo: vendido, taxa, total pago, estornado",
    s.tickets_cents === 12500 + 5000 && s.fee_cents === 625 + 250 && s.paid_total_cents === 13125 + 5250
      && s.refunded_cents === 5250 && s.refunded_fee_cents === 250 && s.refunded_orders === 1, JSON.stringify(s));
  check("resumo: taxa devida só do pedido pago, saldo e valor do Espaço",
    s.fee_due_cents === 625 && s.balance_cents === 625 && s.paid_out_cents === 0 && s.espaco_cents === 13125 - 625
      && s.rate_bps === 500 && s.suggested_payout_cents === 625, JSON.stringify(s));
  check("data de pagar: dia seguinte à sessão", s.due_date !== null);

  const payout = (eventId, expected, extra = {}) => one(
    "select public.record_service_fee_payout($1, $2, $3, $4::date, $5) as r",
    [eventId, extra.staff ?? adminId, expected, extra.pixDate ?? new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10), extra.note ?? null]).then((r) => r.r);
  await rejects("antes do fim do evento: TAXA_PRAZO", () => payout(ev1, 625), /TAXA_PRAZO/);
  await endEvent(ev1);
  await rejects("secretaria não marca pago", () => payout(ev1, 625, { staff: staffId }), /TAXA_ADMIN/);
  await rejects("conta do desenvolvedor não marca pago", () => payout(ev1, 625, { staff: devId }), /TAXA_DEV/);
  await rejects("valor diferente: TAXA_MUDOU com o valor certo", () => payout(ev1, 600), /TAXA_MUDOU:625/);
  await rejects("data do PIX no futuro", () => payout(ev1, 625, { pixDate: "2999-01-01" }), /TAXA_DATA/);
  await rejects("data do PIX antes do fim do evento", () => payout(ev1, 625, { pixDate: "2000-01-01" }), /TAXA_DATA/);
  await rejects("nota com quebra de linha", () => payout(ev1, 625, { note: "linha\noutra" }), /TAXA_NOTA/);
  const p1 = await payout(ev1, 625, { note: "E2E-TESTE-1" });
  check("repasse gravado", p1.amount_cents === 625 && p1.event_cents === 625 && p1.created_by_name === "Admin Teste");
  await rejects("segundo clique: TAXA_NADA (sem pagamento em dobro)", () => payout(ev1, 625), /TAXA_NADA/);
  s = await summary(ev1);
  check("depois do repasse: saldo 0, histórico e último repasse",
    s.balance_cents === 0 && s.paid_out_cents === 625 && s.history.length === 1 && s.last_payout?.created_by_name === "Admin Teste"
      && s.last_payout?.note === "E2E-TESTE-1", JSON.stringify(s));

  // Estorno depois do repasse → desconto pendente abatido no próximo evento.
  await refundNow(on.order_id);
  s = await summary(ev1);
  check("estorno depois do repasse: saldo negativo", s.balance_cents === -625 && s.fee_due_cents === 0);

  const ev2 = await createEvent("Evento Dois");
  const [s2] = await sessionsOf(ev2);
  const o2 = await checkout(ev2, s2.id, [{ ticket_type_id: await typeOf(ev2, "inteira"), qty: 4 }],
    ", p_expected_fee_rate_bps => $6, p_expected_fee_min_cents => $7", [500, 100]);
  await pay(o2.order_id);
  const o2b = await checkout(ev2, s2.id, [{ ticket_type_id: await typeOf(ev2, "meia"), qty: 1 }]);
  await pay(o2b.order_id);
  await endEvent(ev2, 1);
  let s2sum = await summary(ev2);
  check("outro evento mostra o desconto pendente e o valor sugerido",
    s2sum.balance_cents === 1000 + 125 && s2sum.pending_discounts.length === 1
      && s2sum.pending_discounts[0].event_id === ev1 && s2sum.pending_discounts[0].balance_cents === -625
      && s2sum.suggested_payout_cents === 1125 - 625, JSON.stringify(s2sum));

  // Contestação manual.
  const cb = (orderId, kind, staff = adminId, reason = "Contestação aberta pelo comprador") =>
    one("select public.register_order_chargeback($1, $2, $3, $4) as r", [orderId, staff, kind, reason]).then((r) => r.r);
  await rejects("desenvolvedor não registra contestação", () => cb(o2b.order_id, "contestacao", devId), /TAXA_DEV/);
  await rejects("secretaria não registra contestação", () => cb(o2b.order_id, "contestacao", staffId), /TAXA_ADMIN/);
  await rejects("motivo curto", () => cb(o2b.order_id, "contestacao", adminId, "abc"), /TAXA_MOTIVO/);
  await rejects("tipo inválido", () => cb(o2b.order_id, "outra"), /TAXA_VALOR/);
  await rejects("pedido estornado não é contestado aqui", () => cb(on.order_id, "contestacao"), /TAXA_PEDIDO/);
  await rejects("cortesia não é contestada", () => cb(courtesy, "contestacao"), /TAXA_PEDIDO/);
  await rejects("reversão sem contestação", () => cb(o2b.order_id, "reversao"), /TAXA_CONTESTACAO_SEM/);
  await cb(o2b.order_id, "contestacao");
  await rejects("contestar de novo", () => cb(o2b.order_id, "contestacao"), /TAXA_CONTESTACAO_JA/);
  s2sum = await summary(ev2);
  check("contestado sai da taxa devida",
    s2sum.fee_due_cents === 1000 && s2sum.contested_orders === 1 && s2sum.contested_fee_cents === 125
      && s2sum.contested_order_ids.includes(o2b.order_id) && s2sum.chargebacks.length === 1, JSON.stringify(s2sum));
  await cb(o2b.order_id, "reversao", adminId, "Disputa ganha pelo Espaço");
  s2sum = await summary(ev2);
  check("reversão: taxa volta a ser devida", s2sum.fee_due_cents === 1125 && s2sum.contested_orders === 0 && s2sum.chargebacks.length === 2);
  check("contestação não mudou o pedido", (await orderRow(o2b.order_id)).status === "pago");

  // Repasse abatendo o desconto.
  const p2 = await payout(ev2, 500);
  check("repasse abate o desconto de outro evento", p2.amount_cents === 500 && p2.event_cents === 1125 && p2.discount_cents === -625);
  check("evento um quitado pelo desconto", (await summary(ev1)).balance_cents === 0);
  check("evento dois quitado", (await summary(ev2)).balance_cents === 0);
  check("itens do repasse somam o valor do PIX", (await scalar(
    "select sum(amount_cents)::int from public.service_fee_payout_items where payout_id = $1", [p2.payout_id])) === 500);

  // Desconto maior que o saldo: nada a pagar.
  const ev3 = await createEvent("Evento Três");
  const [s3] = await sessionsOf(ev3);
  const o3 = await checkout(ev3, s3.id, [{ ticket_type_id: await typeOf(ev3, "meia"), qty: 1 }]);
  await pay(o3.order_id);
  await endEvent(ev3, 1);
  await cb(o2.order_id, "contestacao");
  await rejects("descontos cobrem o saldo: TAXA_NADA", () => payout(ev3, 125 - 1000), /TAXA_NADA/);

  // Ajuste.
  const adj = (amount, reason = "Correção de lançamento", staff = adminId) =>
    one("select public.record_service_fee_adjustment($1, $2, $3, $4) as r", [ev3, staff, amount, reason]).then((r) => r.r);
  await rejects("ajuste zero", () => adj(0), /TAXA_VALOR/);
  await rejects("ajuste sem motivo", () => adj(100, "x"), /TAXA_MOTIVO/);
  await rejects("ajuste pelo desenvolvedor", () => adj(100, "Correção qualquer", devId), /TAXA_DEV/);
  await adj(-50);
  const s3sum = await summary(ev3);
  check("ajuste entra no histórico e muda o já repassado",
    s3sum.paid_out_cents === -50 && s3sum.balance_cents === 175 && s3sum.history[0].kind === "ajuste"
      && s3sum.history[0].reason === "Correção de lançamento", JSON.stringify(s3sum));

  // Visão geral.
  const today = new Date(Date.now() - 3 * 3600 * 1000);
  const from = new Date(today.getTime() - 40 * 86400000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 40 * 86400000).toISOString().slice(0, 10);
  const overview = (await one("select public.service_fee_overview($1, $2::date, $3::date) as o", [adminId, from, to])).o;
  check("visão geral: eventos com taxa no período e totais",
    overview.events.length === 3 && overview.paid_in_period_cents === 625 + 500
      && overview.to_pay_cents === 175 && overview.pending_discount_cents === -1000, JSON.stringify({ ...overview, events: overview.events.length }));
  check("visão geral não inclui evento sem taxa", !overview.events.some((e) => e.event_id === evOld));
  await rejects("visão geral: secretaria recusada", () => one("select public.service_fee_overview($1, $2::date, $3::date)", [staffId, from, to]), /TAXA_ADMIN/);
  await rejects("visão geral: período invertido", () => one("select public.service_fee_overview($1, $2::date, $3::date)", [adminId, to, from]), /TAXA_VALOR/);

  // ======================= F) IMUTABILIDADE E PERMISSÕES =======================
  await rejects("repasse não é editado pelo servidor", () => asRole("service_role", "update public.service_fee_payouts set amount_cents = 1"), /permission denied/);
  await rejects("repasse não é apagado pelo servidor", () => asRole("service_role", "delete from public.service_fee_payout_items"), /permission denied/);
  await rejects("repasse não é editado nem pelo dono do banco", () => db.query("update public.service_fee_payouts set note = 'x'"), /TAXA_IMUTAVEL/);
  await rejects("contestação não é apagada nem pelo dono do banco", () => db.query("delete from public.order_chargebacks"), /TAXA_IMUTAVEL/);
  await rejects("truncate recusado", () => db.query("truncate public.service_fee_payout_items"), /TAXA_IMUTAVEL/);

  const fns = [
    "public.staff_finance_role(uuid)",
    "public.service_fee_policy()",
    "public.event_fee_due_date(uuid)",
    "public.order_is_contested(uuid)",
    "public.event_fee_balance(uuid)",
    "public.service_fee_event_ids()",
    "public.service_fee_pending_discounts(uuid)",
    "public.assert_finance_admin(uuid, boolean)",
    "public.event_finance_summary(uuid, uuid)",
    "public.service_fee_overview(uuid, date, date)",
    "public.record_service_fee_payout(uuid, uuid, integer, date, text)",
    "public.record_service_fee_adjustment(uuid, uuid, integer, text)",
    "public.register_order_chargeback(uuid, uuid, text, text, text)",
  ];
  for (const fn of fns) {
    const { rows: p } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as svc,
              (select prosecdef from pg_proc where oid = $1::regprocedure) as definer,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`, [fn]);
    check(`${fn}: só service_role, security definer, search_path vazio`,
      !p[0].anon && !p[0].auth && p[0].svc && p[0].definer
        && JSON.stringify(p[0].config) === JSON.stringify(['search_path=""']), JSON.stringify(p[0]));
  }
  for (const fn of ["public.service_fee_for_price(integer, integer, integer)",
    "public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid, integer, integer)"]) {
    const { rows: p } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as svc,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`, [fn]);
    check(`${fn}: só service_role, search_path vazio`, !p[0].anon && !p[0].auth && p[0].svc
      && JSON.stringify(p[0].config) === JSON.stringify(['search_path=""']), JSON.stringify(p[0]));
  }
  const { rows: isAdminPriv } = await db.query(
    `select has_function_privilege('anon', 'public.is_admin()', 'execute') as anon,
            has_function_privilege('authenticated', 'public.is_admin()', 'execute') as auth`);
  check("is_admin(): equipe logada sim, anônimo não", !isAdminPriv[0].anon && isAdminPriv[0].auth);
  check("checkout antigo (9 parâmetros) não existe mais como sobrecarga", (await scalar(
    "select count(*)::int from pg_proc where proname = 'create_checkout_order'")) === 1);

  for (const table of ["service_fee_settings", "order_chargebacks", "service_fee_payouts", "service_fee_payout_items"]) {
    const { rows: rls } = await db.query(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
    const { rows: pol } = await db.query("select 1 from pg_policies where tablename = $1", [table]);
    check(`${table}: RLS ligada e sem políticas`, rls[0].relrowsecurity === true && pol.length === 0);
    await rejects(`${table}: anon não lê`, () => asRole("anon", `select 1 from public.${table}`), /permission denied/);
    await rejects(`${table}: Admin logado não lê direto`, () => asRole("authenticated", `select 1 from public.${table}`, [], adminId), /permission denied/);
  }
  await rejects("servidor não muda a configuração da taxa", () => asRole("service_role", "update public.service_fee_settings set enabled = false"), /permission denied/);

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTUDO OK" : `\nFALHAS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
