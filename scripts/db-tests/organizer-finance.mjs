// Matriz do dinheiro do organizador (spec 2026-10-13-contas-organizador-design; plano
// 2026-10-15-contas-organizador-fase3, tarefas 3 e 5B) num Postgres temporário: aplica todas as
// migrations em ordem e confere o calendário de dias úteis, a tarifa por pagamento (automática,
// falhas, fila do cron, lançamento manual e total do evento pelo extrato), os gatilhos de
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
