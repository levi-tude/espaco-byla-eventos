// Matriz do dinheiro do organizador (spec 2026-10-13-contas-organizador-design; plano
// 2026-10-15-contas-organizador-fase3, tarefas 3, 5B e 6) num Postgres temporário: aplica todas as
// migrations em ordem e confere o calendário de dias úteis, a tarifa por pagamento (automática,
// falhas, fila do cron, lançamento manual e total do evento pelo extrato), os repasses ao
// organizador (saldo, descontos, compensação, devolução, visões e resumo do cron), os gatilhos de
// imutabilidade e as permissões.
// Não usa banco real.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg instalados> node scripts/db-tests/organizer-finance.mjs

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
const MIGRATION_FEES = "20261019100000_payment_fees_calendar.sql";
const MIGRATION_PAYOUTS = "20261019110000_organizer_payouts.sql";
const PORT = 54915;
const DATA_DIR = join(TOOLS, "data-organizer-finance");
const PASSWORD = randomUUID();

let failures = 0;
let passes = 0;
function check(name, ok, extra = "") {
  if (ok) {
    passes += 1;
    console.log(`ok   - ${name}`);
  } else {
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

const ROLES = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
`;
// Esqueleto do Supabase: auth.users com e-mail, auth.sessions e auth.jwt()/auth.uid()
// lendo request.jwt.claims (como no Supabase de verdade).
const STUBS = `
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, aud text, role text,
    email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
  create table auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz, updated_at timestamptz);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select (auth.jwt() ->> 'sub')::uuid $$;
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
`;

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

try {
  await server.createDatabase("byla");
  const db = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: "byla" });
  db.on("error", () => {});
  await db.connect();
  await db.query(ROLES);
  await db.query(STUBS);

  // O Postgres embutido pode vir sem a base de fusos: só aqui troca Brasília por UTC.
  const hasTz = (await db.query("select count(*)::int as n from pg_timezone_names where name = 'America/Sao_Paulo'")).rows[0].n > 0;
  const migrationSql = (file) => {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    return hasTz ? text : text.replaceAll("'America/Sao_Paulo'", "'UTC'");
  };
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  check("a migration da tarifa e do calendário existe", files.includes(MIGRATION_FEES), files.slice(-3).join(","));
  for (const file of files) await db.query(migrationSql(file));
  console.log(`aplicadas ${files.length} migrations${hasTz ? "" : " (fuso trocado por UTC no banco temporário)"}`);

  // ----------------------------------------------------------------- ajudantes
  async function run(role, claims, sql, params = []) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const result = await db.query(sql, params);
      await db.query("commit");
      return result.rows;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }
  const svc = (sql, params) => run("service_role", { role: "service_role" }, sql, params);
  const scalar = async (sql, params) => Object.values((await svc(sql, params))[0])[0];
  const anon = (sql, params) => run("anon", { role: "anon" }, sql, params);
  const authed = (userId, sql, params) => run("authenticated", { sub: userId, role: "authenticated" }, sql, params);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];

  const newStaff = async (email, name, role, isDeveloper = false) => {
    const id = randomUUID();
    await q("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await q("insert into public.staff_profiles (user_id, display_name, role, is_developer) values ($1, $2, $3, $4)",
      [id, name, role, isDeveloper]);
    return id;
  };
  const admin = await newStaff("admin@exemplo.com", "Admin Teste", "admin");
  const dev = await newStaff("dev@exemplo.com", "Dev Teste", "admin", true);
  const sec = await newStaff("secretaria@exemplo.com", "Secretaria Teste", "secretaria");

  const types = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
  ];
  const days = (n, h = 19) => {
    const d = new Date(Date.now() + n * 86400000);
    d.setUTCHours(h + 3, 0, 0, 0);
    return d.toISOString();
  };
  const price = (type_index, price_cents) => ({ type_index, price_cents, max_units: null, on_sale: true });
  const session = (o = {}) => ({
    id: null, name: null, starts_at: days(7), ends_at: null, capacity: 30, inteira_quota: null, meia_quota: null,
    prices: [price(0, 5000), price(1, 2500)],
    ...o,
  });
  const teamEvent = async (slug, name) => {
    const id = (await one(
      `insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open)
       values ($1, $2, 'Espaço', '', $3, 30, true) returning id`, [slug, name, days(7)])).id;
    await svc("select public.save_event_with_sessions($1, $2, 'Espaço', '', null, $3::jsonb, $4::jsonb, $5)",
      [id, name, JSON.stringify(types), JSON.stringify([session()]), sec]);
    return id;
  };
  const sessionOf = async (eventId) => (await one(
    "select id from public.event_sessions where event_id = $1 and archived_at is null order by starts_at, id limit 1", [eventId])).id;
  const addOrder = async (eventId, { status = "pago", total = 5000, provider = "mercadopago" } = {}) => (await one(
    `insert into public.orders (event_id, session_id, buyer_name, buyer_email, buyer_phone, total_cents, status,
                                public_token, paid_at, payment_provider, provider_order_id, decision_reason)
     values ($1, $2, 'Comprador Teste', 'comprador@exemplo.com', '71900000002', $3, $4::public.order_status, $5,
             case when $4::text in ('pago', 'estornado', 'aguardando_decisao') then now() end, $6, $7,
             case when $4::text = 'aguardando_decisao' then 'sem_vaga' end)
     returning id`,
    [eventId, await sessionOf(eventId), total, status, randomUUID(), provider, `ORD${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`])).id;
  const feeRow = (orderId) => one("select * from public.order_payment_fees where order_id = $1", [orderId]);
  const record = (orderId, gross, fee, { breakdown = [], release = null, afterRefund = false } = {}) => scalar(
    "select public.record_payment_fee($1, $2, $3, $4::jsonb, $5::date, $6) as v",
    [orderId, gross, fee, breakdown === null ? null : JSON.stringify(breakdown), release, afterRefund]);
  const fail = (orderId, code) => scalar("select public.record_payment_fee_failure($1, $2) as v", [orderId, code]);
  const missing = () => svc("select * from public.orders_missing_fee(50)");
  const manual = (actor, orderId, fee, note) => scalar(
    "select public.record_payment_fee_manual($1, $2, $3, $4) as v", [actor, orderId, fee, note]);
  const nth = (start, n = 5) => scalar("select public.nth_business_day($1::date, $2)::text as v", [start, n]);

  // ======================= 1) CALENDÁRIO =======================
  check("1. carga com 80 feriados (16 por ano, 2026–2030)",
    (await one("select count(*)::int as n from public.business_holidays")).n === 80);
  check("1. último ano cadastrado = 2030", (await scalar("select public.business_calendar_last_year() as v")) === 2030);
  for (const [start, due] of [
    ["2026-10-24", "2026-10-30"],
    ["2026-11-15", "2026-11-23"],
    ["2026-06-21", "2026-06-29"],
    ["2027-02-07", "2027-02-16"],
  ]) {
    check(`1. 5º dia útil a partir de ${start} = ${due}`, (await nth(start)) === due, String(await nth(start)));
  }
  check("1. o próprio dia inicial conta se for útil (2026-10-26, n=1)", (await nth("2026-10-26", 1)) === "2026-10-26");
  check("1. início em 2031 (sem calendário): null", (await nth("2031-01-10")) === null);
  check("1. prazo que atravessa para 2031: null", (await nth("2030-12-27")) === null);
  check("1. n fora de 1..30: null", (await nth("2026-10-24", 0)) === null && (await nth("2026-10-24", 31)) === null);
  check("1. início nulo: null", (await scalar("select public.nth_business_day(null, 5) as v")) === null);

  // ======================= 2) PRAZO DO REPASSE =======================
  const evDue = await teamEvent("evento-prazo", "Evento Prazo");
  await q("update public.event_sessions set starts_at = '2026-10-23 22:00:00+00', ends_at = null where event_id = $1", [evDue]);
  check("2. última sessão em 23/10/2026: prazo de repasse 30/10/2026",
    (await scalar("select public.event_payout_due_date($1)::text as v", [evDue])) === "2026-10-30",
    String(await scalar("select public.event_payout_due_date($1)::text as v", [evDue])));
  const evNoSession = (await one(
    `insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open)
     values ('sem-sessao', 'Sem Sessão', 'Espaço', '', now() + interval '7 days', 30, false) returning id`)).id;
  await q("delete from public.event_sessions where event_id = $1", [evNoSession]);
  check("2. evento sem sessão: prazo null",
    (await scalar("select public.event_payout_due_date($1) as v", [evNoSession])) === null);

  // ======================= 3) TARIFA AUTOMÁTICA =======================
  const ev = await teamEvent("evento-tarifa", "Evento Tarifa");
  const paid = await addOrder(ev);
  await rejects("3. bruto diferente do total: TARIFA_VALOR", () => record(paid, 4000, 100), /^TARIFA_VALOR/);
  await rejects("3. tarifa maior que o bruto: TARIFA_VALOR", () => record(paid, 5000, 5001), /^TARIFA_VALOR/);
  await rejects("3. tarifa igual ao bruto: TARIFA_VALOR", () => record(paid, 5000, 5000), /^TARIFA_VALOR/);
  await rejects("3. tarifa negativa: TARIFA_VALOR", () => record(paid, 5000, -1), /^TARIFA_VALOR/);
  await rejects("3. detalhamento com mais de 2000 bytes: TARIFA_VALOR",
    () => record(paid, 5000, 100, { breakdown: [{ type: "x".repeat(2100) }] }), /^TARIFA_VALOR/);
  await rejects("3. detalhamento que não é lista: TARIFA_VALOR",
    () => record(paid, 5000, 100, { breakdown: { type: "x" } }), /^TARIFA_VALOR/);
  await rejects("3. detalhamento com mais de 10 itens: TARIFA_VALOR",
    () => record(paid, 5000, 100, { breakdown: Array.from({ length: 11 }, () => ({})) }), /^TARIFA_VALOR/);
  check("3. nada gravado depois dos erros", (await feeRow(paid)) === undefined);
  const pending = await addOrder(ev, { status: "pendente" });
  check("3. pedido pendente: ignorado", (await record(pending, 5000, 100)) === "ignorado");
  const courtesy = await addOrder(ev, { total: 0, provider: "cortesia" });
  check("3. cortesia (valor 0): ignorado", (await record(courtesy, 0, 0)) === "ignorado");
  const otherProvider = await addOrder(ev, { provider: "outro" });
  check("3. outro provedor: ignorado", (await record(otherProvider, 5000, 100)) === "ignorado");
  check("3. pedidos ignorados não ganham linha",
    (await one("select count(*)::int as n from public.order_payment_fees where order_id = any($1::uuid[])",
      [[pending, courtesy, otherProvider]])).n === 0);
  check("3. pedido pago: salvo",
    (await record(paid, 5000, 249, { breakdown: [{ type: "mercadopago_fee", amount: 2.49 }], release: "2026-11-14" })) === "salvo");
  let row = await feeRow(paid);
  check("3. líquido = bruto − tarifa, origem api, data de liberação guardada",
    row.gross_cents === 5000 && row.fee_cents === 249 && row.net_cents === 4751 && row.source === "api"
      && row.money_release_date instanceof Date && row.fee_breakdown.length === 1 && row.refund_checked_at === null,
    JSON.stringify(row));
  check("3. gravar de novo sem data mantém a data de liberação",
    (await record(paid, 5000, 250)) === "salvo"
      && (await feeRow(paid)).fee_cents === 250 && (await feeRow(paid)).money_release_date instanceof Date);
  const decision = await addOrder(ev, { status: "aguardando_decisao" });
  check("3. pago sem vaga (aguardando decisão) também tem tarifa", (await record(decision, 5000, 249)) === "salvo");
  const notRefunded = await addOrder(ev);
  check("3. 'depois do estorno' em pedido ainda pago: salva sem marcar a reconferência",
    (await record(notRefunded, 5000, 249, { afterRefund: true })) === "salvo"
      && (await feeRow(notRefunded)).refund_checked_at === null);

  // ======================= 4) FALHAS E FILA DO CRON =======================
  const flaky = await addOrder(ev);
  const inQueue = async (orderId) => (await missing()).find((r) => r.order_id === orderId);
  check("4. pedido pago sem tarifa está na fila (0 tentativas)", (await inQueue(flaky))?.attempts === 0);
  check("4. pedido com tarifa não está na fila", (await inQueue(paid)) === undefined);
  check("4. pedido pendente não está na fila", (await inQueue(pending)) === undefined);
  const counts = [];
  for (let i = 0; i < 4; i += 1) counts.push(await fail(flaky, "timeout"));
  check("4. 4 falhas: tentativas 1..4, continua na fila",
    JSON.stringify(counts) === "[1,2,3,4]" && (await inQueue(flaky))?.attempts === 4, JSON.stringify(counts));
  check("4. código fora do formato vira 'erro'", (await fail(flaky, "Falhou: token X!")) === 5
    && (await feeRow(flaky)).last_error === "erro");
  check("4. 5ª falha: sai da fila", (await inQueue(flaky)) === undefined);
  check("4. linha de falha sem valores", (await feeRow(flaky)).fee_cents === null && (await feeRow(flaky)).gross_cents === null);
  check("4. falha de pedido pendente: 0 e sem linha", (await fail(pending, "timeout")) === 0 && (await feeRow(pending)) === undefined);
  check("4. tarifa achada depois das falhas zera tentativas e erro",
    (await record(flaky, 5000, 249)) === "salvo" && (await feeRow(flaky)).attempts === 0 && (await feeRow(flaky)).last_error === null);

  const refunded = await addOrder(ev);
  await record(refunded, 5000, 249);
  await q("update public.orders set status = 'estornado' where id = $1", [refunded]);
  const refundedRow = await inQueue(refunded);
  check("4. estornado com tarifa e sem reconferência: na fila com after_refund = true",
    refundedRow?.after_refund === true, JSON.stringify(refundedRow));
  check("4. pago com tarifa: after_refund falso não aparece", (await inQueue(paid)) === undefined);
  check("4. reconferência depois do estorno: salvo e sai da fila",
    (await record(refunded, 5000, 0, { afterRefund: true })) === "salvo"
      && (await feeRow(refunded)).refund_checked_at !== null && (await inQueue(refunded)) === undefined);
  const refundedNoFee = await addOrder(ev, { status: "estornado" });
  check("4. estornado sem tarifa nenhuma: na fila com after_refund = true", (await inQueue(refundedNoFee))?.after_refund === true);
  check("4. limite da fila respeita o teto de 50 e o mínimo de 1",
    (await svc("select * from public.orders_missing_fee(0)")).length === 1
      && (await svc("select * from public.orders_missing_fee(500)")).length <= 50);

  // ======================= 5) LANÇAMENTO MANUAL =======================
  const manualOrder = await addOrder(ev);
  await fail(manualOrder, "nao_achou");
  await rejects("5. secretaria: TAXA_ADMIN", () => manual(sec, manualOrder, 300, "Extrato do banco"), /^TAXA_ADMIN/);
  await rejects("5. Admin desenvolvedor: TAXA_DEV", () => manual(dev, manualOrder, 300, "Extrato do banco"), /^TAXA_DEV/);
  await rejects("5. desconhecido: TAXA_ADMIN", () => manual(randomUUID(), manualOrder, 300, "Extrato do banco"), /^TAXA_ADMIN/);
  await rejects("5. sem nota: TARIFA_NOTA", () => manual(admin, manualOrder, 300, "   "), /^TARIFA_NOTA/);
  await rejects("5. nota com quebra de linha: TARIFA_NOTA", () => manual(admin, manualOrder, 300, "a\nb"), /^TARIFA_NOTA/);
  await rejects("5. nota longa: TARIFA_NOTA", () => manual(admin, manualOrder, 300, "x".repeat(141)), /^TARIFA_NOTA/);
  await rejects("5. tarifa maior que o total: TARIFA_VALOR", () => manual(admin, manualOrder, 5001, "Extrato"), /^TARIFA_VALOR/);
  await rejects("5. pedido pendente: TARIFA_PEDIDO", () => manual(admin, pending, 100, "Extrato"), /^TARIFA_PEDIDO/);
  check("5. nada gravado pelas tentativas recusadas", (await feeRow(manualOrder)).source === "api"
    && (await feeRow(manualOrder)).fee_cents === null);
  const result = await manual(admin, manualOrder, 300, "  Extrato do banco de 20/10  ");
  check("5. Admin grava: devolve evento, tarifa e anterior nulo",
    result.event_id === ev && result.fee_cents === 300 && result.previous_fee_cents === null, JSON.stringify(result));
  row = await feeRow(manualOrder);
  check("5. linha manual com quem lançou, nota sem espaços nas pontas e fora da fila",
    row.source === "manual" && row.fee_cents === 300 && row.net_cents === 4700 && row.set_by === admin
      && row.set_by_name === "Admin Teste" && row.note === "Extrato do banco de 20/10" && row.attempts === 0
      && row.last_error === null && (await inQueue(manualOrder)) === undefined, JSON.stringify(row));
  const audit = await q("select * from public.audit_log where action = 'tarifa_lancada' and order_id = $1", [manualOrder]);
  check("5. histórico com tarifa_lancada, actor admin, evento e pedido",
    audit.length === 1 && audit[0].actor_user_id === admin && audit[0].actor_kind === "admin" && audit[0].event_id === ev,
    JSON.stringify(audit));
  check("5. histórico só com valores (sem PII nem nota)",
    JSON.stringify(Object.keys(audit[0].details).sort()) === JSON.stringify(["fee_cents", "previous_fee_cents"])
      && !/@|Extrato|71900000002|Comprador/.test(JSON.stringify(audit[0].details)), JSON.stringify(audit[0].details));
  check("5. manual em pedido pago não marca a reconferência de estorno", row.refund_checked_at === null, JSON.stringify(row));
  check("5. automático depois do manual: 'manual' e nada muda",
    (await record(manualOrder, 5000, 10)) === "manual" && (await feeRow(manualOrder)).fee_cents === 300);
  check("5. automático com valores inválidos depois do manual: 'manual' (antes das checagens de valor)",
    (await record(manualOrder, 4000, 10)) === "manual" && (await record(manualOrder, 5000, 5000)) === "manual"
      && (await record(manualOrder, 5000, 10, { breakdown: { type: "x" } })) === "manual"
      && (await feeRow(manualOrder)).fee_cents === 300);
  const manualRefunded = await addOrder(ev, { status: "estornado" });
  await manual(admin, manualRefunded, 249, "Extrato do banco");
  check("5. manual em pedido estornado marca a reconferência", (await feeRow(manualRefunded)).refund_checked_at !== null);
  check("5. falha depois do manual: 0 e nada muda",
    (await fail(manualOrder, "timeout")) === 0 && (await feeRow(manualOrder)).attempts === 0);
  const second = await manual(admin, manualOrder, 280, "Correção pelo extrato");
  check("5. corrigir de novo devolve a tarifa anterior", second.previous_fee_cents === 300 && (await feeRow(manualOrder)).fee_cents === 280);
  const overApi = await manual(admin, paid, 260, "Extrato confere");
  check("5. manual por cima de tarifa automática guarda a anterior", overApi.previous_fee_cents === 250);

  const noFeeYet = await addOrder(ev);
  await fail(noFeeYet, "timeout");
  await rejects("5. pendentes de tarifa: secretaria TAXA_ADMIN",
    () => svc("select * from public.event_fee_pending_orders($1, $2)", [sec, ev]), /^TAXA_ADMIN/);
  const pendingList = await svc("select * from public.event_fee_pending_orders($1, $2)", [dev, ev]);
  const pendingIds = new Set(pendingList.map((r) => r.order_id));
  check("5. pendentes de tarifa (Admin desenvolvedor lê): só os pagos sem tarifa",
    pendingIds.has(noFeeYet) && pendingIds.has(refundedNoFee) && !pendingIds.has(paid) && !pendingIds.has(pending)
      && !pendingIds.has(manualOrder) && !pendingIds.has(courtesy), JSON.stringify(pendingList));
  const noFeeRow = pendingList.find((r) => r.order_id === noFeeYet);
  check("5. pendente mostra status, total, tentativas e erro",
    noFeeRow.status === "pago" && noFeeRow.total_cents === 5000 && noFeeRow.attempts === 1 && noFeeRow.last_error === "timeout",
    JSON.stringify(noFeeRow));

  // ======================= 5B) TARIFA DO EVENTO PELO EXTRATO =======================
  // shown = [pedidos, soma em centavos] que a tela do Admin mostrou.
  const eventTotal = (actor, eventId, shown, total, note) => scalar(
    "select public.record_event_fee_total($1, $2, $3, $4, $5, $6) as v", [actor, eventId, shown[0], shown[1], total, note]);
  const SHOWN = [10, 52500];
  const evStatement = await teamEvent("evento-extrato", "Evento Extrato");
  const stmtOrders = [];
  for (let i = 0; i < 10; i += 1) stmtOrders.push(await addOrder(evStatement, { total: 5250 }));
  await fail(stmtOrders[3], "nao_achou");
  const stmtWithApi = await addOrder(evStatement, { total: 5000 });
  await record(stmtWithApi, 5000, 249);
  const stmtPending = await addOrder(evStatement, { status: "pendente", total: 5250 });
  const stmtCourtesy = await addOrder(evStatement, { total: 0, provider: "cortesia" });
  const stmtFees = () => q(
    "select order_id, fee_cents, net_cents, source, note, set_by, set_by_name, attempts, last_error, refund_checked_at from public.order_payment_fees where order_id = any($1::uuid[])",
    [stmtOrders]);

  await rejects("5B. secretaria: TAXA_ADMIN", () => eventTotal(sec, evStatement, SHOWN, 1356, "Extrato"), /^TAXA_ADMIN/);
  await rejects("5B. Admin desenvolvedor: TAXA_DEV", () => eventTotal(dev, evStatement, SHOWN, 1356, "Extrato"), /^TAXA_DEV/);
  await rejects("5B. desconhecido: TAXA_ADMIN", () => eventTotal(randomUUID(), evStatement, SHOWN, 1356, "Extrato"), /^TAXA_ADMIN/);
  await rejects("5B. total negativo: TARIFA_VALOR", () => eventTotal(admin, evStatement, SHOWN, -1, "Extrato"), /^TARIFA_VALOR/);
  await rejects("5B. total nulo: TARIFA_VALOR", () => eventTotal(admin, evStatement, SHOWN, null, "Extrato"), /^TARIFA_VALOR/);
  await rejects("5B. total maior que a soma dos pendentes: TARIFA_VALOR",
    () => eventTotal(admin, evStatement, SHOWN, 52501, "Extrato"), /^TARIFA_VALOR/);
  await rejects("5B. sem nota: TARIFA_NOTA", () => eventTotal(admin, evStatement, SHOWN, 1356, "  "), /^TARIFA_NOTA/);
  await rejects("5B. nota com quebra de linha: TARIFA_NOTA", () => eventTotal(admin, evStatement, SHOWN, 1356, "a\nb"), /^TARIFA_NOTA/);
  await rejects("5B. nota longa: TARIFA_NOTA", () => eventTotal(admin, evStatement, SHOWN, 1356, "x".repeat(141)), /^TARIFA_NOTA/);
  await rejects("5B. tela mostrou outro número de pedidos: TARIFA_MUDOU:10",
    () => eventTotal(admin, evStatement, [9, 52500], 1356, "Extrato"), /^TARIFA_MUDOU:10$/);
  await rejects("5B. tela mostrou outra soma: TARIFA_MUDOU:10",
    () => eventTotal(admin, evStatement, [10, 47250], 1356, "Extrato"), /^TARIFA_MUDOU:10$/);
  await rejects("5B. tela sem números: TARIFA_MUDOU:10",
    () => eventTotal(admin, evStatement, [null, null], 1356, "Extrato"), /^TARIFA_MUDOU:10$/);
  check("5B. nada gravado pelas tentativas recusadas (inclusive TARIFA_MUDOU)",
    (await stmtFees()).every((r) => r.fee_cents === null) && (await stmtFees()).length === 1
      && (await one("select count(*)::int as n from public.audit_log where action = 'tarifa_lancada' and event_id = $1", [evStatement])).n === 0);

  const stmtResult = await eventTotal(admin, evStatement, SHOWN, 1356, "  Extrato de outubro  ");
  check("5B. devolve evento, pedidos e total",
    stmtResult.event_id === evStatement && stmtResult.orders === 10 && stmtResult.total_fee_cents === 1356,
    JSON.stringify(stmtResult));
  const stmtRows = await stmtFees();
  const firstById = (await one("select id from public.orders where id = any($1::uuid[]) order by id limit 1", [stmtOrders])).id;
  const fees141 = stmtRows.filter((r) => r.fee_cents === 141);
  check("5B. R$ 13,56 em 10 pedidos de R$ 52,50: 9 de 135 e 1 de 141 (resto no menor id)",
    stmtRows.length === 10 && stmtRows.filter((r) => r.fee_cents === 135).length === 9
      && fees141.length === 1 && fees141[0].order_id === firstById,
    JSON.stringify(stmtRows.map((r) => r.fee_cents)));
  check("5B. soma das tarifas = 1356", stmtRows.reduce((s, r) => s + r.fee_cents, 0) === 1356);
  check("5B. cada linha manual, mesma nota sem espaços, quem lançou, líquido certo e sem reconferência de estorno",
    stmtRows.every((r) => r.source === "manual" && r.note === "Extrato de outubro" && r.set_by === admin
      && r.set_by_name === "Admin Teste" && r.net_cents === 5250 - r.fee_cents && r.attempts === 0
      && r.last_error === null && r.refund_checked_at === null), JSON.stringify(stmtRows));
  check("5B. pedido com tarifa automática, pendente e cortesia não mudam",
    (await feeRow(stmtWithApi)).fee_cents === 249 && (await feeRow(stmtWithApi)).source === "api"
      && (await feeRow(stmtPending)) === undefined && (await feeRow(stmtCourtesy)) === undefined);
  const stmtAudit = await q("select * from public.audit_log where action = 'tarifa_lancada' and event_id = $1", [evStatement]);
  check("5B. histórico: uma linha tarifa_lancada do evento, sem pedido, actor admin",
    stmtAudit.length === 1 && stmtAudit[0].order_id === null && stmtAudit[0].actor_user_id === admin
      && stmtAudit[0].actor_kind === "admin" && stmtAudit[0].organizer_id === null, JSON.stringify(stmtAudit));
  check("5B. histórico só com valores (total e pedidos)",
    JSON.stringify(stmtAudit[0]?.details) === JSON.stringify({ orders: 10, total_fee_cents: 1356 }),
    JSON.stringify(stmtAudit[0]?.details));
  check("5B. pedidos saem da fila e dos pendentes",
    (await missing()).every((r) => !stmtOrders.includes(r.order_id))
      && (await svc("select * from public.event_fee_pending_orders($1, $2)", [admin, evStatement])).length === 0);
  check("5B. automático depois: 'manual' e nada muda",
    (await record(stmtOrders[0], 5250, 10)) === "manual" && (await feeRow(stmtOrders[0])).source === "manual");
  await rejects("5B. segunda vez (mesma tela): TARIFA_NADA antes de TARIFA_MUDOU",
    () => eventTotal(admin, evStatement, SHOWN, 1356, "Extrato"), /^TARIFA_NADA/);
  await rejects("5B. evento inexistente: TARIFA_NADA", () => eventTotal(admin, randomUUID(), [1, 5000], 0, "Extrato"), /^TARIFA_NADA/);
  check("5B. segunda vez não grava histórico",
    (await one("select count(*)::int as n from public.audit_log where action = 'tarifa_lancada' and event_id = $1", [evStatement])).n === 1);

  // Resto nunca passa do valor do pedido; estornado marca a reconferência; total zero vale.
  const evUneven = await teamEvent("evento-desigual", "Evento Desigual");
  const big = await addOrder(evUneven, { total: 10000 });
  const smalls = [await addOrder(evUneven, { total: 100 }), await addOrder(evUneven, { total: 100 }),
    await addOrder(evUneven, { total: 100, status: "estornado" })];
  await eventTotal(admin, evUneven, [4, 10300], 10299, "Extrato");
  const uneven = await q("select order_id, fee_cents, gross_cents, refund_checked_at from public.order_payment_fees where order_id = any($1::uuid[])",
    [[big, ...smalls]]);
  check("5B. distribuição desigual: soma certa e nenhuma tarifa acima do valor do pedido",
    uneven.length === 4 && uneven.reduce((s, r) => s + r.fee_cents, 0) === 10299
      && uneven.every((r) => r.fee_cents <= r.gross_cents) && uneven.find((r) => r.order_id === big).fee_cents === 10000,
    JSON.stringify(uneven));
  check("5B. só o estornado marca a reconferência",
    uneven.every((r) => (r.order_id === smalls[2]) === (r.refund_checked_at !== null)), JSON.stringify(uneven));
  const evZero = await teamEvent("evento-zero", "Evento Zero");
  const zeroOrder = await addOrder(evZero);
  check("5B. total zero vale (tarifa 0 em cada pedido)",
    (await eventTotal(admin, evZero, [1, 5000], 0, "Extrato sem tarifa")).orders === 1 && (await feeRow(zeroOrder)).fee_cents === 0);

  // Evento de organizador: trava o dinheiro do organizador.
  const orgUser = randomUUID();
  await q("insert into auth.users (id, email) values ($1, 'org@exemplo.com')", [orgUser]);
  await q(`insert into public.organizer_profiles (user_id, full_name, public_name, phone, pix_key_type, pix_key,
    pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id)
    values ($1, 'Fulana de Tal', 'Produtora A', '71900000001', 'cpf', '52998224725', 'Fulana de Tal', '52998224725',
            '2026-10-14', now(), gen_random_uuid())`, [orgUser]);
  await q("select set_config('byla.organizer_flow', 'on', false)");
  const evOrg = (await one(
    `insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open, organizer_id)
     values ('evento-org', 'Evento Org', 'Espaço', '', $1, 30, false, $2) returning id`, [days(7), orgUser])).id;
  await q("select set_config('byla.organizer_flow', '', false)");
  if (!(await one("select 1 as x from public.event_sessions where event_id = $1", [evOrg]))) {
    await q("insert into public.event_sessions (event_id, starts_at, capacity) values ($1, $2, 30)", [evOrg, days(7)]);
  }
  const orgOrder = await addOrder(evOrg);
  const orgManualOrder = await addOrder(evOrg);
  // Outra conexão segura a trava do organizador; a chamada tem de esperar (lock timeout).
  const whileOrgLocked = async (sql, params) => {
    const locker = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: "byla" });
    locker.on("error", () => {});
    await locker.connect();
    await locker.query("begin");
    await locker.query("select pg_advisory_xact_lock(hashtextextended('organizer_payout:' || $1::text, 0))", [orgUser]);
    try {
      await db.query("begin");
      try {
        await db.query("set local role service_role");
        await db.query("set local lock_timeout = '300ms'");
        await db.query(sql, params);
      } finally {
        await db.query("rollback");
      }
    } finally {
      await locker.query("rollback");
      await locker.end();
    }
  };
  await rejects("5B. evento de organizador espera a trava do dinheiro do organizador",
    () => whileOrgLocked("select public.record_event_fee_total($1, $2, 2, 10000, 498, 'Extrato')", [admin, evOrg]), /lock timeout/);
  await rejects("5B. lançamento manual em pedido de organizador espera a mesma trava",
    () => whileOrgLocked("select public.record_payment_fee_manual($1, $2, 249, 'Extrato')", [admin, orgManualOrder]), /lock timeout/);
  check("5B. nada gravado enquanto a trava estava presa",
    (await feeRow(orgOrder)) === undefined && (await feeRow(orgManualOrder)) === undefined);
  check("5B. manual em pedido de organizador grava depois de soltar a trava",
    (await manual(admin, orgManualOrder, 249, "Extrato")).fee_cents === 249);
  await eventTotal(admin, evOrg, [1, 5000], 249, "Extrato");
  const orgAudit = await one(
    "select organizer_id, details from public.audit_log where action = 'tarifa_lancada' and event_id = $1 and order_id is null", [evOrg]);
  check("5B. depois de soltar a trava grava, com o organizador no histórico",
    (await feeRow(orgOrder)).fee_cents === 249 && orgAudit?.organizer_id === orgUser, JSON.stringify(orgAudit));

  // ======================= 6) IMUTABILIDADE =======================
  await rejects("6. apagar tarifa: TAXA_IMUTAVEL", () => q("delete from public.order_payment_fees where order_id = $1", [paid]), /TAXA_IMUTAVEL/);
  await rejects("6. truncate da tarifa: TAXA_IMUTAVEL", () => q("truncate public.order_payment_fees"), /TAXA_IMUTAVEL/);
  await rejects("6. alterar feriado: TAXA_IMUTAVEL",
    () => q("update public.business_holidays set name = 'Outro nome' where day = '2026-01-01'"), /TAXA_IMUTAVEL/);
  await rejects("6. apagar feriado: TAXA_IMUTAVEL", () => q("delete from public.business_holidays where day = '2026-01-01'"), /TAXA_IMUTAVEL/);
  await rejects("6. truncate dos feriados: TAXA_IMUTAVEL", () => q("truncate public.business_holidays"), /TAXA_IMUTAVEL/);
  await rejects("6. tarifa com soma errada: check", async () => q(
    "insert into public.order_payment_fees (order_id, gross_cents, fee_cents, net_cents) values ($1, 5000, 100, 1)", [await addOrder(ev)]),
  /order_payment_fees_sum_check/);
  await rejects("6. manual sem quem lançou: check", async () => q(
    `insert into public.order_payment_fees (order_id, gross_cents, fee_cents, net_cents, source)
     values ($1, 5000, 100, 4900, 'manual')`, [await addOrder(ev)]), /order_payment_fees_manual_check/);
  await rejects("6. histórico recusa ação desconhecida",
    () => q("insert into public.audit_log (actor_kind, action) values ('sistema', 'acao_inventada')"), /audit_log_action_check/);

  // ======================= 7) PERMISSÕES =======================
  for (const table of ["order_payment_fees", "business_holidays"]) {
    await rejects(`7. ${table}: anônimo sem acesso`, () => anon(`select 1 from public.${table}`), /permission denied/);
    await rejects(`7. ${table}: logado sem acesso`, () => authed(sec, `select 1 from public.${table}`), /permission denied/);
    await rejects(`7. ${table}: servidor sem acesso direto`, () => svc(`select 1 from public.${table}`), /permission denied/);
    const rls = await one("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]);
    const pols = await q("select policyname from pg_policies where schemaname = 'public' and tablename = $1", [table]);
    check(`7. ${table}: RLS ligada e sem políticas`, rls.relrowsecurity === true && pols.length === 0);
  }
  const fnNames = [...new Set([...readFileSync(join(MIGRATIONS, MIGRATION_FEES), "utf8")
    .matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]))];
  const procs = await q(
    `select p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('service_role', p.oid, 'execute') as svc
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [fnNames]);
  check("7. todas as funções novas existem (10)", fnNames.length === 10 && procs.length === fnNames.length,
    `${procs.length}/${fnNames.length}`);
  for (const p of procs) {
    check(`7. ${p.sig}: definer, search_path vazio, só service_role`,
      p.prosecdef && JSON.stringify(p.proconfig) === JSON.stringify(['search_path=""']) && !p.anon && !p.auth && p.svc,
      JSON.stringify(p));
  }
  await rejects("7. anônimo não executa nth_business_day", () => anon("select public.nth_business_day(current_date, 5)"), /permission denied/);
  await rejects("7. logado não executa record_payment_fee",
    () => authed(admin, "select public.record_payment_fee($1, 5000, 1, '[]'::jsonb, null, false)", [noFeeYet]), /permission denied/);
  await rejects("7. logado não executa record_payment_fee_manual",
    () => authed(admin, "select public.record_payment_fee_manual($1, $2, 1, 'x')", [admin, noFeeYet]), /permission denied/);
  await rejects("7. anônimo não executa orders_missing_fee", () => anon("select * from public.orders_missing_fee(5)"), /permission denied/);
  await rejects("7. anônimo não executa record_event_fee_total",
    () => anon("select public.record_event_fee_total($1, $2, 1, 5000, 1, 'x')", [admin, ev]), /permission denied/);
  await rejects("7. logado não executa record_event_fee_total",
    () => authed(admin, "select public.record_event_fee_total($1, $2, 1, 5000, 1, 'x')", [admin, ev]), /permission denied/);

  // ======================= R) REPASSES AO ORGANIZADOR (Migration B) =======================
  check("R. a migration dos repasses existe", files.includes(MIGRATION_PAYOUTS), files.slice(-3).join(","));
  const TZ = hasTz ? "America/Sao_Paulo" : "UTC";
  const today = await scalar(`select (now() at time zone '${TZ}')::date::text as v`);
  const addDays = (date, n) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const at19 = (date) => `${date} 22:00:00+00`;
  await q("update public.organizer_settings set enabled = true");

  const newOrg = async (email, publicName, pixType, pixKey, doc = "52998224725") => {
    const id = randomUUID();
    await q("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await q(`insert into public.organizer_profiles (user_id, full_name, public_name, phone, pix_key_type, pix_key,
      pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id)
      values ($1, 'Titular Secreto', $2, '71900000001', $3, $4, 'Titular Secreto', $5, '2026-10-14', now(), gen_random_uuid())`,
    [id, publicName, pixType, pixKey, doc]);
    return id;
  };
  const orgP = await newOrg("p@exemplo.com", "Produtora P", "cpf", "52998224725");
  const orgQ = await newOrg("q@exemplo.com", "Produtora Q", "email", "chave.secreta@exemplo.com");
  const orgR = await newOrg("r@exemplo.com", "Produtora R", "telefone", "+5571988887777");
  const orgS = await newOrg("s@exemplo.com", "Produtora S", "cnpj", "11222333000181", "11222333000181");
  const orgT = await newOrg("t@exemplo.com", "Produtora T", "aleatoria", "123e4567-e89b-12d3-a456-426614174000");

  let slugN = 0;
  const orgEvent = async (org, name, startDate, approval = "aprovado") => {
    slugN += 1;
    await q("select set_config('byla.organizer_flow', 'on', false)");
    const id = (await one(
      `insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open, organizer_id, approval_status)
       values ($1, $2, 'Espaço', '', $3, 30, false, $4, $5) returning id`,
      [`org-ev-${slugN}`, name, at19(startDate), org, approval])).id;
    await q("select set_config('byla.organizer_flow', '', false)");
    if (!(await one("select 1 as x from public.event_sessions where event_id = $1", [id]))) {
      await q("insert into public.event_sessions (event_id, starts_at, capacity) values ($1, $2, 30)", [id, at19(startDate)]);
    }
    return id;
  };
  const orgOrderOf = async (eventId, { status = "pago", subtotal = 5000, svcFee = 250, provider = "mercadopago", createdAt = null } = {}) => (await one(
    `insert into public.orders (event_id, session_id, buyer_name, buyer_email, buyer_phone, total_cents, tickets_subtotal_cents,
                                service_fee_cents, status, public_token, paid_at, payment_provider, provider_order_id,
                                decision_reason, created_at)
     values ($1, $2, 'Comprador Secreto', 'comprador.secreto@exemplo.com', '71900000002', $3, $4, $5, $6::public.order_status, $7,
             case when $6::text in ('pago', 'estornado', 'aguardando_decisao') then now() end, $8, $9,
             case when $6::text = 'aguardando_decisao' then 'sem_vaga' end, coalesce($10::timestamptz, now()))
     returning id`,
    [eventId, await sessionOf(eventId), subtotal + svcFee, subtotal, svcFee, status, randomUUID(), provider,
      `ORD${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`, createdAt])).id;
  const refundOrder = async (orderId) => {
    const o = await one("select total_cents from public.orders where id = $1", [orderId]);
    await q("update public.orders set status = 'estornado' where id = $1", [orderId]);
    const refundId = randomUUID();
    await q(`insert into public.order_refunds (id, order_id, amount_cents, status, idempotency_key, previous_order_status,
      requested_by_name, reason, completed_at)
      values ($1, $2, $3, 'concluido', $4, 'pago', 'Admin Teste', 'Estorno de teste', clock_timestamp())`,
    [refundId, orderId, o.total_cents, refundId]);
  };
  const balance = (eventId) => one("select * from public.organizer_event_balance($1)", [eventId]);
  const pay = (actor, eventId, expected, pixDate = today, note = null) => scalar(
    "select public.record_organizer_payout($1, $2, $3, $4::date, $5) as v", [actor, eventId, expected, pixDate, note]);
  const adjust = (actor, eventId, cents, reason) => scalar(
    "select public.record_organizer_payout_adjustment($1, $2, $3, $4) as v", [actor, eventId, cents, reason]);
  const received = (actor, org, cents, pixDate = today, note = null) => scalar(
    "select public.record_organizer_refund_received($1, $2, $3, $4::date, $5) as v", [actor, org, cents, pixDate, note]);
  const finance = (actor, eventId) => scalar("select public.organizer_event_finance($1, $2) as v", [actor, eventId]);
  const details = (actor, eventId) => scalar("select public.organizer_payout_details($1, $2) as v", [actor, eventId]);
  const refresh = () => svc("select * from public.refresh_organizer_balance_flags()");
  const summary = () => scalar("select public.organizer_finance_daily_summary() as v");
  const openFlag = (eventId) => one("select * from public.organizer_balance_flags where event_id = $1 and resolved_at is null", [eventId]);
  const whileLocked = async (orgId, sql, params) => {
    const locker = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: "byla" });
    locker.on("error", () => {});
    await locker.connect();
    await locker.query("begin");
    await locker.query("select pg_advisory_xact_lock(hashtextextended('organizer_payout:' || $1::text, 0))", [orgId]);
    try {
      await db.query("begin");
      try {
        await db.query("set local role service_role");
        await db.query("set local lock_timeout = '300ms'");
        await db.query(sql, params);
      } finally {
        await db.query("rollback");
      }
    } finally {
      await locker.query("rollback");
      await locker.end();
    }
  };

  // R1/R2/R11) Exemplo da spec (R$ 439,05), em conferência e pago sem vaga
  const e1 = await orgEvent(orgP, "Show Um", addDays(today, -10));
  const e1Orders = [];
  for (let i = 0; i < 10; i += 1) e1Orders.push(await orgOrderOf(e1));
  const e1Decision = await orgOrderOf(e1, { status: "aguardando_decisao" });
  await record(e1Decision, 5250, 52);
  await orgOrderOf(e1, { status: "pendente" });
  await orgOrderOf(e1, { subtotal: 0, svcFee: 0, provider: "cortesia" });
  for (let i = 0; i < 6; i += 1) await record(e1Orders[i], 5250, 52);
  await record(e1Orders[6], 5250, 261);
  await record(e1Orders[9], 5250, 261);
  await refundOrder(e1Orders[9]);
  await record(e1Orders[9], 5250, 0, { afterRefund: true });
  let b = await balance(e1);
  check("R2. dois pedidos sem tarifa: em conferência 2 pedidos / R$ 100,00 e parte só dos outros",
    b.pending_fee_orders === 2 && Number(b.pending_cents) === 10000 && Number(b.share_cents) === 7 * 5000 - 573
      && Number(b.balance_cents) === 7 * 5000 - 573, JSON.stringify(b));
  await record(e1Orders[7], 5250, 261);
  await record(e1Orders[8], 5250, 261);
  b = await balance(e1);
  check("R1. exemplo da spec: parte 43905, tarifa 1095, estornos 5000, taxa de serviço 2250",
    Number(b.share_cents) === 43905 && Number(b.bank_fee_cents) === 1095 && Number(b.refunded_cents) === 5000
      && b.refunded_orders === 1 && Number(b.sold_cents) === 50000 && b.sold_orders === 10
      && Number(b.service_fee_cents) === 2250 && b.pending_fee_orders === 0 && Number(b.pending_cents) === 0
      && Number(b.paid_out_cents) === 0 && Number(b.balance_cents) === 43905, JSON.stringify(b));
  check("R2. depois das tarifas a parte sobe", Number(b.share_cents) > 7 * 5000 - 573);
  check("R11. pago sem vaga fora do vendido e da parte, contado em decision_orders",
    b.decision_orders === 1 && Number(b.sold_cents) === 50000, JSON.stringify(b));

  // R3) Prazo e data do PIX
  const eFuture = await orgEvent(orgP, "Show Futuro", addDays(today, 5));
  const futureOrder = await orgOrderOf(eFuture);
  await record(futureOrder, 5250, 52);
  await rejects("R3. repasse antes do dia seguinte à última sessão: ORG_PRAZO",
    () => pay(admin, eFuture, 4948), /^ORG_PRAZO/);
  await rejects("R3. data do PIX no futuro: ORG_DATA", () => pay(admin, e1, 43905, addDays(today, 1)), /^ORG_DATA/);
  await rejects("R3. data do PIX antes do fim do evento: ORG_DATA", () => pay(admin, e1, 43905, addDays(today, -15)), /^ORG_DATA/);
  await rejects("R3. data do PIX vazia: ORG_DATA", () => pay(admin, e1, 43905, null), /^ORG_DATA/);
  await rejects("R3. nota com quebra de linha: ORG_NOTA", () => pay(admin, e1, 43905, today, "a\nb"), /^ORG_NOTA/);
  await rejects("R3. evento sem organizador: ORG_ACESSO", () => pay(admin, ev, 100), /^ORG_ACESSO/);

  // R4) Valor que mudou
  await rejects("R4. valor esperado diferente: ORG_MUDOU:43905", () => pay(admin, e1, 43000), /^ORG_MUDOU:43905$/);
  await rejects("R4. valor esperado vazio: ORG_MUDOU:43905", () => pay(admin, e1, null), /^ORG_MUDOU:43905$/);

  // R5) Papéis
  await rejects("R5. secretaria: TAXA_ADMIN", () => pay(sec, e1, 43905), /^TAXA_ADMIN/);
  await rejects("R5. Admin desenvolvedor: TAXA_DEV", () => pay(dev, e1, 43905), /^TAXA_DEV/);
  await rejects("R5. organizador: TAXA_ADMIN", () => pay(orgP, e1, 43905), /^TAXA_ADMIN/);
  await rejects("R5. ajuste pela secretaria: TAXA_ADMIN", () => adjust(sec, e1, 100, "Motivo do ajuste"), /^TAXA_ADMIN/);
  await rejects("R5. ajuste pelo desenvolvedor: TAXA_DEV", () => adjust(dev, e1, 100, "Motivo do ajuste"), /^TAXA_DEV/);
  await rejects("R5. devolução pelo desenvolvedor: TAXA_DEV", () => received(dev, orgP, 100), /^TAXA_DEV/);
  await rejects("R5. repasse espera a trava do dinheiro do organizador",
    () => whileLocked(orgP, "select public.record_organizer_payout($1, $2, 43905, current_date, null)", [admin, e1]), /lock timeout/);
  check("R5. nada gravado pelas tentativas recusadas",
    (await one("select count(*)::int as n from public.organizer_payout_items where event_id = $1", [e1])).n === 0);

  const d1 = await details(admin, e1);
  check("R10. detalhes (Admin): chave completa e valor esperado igual ao do registro",
    d1.pix_key === "52998224725" && d1.pix_holder_document === "52998224725" && d1.pix_key_type === "cpf"
      && Number(d1.expected_amount_cents) === 43905 && d1.discounts.length === 0, JSON.stringify(d1));
  const p1 = await pay(admin, e1, 43905, today, "  PIX conferido  ");
  check("R. repasse registrado: tipo repasse, valor 43905, sem desconto",
    p1.kind === "repasse" && Number(p1.amount_cents) === 43905 && Number(p1.discount_cents) === 0 && p1.organizer_id === orgP,
    JSON.stringify(p1));
  const p1Row = await one("select * from public.organizer_payouts where id = $1", [p1.payout_id]);
  check("R. repasse guarda a chave PIX do momento, quem registrou e a nota sem espaços",
    p1Row.pix_key_snapshot === "52998224725" && p1Row.pix_key_type === "cpf" && p1Row.pix_holder_name_snapshot === "Titular Secreto"
      && p1Row.pix_holder_document_snapshot === "52998224725" && p1Row.created_by === admin
      && p1Row.created_by_name === "Admin Teste" && p1Row.note === "PIX conferido", JSON.stringify(p1Row));
  check("R. saldo zerado depois do repasse", Number((await balance(e1)).balance_cents) === 0);
  await rejects("R. segundo repasse do mesmo evento: ORG_NADA", () => pay(admin, e1, 0), /^ORG_NADA/);
  const p1Audit = await one("select * from public.audit_log where action = 'repasse_registrado' and event_id = $1", [e1]);
  check("R. histórico do repasse só com valores",
    p1Audit?.organizer_id === orgP && p1Audit?.actor_kind === "admin"
      && JSON.stringify(p1Audit.details) === JSON.stringify({ amount_cents: 43905, discount_cents: 0 }), JSON.stringify(p1Audit));

  // R2b) Tarifa pendente com saldo zero
  const ePending = await orgEvent(orgS, "Show Pendente", addDays(today, -6));
  await orgOrderOf(ePending);
  await rejects("R2. saldo zero com tarifa pendente: ORG_TARIFA_PENDENTE:1", () => pay(admin, ePending, 0), /^ORG_TARIFA_PENDENTE:1$/);

  // R6) Desconto no próximo repasse
  await refundOrder(e1Orders[0]);
  await record(e1Orders[0], 5250, 52, { afterRefund: true });
  check("R6. estorno tardio de PIX (tarifa mantida): saldo de E1 = −5000",
    Number((await balance(e1)).balance_cents) === -5000, JSON.stringify(await balance(e1)));
  check("R6. cron abre a marcação de E1 (sem e-mail ainda)",
    (await refresh()).every((r) => r.event_id !== e1) && (await openFlag(e1))?.negative_since instanceof Date);
  const e2 = await orgEvent(orgP, "Show Dois", addDays(today, -5));
  for (let i = 0; i < 4; i += 1) await record(await orgOrderOf(e2), 5250, 0);
  const d2 = await details(admin, e2);
  check("R6. detalhes mostram 15000 a pagar e o desconto de E1",
    Number(d2.expected_amount_cents) === 15000 && d2.discounts.length === 1 && d2.discounts[0].event_name === "Show Um"
      && Number(d2.discounts[0].cents) === 5000, JSON.stringify(d2));
  await rejects("R6. tela com o valor sem desconto: ORG_MUDOU:15000", () => pay(admin, e2, 20000), /^ORG_MUDOU:15000$/);
  const p2 = await pay(admin, e2, 15000);
  const p2Items = await q("select event_id, amount_cents from public.organizer_payout_items where payout_id = $1", [p2.payout_id]);
  check("R6. repasse de 15000 com itens E2 +20000 e E1 −5000",
    Number(p2.amount_cents) === 15000 && Number(p2.discount_cents) === 5000 && p2Items.length === 2
      && p2Items.find((i) => i.event_id === e2)?.amount_cents === 20000
      && p2Items.find((i) => i.event_id === e1)?.amount_cents === -5000, JSON.stringify(p2Items));
  check("R6. E1 volta a 0 e a marcação fecha",
    Number((await balance(e1)).balance_cents) === 0 && (await openFlag(e1)) === undefined);

  // R7) Compensação sem PIX
  const e3 = await orgEvent(orgQ, "Show Tres", addDays(today, -20));
  await rejects("R7. ajuste de valor zero: ORG_VALOR", () => adjust(admin, e3, 0, "Motivo do ajuste"), /^ORG_VALOR/);
  await rejects("R7. ajuste sem motivo: ORG_MOTIVO", () => adjust(admin, e3, 5000, " abc "), /^ORG_MOTIVO/);
  await rejects("R7. ajuste em evento da equipe: ORG_ACESSO", () => adjust(admin, ev, 5000, "Motivo do ajuste"), /^ORG_ACESSO/);
  const adj = await adjust(admin, e3, 5000, "  Cobrança a favor do Espaço  ");
  check("R7. ajuste a favor do Espaço deixa E3 com −5000",
    typeof adj === "string" && Number((await balance(e3)).balance_cents) === -5000);
  const adjAudit = await one("select details from public.audit_log where action = 'repasse_ajuste' and event_id = $1", [e3]);
  check("R7. histórico do ajuste sem o motivo", JSON.stringify(adjAudit?.details) === JSON.stringify({ amount_cents: 5000 }),
    JSON.stringify(adjAudit));
  const e4 = await orgEvent(orgQ, "Show Quatro", addDays(today, -3));
  for (let i = 0; i < 3; i += 1) await record(await orgOrderOf(e4, { subtotal: 1000, svcFee: 0 }), 1000, 0);
  await rejects("R7. compensação com valor esperado errado: ORG_MUDOU:0", () => pay(admin, e4, 3000), /^ORG_MUDOU:0$/);
  const p7 = await pay(admin, e4, 0, null);
  const p7Row = await one("select * from public.organizer_payouts where id = $1", [p7.payout_id]);
  const p7Items = await q("select event_id, amount_cents from public.organizer_payout_items where payout_id = $1", [p7.payout_id]);
  check("R7. compensação: valor 0, sem PIX, itens E4 +3000 e E3 −3000",
    p7.kind === "compensacao" && Number(p7.amount_cents) === 0 && p7Row.pix_date === null && p7Row.pix_key_snapshot === null
      && p7Items.find((i) => i.event_id === e4)?.amount_cents === 3000 && p7Items.find((i) => i.event_id === e3)?.amount_cents === -3000,
    JSON.stringify({ p7, p7Items }));
  check("R7. E3 fica com −2000 e E4 com 0",
    Number((await balance(e3)).balance_cents) === -2000 && Number((await balance(e4)).balance_cents) === 0);
  check("R7. histórico: repasse_compensado",
    (await one("select count(*)::int as n from public.audit_log where action = 'repasse_compensado' and event_id = $1", [e4])).n === 1);

  // R8) Devolução pendente, atrasada e recebida
  const e5 = await orgEvent(orgR, "Show Cinco", addDays(today, -40));
  await adjust(admin, e5, 5000, "Contestação depois do repasse");
  await refresh();
  const flag5 = await openFlag(e5);
  check("R8. marcação aberta hoje, sem prazo de devolução", flag5?.return_due_date === null, JSON.stringify(flag5));
  await q("update public.organizer_balance_flags set negative_since = $2::date where id = $1", [flag5.id, addDays(today, -30)]);
  const due8 = await refresh();
  const row8 = due8.find((r) => r.event_id === e5);
  const dateText = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d);
  check("R8. 30 dias negativo: cron devolve a linha com prazo hoje + 10",
    row8 && row8.flag_id === flag5.id && row8.organizer_id === orgR && row8.event_name === "Show Cinco"
      && Number(row8.owed_cents) === 5000 && dateText(row8.return_due_date) === addDays(today, 10), JSON.stringify(due8));
  check("R8. histórico devolucao_pendente pelo sistema",
    (await one("select actor_kind from public.audit_log where action = 'devolucao_pendente' and event_id = $1", [e5]))?.actor_kind === "sistema");
  await svc("select public.mark_balance_flag_notified($1)", [flag5.id]);
  check("R8. depois do aviso a linha some do cron", (await refresh()).every((r) => r.event_id !== e5));
  check("R8. ainda no prazo: nenhuma devolução atrasada",
    (await scalar("select public.organizer_overdue_refunds($1) as v", [orgR])) === 0);
  const summaryBefore = await summary();
  await q("update public.organizer_balance_flags set return_due_date = $2::date where id = $1", [flag5.id, addDays(today, -1)]);
  check("R8. prazo vencido: organizer_overdue_refunds = 1",
    (await scalar("select public.organizer_overdue_refunds($1) as v", [orgR])) === 1);
  const draftR = await orgEvent(orgR, "Rascunho R", addDays(today, 20), "rascunho");
  await rejects("R8. envio para aprovação com devolução atrasada: ORG_DEVOLUCAO",
    () => svc("select public.submit_event_for_approval($1, $2)", [orgR, draftR]), /^ORG_DEVOLUCAO/);
  const summaryLate = await summary();
  check("R8/resumo: devolução atrasada conta 1", summaryLate.late_refunds === summaryBefore.late_refunds + 1 && summaryLate.late_refunds === 1,
    JSON.stringify({ summaryBefore, summaryLate }));
  await rejects("R8. devolução maior que o devido: ORG_VALOR:5000", () => received(admin, orgR, 6000), /^ORG_VALOR:5000$/);
  await rejects("R8. devolução com data futura: ORG_DATA", () => received(admin, orgR, 1000, addDays(today, 1)), /^ORG_DATA/);
  await rejects("R8. organizador sem nada a devolver: ORG_NADA", () => received(admin, orgT, 1000), /^ORG_NADA/);
  const r8a = await received(admin, orgR, 2000);
  check("R8. devolução parcial: resta 3000 e a marcação continua",
    Number(r8a.remaining_cents) === 3000 && (await openFlag(e5))?.id === flag5.id, JSON.stringify(r8a));
  const r8b = await received(admin, orgR, 3000);
  check("R8. devolução do resto: saldo 0, marcação resolvida, sem atraso",
    Number(r8b.remaining_cents) === 0 && Number((await balance(e5)).balance_cents) === 0 && (await openFlag(e5)) === undefined
      && (await scalar("select public.organizer_overdue_refunds($1) as v", [orgR])) === 0);
  const r8Rows = await q("select kind, amount_cents, pix_date from public.organizer_payouts where organizer_id = $1 and kind = 'devolucao' order by created_at", [orgR]);
  check("R8. devoluções gravadas negativas com data do PIX",
    r8Rows.length === 2 && r8Rows[0].amount_cents === -2000 && r8Rows[1].amount_cents === -3000 && r8Rows.every((r) => r.pix_date), JSON.stringify(r8Rows));
  const r8Audit = await q("select details from public.audit_log where action = 'devolucao_recebida' and organizer_id = $1 order by created_at", [orgR]);
  check("R8. histórico da devolução só com valores",
    r8Audit.length === 2 && JSON.stringify(r8Audit[0].details) === JSON.stringify({ owed_cents: 5000, amount_cents: 2000 }), JSON.stringify(r8Audit));
  let afterRefund = null;
  try {
    await svc("select public.submit_event_for_approval($1, $2)", [orgR, draftR]);
    afterRefund = "ok";
  } catch (error) {
    afterRefund = error.message;
  }
  check("R8. depois da devolução o envio não esbarra mais em ORG_DEVOLUCAO", !/ORG_DEVOLUCAO/.test(afterRefund), afterRefund);
  check("R8/resumo: devolução recebida zera o atraso", (await summary()).late_refunds === 0);

  // R9) Imutáveis
  await rejects("R9. alterar repasse: TAXA_IMUTAVEL",
    () => q("update public.organizer_payouts set amount_cents = 1 where id = $1", [p1.payout_id]), /TAXA_IMUTAVEL/);
  await rejects("R9. apagar repasse: TAXA_IMUTAVEL",
    () => q("delete from public.organizer_payouts where id = $1", [p1.payout_id]), /TAXA_IMUTAVEL/);
  await rejects("R9. truncate dos repasses: TAXA_IMUTAVEL", () => q("truncate public.organizer_payouts cascade"), /TAXA_IMUTAVEL/);
  await rejects("R9. alterar item: TAXA_IMUTAVEL",
    () => q("update public.organizer_payout_items set amount_cents = 1 where payout_id = $1", [p1.payout_id]), /TAXA_IMUTAVEL/);
  await rejects("R9. apagar item: TAXA_IMUTAVEL",
    () => q("delete from public.organizer_payout_items where payout_id = $1", [p1.payout_id]), /TAXA_IMUTAVEL/);
  await rejects("R9. truncate dos itens: TAXA_IMUTAVEL", () => q("truncate public.organizer_payout_items"), /TAXA_IMUTAVEL/);
  await rejects("R9. repasse sem chave PIX: check", () => q(
    `insert into public.organizer_payouts (organizer_id, kind, amount_cents, pix_date, created_by, created_by_name)
     values ($1, 'repasse', 100, current_date, $2, 'X')`, [orgP, admin]), /organizer_payouts_shape_check/);

  // R10) Visões do organizador e da equipe
  const fOwner = await finance(orgP, e1);
  const ownerJson = JSON.stringify(fOwner);
  check("R10. dono: viewer, números e prazo",
    fOwner.viewer === "dono" && fOwner.event_name === "Show Um" && fOwner.organizer_public_name === "Produtora P"
      && Number(fOwner.share_cents) === 38905 && Number(fOwner.paid_out_cents) === 38905 && Number(fOwner.balance_cents) === 0
      && fOwner.start_date === addDays(today, -9) && fOwner.today === today && fOwner.calendar_until === 2030
      && fOwner.flag === null && fOwner.team === null, ownerJson);
  check("R10. dono: histórico sem quem registrou",
    fOwner.history.length === 2 && fOwner.history.every((h) => !("created_by_name" in h) && h.reason === null)
      && fOwner.history.some((h) => h.kind === "repasse" && Number(h.item_cents) === 43905 && h.note === "PIX conferido")
      && fOwner.history.some((h) => Number(h.item_cents) === -5000 && Number(h.payout_cents) === 15000), ownerJson);
  const orderNumber = e1Orders[0].replaceAll("-", "").slice(0, 8).toUpperCase();
  check("R10. dono: só o estorno depois do repasse em late_changes, com o número do pedido",
    fOwner.late_changes.length === 1 && fOwner.late_changes[0].order_id === e1Orders[0]
      && fOwner.late_changes[0].order_number === orderNumber && fOwner.late_changes[0].kind === "estorno"
      && Number(fOwner.late_changes[0].cents) === 5000, JSON.stringify(fOwner.late_changes));
  check("R10. dono: chave e documento mascarados, nada do comprador",
    fOwner.pix.masked === "•••.982.247-••" && fOwner.pix.type === "cpf" && fOwner.pix.change_pending === false
      && !ownerJson.includes("52998224725") && !/Comprador|comprador\.secreto|71900000002/.test(ownerJson), ownerJson);
  const fAdjOwner = await finance(orgQ, e3);
  const adjEntry = fAdjOwner.history.find((h) => h.kind === "ajuste");
  check("R10. dono vê o motivo do ajuste (sem quem registrou)",
    adjEntry?.reason === "Cobrança a favor do Espaço" && !("created_by_name" in adjEntry) && Number(adjEntry.item_cents) === 5000,
    JSON.stringify(fAdjOwner.history));
  await rejects("R10. organizador de outro evento: ORG_ACESSO", () => finance(orgQ, e1), /^ORG_ACESSO/);
  await rejects("R10. secretaria: ORG_ACESSO", () => finance(sec, e1), /^ORG_ACESSO/);
  await rejects("R10. evento da equipe: ORG_ACESSO", () => finance(admin, ev), /^ORG_ACESSO/);
  const fAdmin = await finance(admin, e1);
  check("R10. Admin: viewer, histórico com quem registrou e bloco da equipe",
    fAdmin.viewer === "admin" && fAdmin.history.every((h) => h.created_by_name === "Admin Teste")
      && fAdmin.team?.organizer_id === orgP && fAdmin.team?.pix_changed_recently === false
      && !JSON.stringify(fAdmin).includes("52998224725"), JSON.stringify(fAdmin));
  check("R10. Admin desenvolvedor lê como admin_dev", (await finance(dev, e1)).viewer === "admin_dev");
  await rejects("R10. detalhes pelo Admin desenvolvedor: TAXA_DEV", () => details(dev, e1), /^TAXA_DEV/);
  await rejects("R10. detalhes pela secretaria: TAXA_ADMIN", () => details(sec, e1), /^TAXA_ADMIN/);
  await rejects("R10. detalhes de evento da equipe: ORG_ACESSO", () => details(admin, ev), /^ORG_ACESSO/);
  await q("update public.organizer_settings set enabled = false");
  await rejects("R10. área desligada: dono sem acesso (ORG_ACESSO)", () => finance(orgP, e1), /^ORG_ACESSO/);
  await q("update public.organizer_settings set enabled = true");

  const from = addDays(today, -30);
  const csv = await svc("select * from public.organizer_payouts_csv($1, $2::date, $3::date)", [dev, from, today]);
  check("R10. CSV: colunas sem PIX nem documento",
    csv.length >= 7 && JSON.stringify(Object.keys(csv[0])) === JSON.stringify(
      ["data_pix", "registrado_em", "tipo", "organizador", "evento", "valor_cents", "registrado_por", "nota_ou_motivo"])
      && !/52998224725|chave\.secreta|5571988887777|Titular Secreto|11222333000181/.test(JSON.stringify(csv)), JSON.stringify(csv.slice(0, 2)));
  check("R10. CSV: um item por linha (repasse de E2 em duas linhas)",
    csv.filter((r) => r.registrado_em.getTime() === p1Row.created_at.getTime()).length === 1
      && csv.filter((r) => r.evento === "Show Dois" || (r.evento === "Show Um" && r.valor_cents === -5000)).length === 2);
  await rejects("R10. CSV pela secretaria: TAXA_ADMIN",
    () => svc("select * from public.organizer_payouts_csv($1, $2::date, $3::date)", [sec, from, today]), /^TAXA_ADMIN/);
  await rejects("R10. CSV com período invertido: ORG_PERIODO",
    () => svc("select * from public.organizer_payouts_csv($1, $2::date, $3::date)", [admin, today, from]), /^ORG_PERIODO/);
  await rejects("R10. visão geral com período longo: ORG_PERIODO",
    () => scalar("select public.organizer_payouts_overview($1, $2::date, $3::date) as v", [admin, addDays(today, -500), today]), /^ORG_PERIODO/);
  await rejects("R10. visão geral pela secretaria: TAXA_ADMIN",
    () => scalar("select public.organizer_payouts_overview($1, $2::date, $3::date) as v", [sec, from, today]), /^TAXA_ADMIN/);

  // R12) Calendário fora do cadastro + resumo diário (atrasado e tarifa sem conferir)
  const e7 = await orgEvent(orgP, "Show 2031", "2031-03-10");
  const f7 = await finance(orgP, e7);
  check("R12. evento em 2031: prazo null (a confirmar), início 11/03/2031",
    f7.due_date === null && f7.start_date === "2031-03-11", JSON.stringify(f7));

  const base = await summary();
  check("R/resumo: sem atraso de repasse (E1, E2 pagos; E4 compensado; futuro ainda não vence)",
    base.late_payouts === 0 && Number(base.late_payouts_cents) === 0 && base.calendar_until === 2030
      && base.late_refunds === 0, JSON.stringify(base));
  const e6 = await orgEvent(orgP, "Show Seis", addDays(today, -30));
  await record(await orgOrderOf(e6, { subtotal: 1000, svcFee: 0 }), 1000, 0);
  const withLate = await summary();
  check("R/resumo: evento vencido com saldo conta como atrasado",
    withLate.late_payouts === 1 && Number(withLate.late_payouts_cents) === 1000, JSON.stringify(withLate));
  await orgOrderOf(eFuture, { createdAt: new Date(Date.now() - 3 * 86400000).toISOString() });
  await orgOrderOf(eFuture);
  await orgOrderOf(ev, { createdAt: new Date(Date.now() - 3 * 86400000).toISOString() });
  const withFees = await summary();
  check("R/resumo: tarifa sem conferir há mais de 2 dias (só eventos de organizador)",
    withFees.fees_pending_2d === base.fees_pending_2d + 1, JSON.stringify({ base, withFees }));
  check("R/resumo: só contagens e somas",
    JSON.stringify(Object.keys(withFees).sort()) === JSON.stringify(
      ["calendar_until", "fees_pending_2d", "late_payouts", "late_payouts_cents", "late_refunds", "today"]));

  const overview = await scalar("select public.organizer_payouts_overview($1, $2::date, $3::date) as v", [dev, from, today]);
  const overviewJson = JSON.stringify(overview);
  const evRow = (id) => overview.events.find((e) => e.event_id === id);
  check("R/visão geral: eventos de organizador, atrasado primeiro",
    overview.events[0]?.event_id === e6 && evRow(e6)?.status === "atrasado" && evRow(e1) && evRow(e2) && evRow(e3)
      && evRow(e4) && evRow(e5) && evRow(eFuture)?.status === "em_andamento" && !evRow(ev)
      && !evRow(e7) && overview.calendar_until === 2030, overviewJson.slice(0, 600));
  check("R/visão geral: último repasse e números do evento",
    evRow(e1).last_payout_at === today && Number(evRow(e1).share_cents) === 38905 && evRow(e1).organizer_public_name === "Produtora P",
    JSON.stringify(evRow(e1)));
  check("R/visão geral: organizador devendo (Q, 2000)",
    overview.organizers_owing.length === 1 && overview.organizers_owing[0].organizer_id === orgQ
      && Number(overview.organizers_owing[0].owed_cents) === 2000, JSON.stringify(overview.organizers_owing));
  check("R/visão geral: lançamentos do período com itens",
    overview.payouts.length === 7 && overview.payouts.find((p) => p.payout_id === p2.payout_id)?.items.length === 2,
    JSON.stringify(overview.payouts.map((p) => p.kind)));
  check("R/visão geral: sem chave PIX, titular, documento ou comprador",
    !/52998224725|chave\.secreta|5571988887777|Titular Secreto|11222333000181|Comprador|comprador\.secreto/.test(overviewJson));

  // Máscaras iguais às de list_organizers
  const listed = await svc("select user_id, pix_key_masked, pix_holder_document_masked from public.list_organizers($1)", [admin]);
  for (const org of [orgP, orgQ, orgR, orgS, orgT]) {
    const mine = await one(`select public.mask_pix_key(op.pix_key_type, op.pix_key) as k, public.mask_tax_document(op.pix_holder_document) as d
      from public.organizer_profiles op where op.user_id = $1`, [org]);
    const fromList = listed.find((r) => r.user_id === org);
    check(`R/máscara igual à de list_organizers (${fromList?.pix_key_masked})`,
      fromList && mine.k === fromList.pix_key_masked && mine.d === fromList.pix_holder_document_masked, JSON.stringify({ mine, fromList }));
  }

  // F1) Ordem dos descontos: marcação aberta mais antiga primeiro; sem marcação = hoje
  const orgV = await newOrg("v@exemplo.com", "Produtora V", "cpf", "52998224725");
  const eA = await orgEvent(orgV, "Show A", addDays(today, -3));
  const eB = await orgEvent(orgV, "Show B", addDays(today, -60));
  await adjust(admin, eA, 4000, "Cobrança do evento A");
  await refresh();
  await q("update public.organizer_balance_flags set negative_since = $2::date where event_id = $1 and resolved_at is null",
    [eA, addDays(today, -5)]);
  await adjust(admin, eB, 3000, "Cobrança do evento B");
  check("F1. B ficou negativo sem marcação (evento mais antigo que A)",
    (await openFlag(eB)) === undefined && Number((await balance(eB)).balance_cents) === -3000);
  const discountOrder = await svc("select event_id from public.organizer_pending_discounts($1, null)", [orgV]);
  check("F1. ordem: A (marcado há 5 dias) antes de B (negativo hoje)",
    discountOrder.length === 2 && discountOrder[0].event_id === eA && discountOrder[1].event_id === eB, JSON.stringify(discountOrder));
  const eC = await orgEvent(orgV, "Show C", addDays(today, -2));
  await record(await orgOrderOf(eC, { subtotal: 2000, svcFee: 0 }), 2000, 0);
  const pV = await pay(admin, eC, 0, null);
  const pVItems = await q("select event_id, amount_cents from public.organizer_payout_items where payout_id = $1", [pV.payout_id]);
  check("F1. repasse abate de A primeiro (parcial): C +2000, A −2000, B intacto",
    pV.kind === "compensacao" && pVItems.length === 2 && pVItems.find((i) => i.event_id === eA)?.amount_cents === -2000
      && !pVItems.some((i) => i.event_id === eB)
      && Number((await balance(eA)).balance_cents) === -2000 && Number((await balance(eB)).balance_cents) === -3000,
    JSON.stringify(pVItems));
  const rV = await received(admin, orgV, 3000);
  const rVItems = await q("select event_id, amount_cents from public.organizer_payout_items where payout_id = $1", [rV.payout_id]);
  check("F1. devolução parcial atravessa os dois: A −2000 (zera), depois B −1000",
    Number(rV.remaining_cents) === 2000 && rVItems.length === 2
      && rVItems.find((i) => i.event_id === eA)?.amount_cents === -2000 && rVItems.find((i) => i.event_id === eB)?.amount_cents === -1000
      && Number((await balance(eA)).balance_cents) === 0 && Number((await balance(eB)).balance_cents) === -2000
      && (await openFlag(eA)) === undefined, JSON.stringify(rVItems));

  // F2) Tarifa em conferência: não cobra devolução
  const orgW = await newOrg("w@exemplo.com", "Produtora W", "cpf", "52998224725");
  const eW = await orgEvent(orgW, "Show W", addDays(today, -40));
  const wOrder = await orgOrderOf(eW);
  await adjust(admin, eW, 5000, "Contestação depois do repasse");
  let bW = await balance(eW);
  check("F2. saldo negativo com tarifa em conferência",
    Number(bW.balance_cents) === -5000 && bW.pending_fee_orders === 1, JSON.stringify(bW));
  await refresh();
  check("F2. cron não abre marcação com tarifa em conferência", (await openFlag(eW)) === undefined);
  const draftW = await orgEvent(orgW, "Rascunho W", addDays(today, 20), "rascunho");
  const submitW = async () => {
    try {
      await svc("select public.submit_event_for_approval($1, $2)", [orgW, draftW]);
      return "ok";
    } catch (error) {
      return error.message;
    }
  };
  check("F2. sem ORG_DEVOLUCAO enquanto a tarifa é conferida", !/ORG_DEVOLUCAO/.test(await submitW()));
  const wFlag = (await one(
    "insert into public.organizer_balance_flags (event_id, organizer_id, negative_since) values ($1, $2, $3::date) returning id",
    [eW, orgW, addDays(today, -40)])).id;
  const wDue = await refresh();
  check("F2. marcação antiga com tarifa em conferência não ganha prazo nem e-mail",
    (await one("select return_due_date from public.organizer_balance_flags where id = $1", [wFlag])).return_due_date === null
      && wDue.every((r) => r.event_id !== eW));
  await q("update public.organizer_balance_flags set return_due_date = $2::date where id = $1", [wFlag, addDays(today, -1)]);
  check("F2. prazo vencido mas tarifa em conferência: sem devolução atrasada",
    (await scalar("select public.organizer_overdue_refunds($1) as v", [orgW])) === 0 && (await summary()).late_refunds === 0
      && !/ORG_DEVOLUCAO/.test(await submitW()));
  await manual(admin, wOrder, 300, "Extrato do banco");
  bW = await balance(eW);
  check("F2. tarifa lançada: saldo −300, devolução atrasada conta (e resumo também)",
    Number(bW.balance_cents) === -300 && bW.pending_fee_orders === 0
      && (await scalar("select public.organizer_overdue_refunds($1) as v", [orgW])) === 1 && (await summary()).late_refunds === 1,
    JSON.stringify(bW));
  check("F2. agora o envio recusa com ORG_DEVOLUCAO", /^ORG_DEVOLUCAO/.test(await submitW()));
  await manual(admin, wOrder, 0, "Correção pelo extrato");
  check("F2. correção leva o saldo a 0: sem atraso na hora (antes do cron)",
    Number((await balance(eW)).balance_cents) === 0 && (await openFlag(eW))?.id === wFlag
      && (await scalar("select public.organizer_overdue_refunds($1) as v", [orgW])) === 0 && (await summary()).late_refunds === 0
      && !/ORG_DEVOLUCAO/.test(await submitW()));
  await refresh();
  check("F2. o cron seguinte fecha a marcação", (await openFlag(eW)) === undefined);

  // F4) Contestação depois do repasse
  const orgU = await newOrg("u@exemplo.com", "Produtora U", "cpf", "52998224725");
  const eU = await orgEvent(orgU, "Show U", addDays(today, -8));
  const uOrders = [await orgOrderOf(eU), await orgOrderOf(eU)];
  for (const o of uOrders) await record(o, 5250, 0);
  await pay(admin, eU, 10000);
  await q(`insert into public.order_chargebacks (order_id, kind, amount_cents, fee_cents, source, reason, created_by_name)
    values ($1, 'contestacao', 5250, 0, 'manual', 'Contestação de teste', 'Admin Teste')`, [uOrders[1]]);
  const bU = await balance(eU);
  check("F4. contestação: contested 5000/1, parte 5000, saldo −5000",
    Number(bU.contested_cents) === 5000 && bU.contested_orders === 1 && Number(bU.share_cents) === 5000
      && Number(bU.balance_cents) === -5000 && Number(bU.sold_cents) === 10000, JSON.stringify(bU));
  const fU = await finance(orgU, eU);
  check("F4. late_changes traz a contestação com o número do pedido",
    fU.late_changes.length === 1 && fU.late_changes[0].kind === "contestacao" && fU.late_changes[0].order_id === uOrders[1]
      && fU.late_changes[0].order_number === uOrders[1].replaceAll("-", "").slice(0, 8).toUpperCase()
      && Number(fU.late_changes[0].cents) === 5000 && Number(fU.contested_cents) === 5000, JSON.stringify(fU.late_changes));

  // Permissões da Migration B
  for (const table of ["organizer_payouts", "organizer_payout_items", "organizer_balance_flags"]) {
    await rejects(`R. ${table}: anônimo sem acesso`, () => anon(`select 1 from public.${table}`), /permission denied/);
    await rejects(`R. ${table}: logado sem acesso`, () => authed(orgP, `select 1 from public.${table}`), /permission denied/);
    await rejects(`R. ${table}: servidor sem acesso direto`, () => svc(`select 1 from public.${table}`), /permission denied/);
    const rls = await one("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]);
    const pols = await q("select policyname from pg_policies where schemaname = 'public' and tablename = $1", [table]);
    check(`R. ${table}: RLS ligada e sem políticas`, rls.relrowsecurity === true && pols.length === 0);
  }
  const payoutFnNames = [...new Set([...readFileSync(join(MIGRATIONS, MIGRATION_PAYOUTS), "utf8")
    .matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]))];
  const payoutProcs = await q(
    `select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('service_role', p.oid, 'execute') as svc
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [payoutFnNames]);
  check("R. todas as funções da Migration B existem (20)", payoutFnNames.length === 20 && payoutProcs.length === 20,
    `${payoutProcs.length}/${payoutFnNames.length}`);
  for (const p of payoutProcs) {
    check(`R. ${p.sig}: definer, search_path vazio, só service_role`,
      p.prosecdef && JSON.stringify(p.proconfig) === JSON.stringify(['search_path=""']) && !p.anon && !p.auth && p.svc,
      JSON.stringify(p));
  }
  await rejects("R. logado não executa record_organizer_payout",
    () => authed(admin, "select public.record_organizer_payout($1, $2, 1, current_date, null)", [admin, e1]), /permission denied/);
  await rejects("R. anônimo não executa organizer_event_finance",
    () => anon("select public.organizer_event_finance($1, $2)", [orgP, e1]), /permission denied/);

  // ======================= C) TROCA DE CHAVE PIX, CÓDIGOS E AVISOS (Migration C) =======================
  const MIGRATION_PIX = "20261019120000_organizer_pix_limits.sql";
  check("C. a migration da troca de chave existe", files.includes(MIGRATION_PIX), files.slice(-3).join(","));
  const issueCode = (actor, code) => scalar("select public.issue_organizer_action_code($1, 'pix_change', $2) as v", [actor, code]);
  const ageCodes = (actor) => q("update public.organizer_action_codes set created_at = created_at - interval '2 minutes' where user_id = $1", [actor]);
  const resetPixQuota = () => q("delete from public.rate_limit_hits where bucket like 'pix-code:%'");
  const requestPix = (actor, code, type, key, holder, doc) => scalar(
    "select public.request_pix_change($1, $2, $3, $4, $5, $6) as v", [actor, code, type, key, holder, doc]);
  const decidePix = (actor, id, approve, note = null) => scalar(
    "select public.decide_pix_change($1, $2, $3, $4) as v", [actor, id, approve, note]);
  const cancelPix = (actor, id) => svc("select public.cancel_pix_change($1, $2)", [actor, id]);
  const pixState = (actor) => scalar("select public.organizer_pix_change_state($1) as v", [actor]);
  const NEW_KEY = ["email", "nova.chave@exemplo.com", "Titular Secreto", "52998224725"];

  // C1) Código: espera de 60 s, 3 por dia, 5 erros, vencido
  const orgC = await newOrg("c@exemplo.com", "Produtora C", "cpf", "52998224725");
  check("C1. primeiro código: ok", (await issueCode(orgC, "111111")) === "ok");
  check("C1. segundo em menos de 60 s: aguarde", (await issueCode(orgC, "222222")) === "aguarde");
  await ageCodes(orgC);
  check("C1. depois de 60 s: ok", (await issueCode(orgC, "333333")) === "ok");
  await ageCodes(orgC);
  check("C1. terceiro no dia: ok", (await issueCode(orgC, "444444")) === "ok");
  await ageCodes(orgC);
  check("C1. quarto no dia: limite", (await issueCode(orgC, "555555")) === "limite");
  check("C1. código novo invalida os anteriores (só 1 aberto)",
    (await one("select count(*)::int as n from public.organizer_action_codes where user_id = $1 and used_at is null", [orgC])).n === 1);
  await rejects("C1. organizador inativo/desconhecido não gera código: ORG_ACESSO", () => issueCode(admin, "123456"), /^ORG_ACESSO/);
  const codeResults = [];
  for (let i = 0; i < 5; i += 1) codeResults.push((await requestPix(orgC, "000000", ...NEW_KEY)).status);
  check("C1. código errado 4 vezes: invalido; na 5ª: bloqueado",
    JSON.stringify(codeResults) === JSON.stringify(["invalido", "invalido", "invalido", "invalido", "bloqueado"]), JSON.stringify(codeResults));
  check("C1. depois de bloqueado o código certo não vale", (await requestPix(orgC, "444444", ...NEW_KEY)).status === "expirado");
  await resetPixQuota();
  await ageCodes(orgC);
  await issueCode(orgC, "121212");
  await q("update public.organizer_action_codes set expires_at = now() - interval '1 minute' where user_id = $1 and used_at is null", [orgC]);
  check("C1. código certo depois de vencido: expirado", (await requestPix(orgC, "121212", ...NEW_KEY)).status === "expirado");
  check("C1. nenhuma troca gravada pelas tentativas",
    (await one("select count(*)::int as n from public.organizer_pix_change_requests where organizer_id = $1", [orgC])).n === 0);

  // C2) Dados da troca
  await rejects("C2. chave CPF diferente do documento: ORG_DADOS",
    () => requestPix(orgC, "000000", "cpf", "11144477735", "Titular Secreto", "52998224725"), /^ORG_DADOS/);
  await rejects("C2. documento inválido: ORG_DADOS",
    () => requestPix(orgC, "000000", "email", "x@exemplo.com", "Titular Secreto", "11111111111"), /^ORG_DADOS/);
  await rejects("C2. telefone fora do formato: ORG_DADOS",
    () => requestPix(orgC, "000000", "telefone", "71988887777", "Titular Secreto", "52998224725"), /^ORG_DADOS/);
  await rejects("C2. igual à atual: ORG_PIX_IGUAL",
    () => requestPix(orgC, "000000", "cpf", "52998224725", "Titular Secreto", "52998224725"), /^ORG_PIX_IGUAL/);

  // Repasse antes da troca (guarda a chave antiga)
  const cA1 = await orgEvent(orgC, "Show C1", addDays(today, -10));
  await record(await orgOrderOf(cA1), 5250, 52);
  const cA2 = await orgEvent(orgC, "Show C2", addDays(today, -10));
  await record(await orgOrderOf(cA2), 5250, 52);
  await pay(admin, cA1, 4948);

  await ageCodes(orgC);
  check("C2. código para a troca: ok", (await issueCode(orgC, "343434")) === "ok");
  const asked = await requestPix(orgC, "343434", ...NEW_KEY);
  const hours = (new Date(asked.confirm_after).getTime() - Date.now()) / 3600000;
  check("C2. troca pedida com espera de 24 h", asked.status === "ok" && hours > 23.9 && hours <= 24, JSON.stringify(asked));
  await rejects("C2. segunda troca pendente: ORG_PIX_PENDENTE",
    () => requestPix(orgC, "343434", "email", "outra@exemplo.com", "Titular Secreto", "52998224725"), /^ORG_PIX_PENDENTE/);

  // C3) Repasse com troca pendente
  await rejects("C3. repasse com troca pendente: ORG_PIX_PENDENTE", () => pay(admin, cA2, 4948), /^ORG_PIX_PENDENTE/);

  const stC = await pixState(orgC);
  check("C3. tela do organizador: pendente com chave nova mascarada",
    stC.pending === true && stC.new_masked === "•••@exemplo.com" && stC.request_id === asked.request_id, JSON.stringify(stC));
  const pixListed = await svc("select * from public.list_pix_change_requests($1)", [admin]);
  check("C3. lista da equipe mascarada (sem chave nem documento completos)",
    pixListed.some((r) => r.request_id === asked.request_id && r.can_confirm === false)
      && !JSON.stringify(pixListed).includes("nova.chave") && !JSON.stringify(pixListed).includes("52998224725"), JSON.stringify(pixListed));
  await rejects("C3. lista pela secretaria: TAXA_ADMIN", () => svc("select * from public.list_pix_change_requests($1)", [sec]), /^TAXA_ADMIN/);
  await rejects("C3. detalhes pelo desenvolvedor: TAXA_DEV",
    () => scalar("select public.pix_change_details($1, $2) as v", [dev, asked.request_id]), /^TAXA_DEV/);
  const det = await scalar("select public.pix_change_details($1, $2) as v", [admin, asked.request_id]);
  check("C3. detalhes completos para o Admin que grava",
    det.new.pix_key === "nova.chave@exemplo.com" && det.current.pix_key === "52998224725", JSON.stringify(det));

  // C4/C5) Decisão
  await rejects("C5. desenvolvedor decidindo: TAXA_DEV", () => decidePix(dev, asked.request_id, true), /^TAXA_DEV/);
  await rejects("C5. secretaria decidindo: TAXA_ADMIN", () => decidePix(sec, asked.request_id, true), /^TAXA_ADMIN/);
  await rejects("C5. organizador cancelando pedido de outro: ORG_ACESSO", () => cancelPix(orgQ, asked.request_id), /^ORG_ACESSO/);
  await rejects("C4. aprovar antes de 24 h: ORG_ESPERA:<data>",
    () => decidePix(admin, asked.request_id, true), /^ORG_ESPERA:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  await q("update public.organizer_pix_change_requests set confirm_after = now() - interval '1 minute' where id = $1", [asked.request_id]);
  const approved = await decidePix(admin, asked.request_id, true);
  const profC = await one("select * from public.organizer_profiles where user_id = $1", [orgC]);
  check("C4. aprovada: perfil com a chave nova e data da troca",
    approved.status === "confirmada" && profC.pix_key_type === "email" && profC.pix_key === "nova.chave@exemplo.com"
      && profC.pix_key_changed_at !== null, JSON.stringify(approved));
  await rejects("C4. decidir de novo: ORG_ESTADO", () => decidePix(admin, asked.request_id, false, "Motivo qualquer"), /^ORG_ESTADO/);
  await pay(admin, cA2, 4948);
  const snap = async (eventId) => (await one(
    `select p.pix_key_snapshot, p.pix_key_changed_at_snapshot from public.organizer_payouts p
     join public.organizer_payout_items i on i.payout_id = p.id where i.event_id = $1 and p.kind = 'repasse'`, [eventId]));
  const s1 = await snap(cA1);
  const s2 = await snap(cA2);
  check("C4. repasse seguinte com a chave nova; o anterior continua com a antiga",
    s1.pix_key_snapshot === "52998224725" && s1.pix_key_changed_at_snapshot === null
      && s2.pix_key_snapshot === "nova.chave@exemplo.com" && s2.pix_key_changed_at_snapshot !== null, JSON.stringify({ s1, s2 }));

  // Cancelar e recusar
  const orgC3 = await newOrg("c3@exemplo.com", "Produtora C3", "email", "c3.chave@exemplo.com");
  await resetPixQuota();
  await issueCode(orgC3, "565656");
  const NEW_KEY3 = ["aleatoria", "123e4567-e89b-12d3-a456-426614174999", "Outro Titular", "11144477735"];
  const ask3 = await requestPix(orgC3, "565656", ...NEW_KEY3);
  await cancelPix(orgC3, ask3.request_id);
  check("C5. organizador cancela a própria troca",
    (await one("select status from public.organizer_pix_change_requests where id = $1", [ask3.request_id])).status === "cancelada");
  await rejects("C5. cancelar de novo: ORG_ESTADO", () => cancelPix(orgC3, ask3.request_id), /^ORG_ESTADO/);
  await ageCodes(orgC3);
  await issueCode(orgC3, "676767");
  const ask4 = await requestPix(orgC3, "676767", ...NEW_KEY3);
  await rejects("C5. recusar sem motivo: ORG_MOTIVO", () => decidePix(admin, ask4.request_id, false), /^ORG_MOTIVO/);
  await decidePix(admin, ask4.request_id, false, "Chave não confere com o titular");
  const st3 = await pixState(orgC3);
  check("C5. recusada: tela mostra a última decisão e nada pendente",
    st3.pending === false && st3.last_decision?.status === "recusada"
      && (await one("select pix_key from public.organizer_profiles where user_id = $1", [orgC3])).pix_key === "c3.chave@exemplo.com",
    JSON.stringify(st3));
  const pixAudits = await q("select details::text as d from public.audit_log where action like 'pix_troca_%'");
  check("C5. histórico da troca sem chave nem documento",
    pixAudits.length === 6 && pixAudits.every((a) => !/chave|exemplo|52998224725|11144477735|123e4567/.test(a.d)), JSON.stringify(pixAudits));

  // C6) Cota de códigos de login
  await q("delete from public.rate_limit_hits where bucket like 'login-code:%'");
  const loginCode = async (userId) => {
    const sid = randomUUID();
    await q("insert into auth.sessions (id, user_id) values ($1, $2)", [sid, userId]);
    return scalar("select public.issue_login_code($1, $2, '123456') as v", [userId, sid]);
  };
  let staffOk = 0;
  for (let i = 0; i < 40; i += 1) {
    if ((await loginCode(await newStaff(`equipe${i}@exemplo.com`, `Equipe ${i}`, "secretaria"))) === "ok") staffOk += 1;
  }
  check("C6. 40 códigos da equipe no dia", staffOk === 40, String(staffOk));
  check("C6. 41º da equipe: limite", (await loginCode(await newStaff("equipe40@exemplo.com", "Equipe 40", "secretaria"))) === "limite");
  let orgOk = 0;
  for (let i = 0; i < 20; i += 1) {
    if ((await loginCode(await newOrg(`login${i}@exemplo.com`, `Produtora L${i}`, "cpf", "52998224725"))) === "ok") orgOk += 1;
  }
  check("C6. equipe esgotada não bloqueia organizadores: 20 códigos", orgOk === 20, String(orgOk));
  check("C6. 21º de organizador: limite",
    (await loginCode(await newOrg("login20@exemplo.com", "Produtora L20", "cpf", "52998224725"))) === "limite");

  // C7) Aviso de estorno uma vez só
  const cB = await orgEvent(orgC, "Show Avisos", addDays(today, -3));
  const askedRefund = await orgOrderOf(cB);
  await q(`insert into public.organizer_ops_requests (kind, event_id, order_id, reason, requested_by)
    values ('estorno', $1, $2, 'Cliente pediu', $3)`, [cB, askedRefund, orgC]);
  await refundOrder(askedRefund);
  const n1 = await svc("select * from public.claim_refund_request_notice($1)", [askedRefund]);
  const n2 = await svc("select * from public.claim_refund_request_notice($1)", [askedRefund]);
  check("C7. aviso do estorno pedido pelo organizador: só a primeira chamada devolve",
    n1.length === 1 && n1[0].requested_by === orgC && n1[0].event_name === "Show Avisos" && n2.length === 0, JSON.stringify({ n1, n2 }));
  check("C7. pedido já avisado não volta pelo aviso da equipe",
    (await svc("select * from public.claim_event_refund_notice($1)", [askedRefund])).length === 0);
  const teamRefund = await orgOrderOf(cB);
  check("C7. pedido ainda pago não gera aviso", (await svc("select * from public.claim_event_refund_notice($1)", [teamRefund])).length === 0);
  await refundOrder(teamRefund);
  const t1 = await svc("select * from public.claim_event_refund_notice($1)", [teamRefund]);
  const t2 = await svc("select * from public.claim_event_refund_notice($1)", [teamRefund]);
  check("C7. aviso do estorno da equipe: só a primeira chamada devolve",
    t1.length === 1 && t1[0].organizer_id === orgC && t2.length === 0, JSON.stringify({ t1, t2 }));
  const plainOrder = await addOrder(ev);
  await q("update public.orders set status = 'estornado' where id = $1", [plainOrder]);
  check("C7. evento sem organizador: sem aviso", (await svc("select * from public.claim_event_refund_notice($1)", [plainOrder])).length === 0);

  // C8) Permissões
  for (const table of ["organizer_action_codes", "organizer_pix_change_requests", "organizer_refund_notices"]) {
    await rejects(`C8. ${table}: anônimo sem acesso`, () => anon(`select 1 from public.${table}`), /permission denied/);
    await rejects(`C8. ${table}: logado sem acesso`, () => authed(orgC, `select 1 from public.${table}`), /permission denied/);
    await rejects(`C8. ${table}: servidor sem acesso direto`, () => svc(`select 1 from public.${table}`), /permission denied/);
    const rls = await one("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]);
    const pols = await q("select policyname from pg_policies where schemaname = 'public' and tablename = $1", [table]);
    check(`C8. ${table}: RLS ligada e sem políticas`, rls.relrowsecurity === true && pols.length === 0);
  }
  const pixFnNames = [...new Set([...readFileSync(join(MIGRATIONS, MIGRATION_PIX), "utf8")
    .matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)].map((m) => m[1]))];
  const pixProcs = await q(
    `select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('service_role', p.oid, 'execute') as svc
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [pixFnNames]);
  check("C8. todas as funções da Migration C existem (14, sem sobrecarga)", pixFnNames.length === 14 && pixProcs.length === 14,
    `${pixProcs.length}/${pixFnNames.length}`);
  for (const p of pixProcs) {
    check(`C8. ${p.sig}: definer, search_path vazio, só service_role`,
      p.prosecdef && JSON.stringify(p.proconfig) === JSON.stringify(['search_path=""']) && !p.anon && !p.auth && p.svc,
      JSON.stringify(p));
  }
  await rejects("C8. logado não executa request_pix_change",
    () => authed(orgC, "select public.request_pix_change($1, '123456', 'email', 'a@b.com', 'Nome', '52998224725')", [orgC]),
    /permission denied/);

  // ======================= 8) ANO NOVO CADASTRADO =======================
  await q("insert into public.business_holidays (day, name, kind, source) values ('2031-01-01', 'Confraternização Universal', 'nacional', 'Lei 662/1949')");
  check("8. depois de cadastrar 2031 o último ano vira 2031 e o prazo volta",
    (await scalar("select public.business_calendar_last_year() as v")) === 2031 && (await nth("2030-12-27")) === "2031-01-03",
    String(await nth("2030-12-27")));

  await db.end();
} catch (error) {
  failures += 1;
  console.log("ERRO:", error.message);
  console.log(error.stack);
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(`\n${passes} ok, ${failures} falhas`);
console.log(failures === 0 ? "TUDO OK" : `FALHAS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
