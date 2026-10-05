// Testa a migration do aceite dos Termos de compra num Postgres temporário: aplica as
// migrations anteriores, cria um pedido "antigo", aplica a nova e confere que ela é
// aditiva (pedido antigo intacto, chamada sem p_terms_version continua funcionando),
// que a versão dos termos é gravada com a data do aceite, as constraints e as permissões.
// Não usa banco real nem o provedor de pagamento.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg instalados> node scripts/db-tests/terms-acceptance.mjs

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
const THIS_MIGRATION = "20261014100000_terms_acceptance.sql";
const PORT = 54897;
const DATA_DIR = join(TOOLS, "data-termos");
const PASSWORD = randomUUID();
const POLICY = "2026-10-03";
const TERMS = "2026-10-04";

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
  check("migration dos termos vem logo depois da taxa de serviço",
    thisIdx > 0 && files[thisIdx - 1] === "20261013100000_service_fee.sql", files.slice(-3).join(","));
  for (const file of files.slice(0, thisIdx)) await db.query(readFileSync(join(MIGRATIONS, file), "utf8"));

  async function asRole(role, sql, params = []) {
    await db.query("begin");
    try {
      await db.query(`set local role ${role}`);
      const result = await db.query(sql, params);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }

  const staffId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [staffId]);
  await db.query("insert into public.staff_profiles (user_id, display_name) values ($1, 'Secretaria Teste')", [staffId]);

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const types = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
  ];
  const sessions = [{
    id: null, name: null, starts_at: startsAt, ends_at: null, capacity: 30, inteira_quota: null, meia_quota: null,
    prices: [
      { type_index: 0, price_cents: 5000, max_units: null, on_sale: true },
      { type_index: 1, price_cents: 2500, max_units: null, on_sale: true },
    ],
  }];
  const { rows: [event] } = await db.query(
    `insert into public.events (slug, name, venue, starts_at, capacity, sales_open)
     values ($1, 'Show Teste', 'Local Teste', now() + interval '7 days', 30, true) returning id`,
    [randomUUID()],
  );
  await asRole("service_role",
    "select public.save_event_with_sessions($1, 'Show Teste', 'Local Teste', 'Descrição', null, $2::jsonb, $3::jsonb, $4)",
    [event.id, JSON.stringify(types), JSON.stringify(sessions), staffId]);
  const { rows: [session] } = await db.query(
    "select id from public.event_sessions where event_id = $1 and archived_at is null", [event.id]);
  const { rows: [inteira] } = await db.query(
    "select id from public.ticket_types where event_id = $1 and preset = 'inteira'", [event.id]);
  const items = JSON.stringify([{ ticket_type_id: inteira.id, qty: 2 }]);

  const checkout = async (role, extra = "", extraParams = []) => (await asRole(role,
    `select * from public.create_checkout_order(
       p_event_id => $1, p_buyer_name => 'Comprador Teste', p_buyer_email => 'comprador@example.com',
       p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
       p_items => $3::jsonb, p_privacy_policy_version => $4, p_session_id => $5${extra})`,
    [event.id, randomUUID(), items, POLICY, session.id, ...extraParams])).rows[0];
  const orderRow = async (id) => (await db.query("select * from public.orders where id = $1", [id])).rows[0];

  const legacy = await checkout("service_role");
  check("antes da migration, o checkout atual funciona", Boolean(legacy?.order_id));

  await db.query(readFileSync(join(MIGRATIONS, THIS_MIGRATION), "utf8"));
  console.log(`aplicadas ${thisIdx + 1} migrations`);

  const legacyRow = await orderRow(legacy.order_id);
  check("pedido antigo continua sem versão dos termos",
    legacyRow.terms_version === null && legacyRow.terms_accepted_at === null);
  check("pedido antigo mantém o aceite da privacidade",
    legacyRow.privacy_policy_version === POLICY && legacyRow.privacy_accepted_at !== null);

  const { rows: overloads } = await db.query(
    "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_checkout_order'");
  check("só existe uma create_checkout_order (sem sobrecarga ambígua)", overloads.length === 1, JSON.stringify(overloads));

  const oldCode = await checkout("service_role");
  const oldCodeRow = await orderRow(oldCode.order_id);
  check("código no ar (sem p_terms_version) continua criando pedido", Boolean(oldCode?.order_id));
  check("sem p_terms_version, termos ficam nulos e privacidade é gravada",
    oldCodeRow.terms_version === null && oldCodeRow.terms_accepted_at === null
      && oldCodeRow.privacy_policy_version === POLICY);
  check("total e taxa iguais aos de antes da migration",
    oldCode.total_cents === legacy.total_cents && oldCode.service_fee_cents === legacy.service_fee_cents,
    `${oldCode.total_cents}/${legacy.total_cents}`);

  const withTerms = await checkout("service_role", ", p_terms_version => $6", [TERMS]);
  const withTermsRow = await orderRow(withTerms.order_id);
  check("com p_terms_version, grava a versão dos termos", withTermsRow.terms_version === TERMS);
  check("grava a data do aceite dos termos junto com a da privacidade",
    withTermsRow.terms_accepted_at !== null
      && withTermsRow.terms_accepted_at.getTime() === withTermsRow.privacy_accepted_at.getTime());

  const blank = await checkout("service_role", ", p_terms_version => $6", ["   "]);
  const blankRow = await orderRow(blank.order_id);
  check("versão em branco vira nula", blankRow.terms_version === null && blankRow.terms_accepted_at === null);

  await rejects("versão longa demais é recusada",
    () => checkout("service_role", ", p_terms_version => $6", ["x".repeat(33)]),
    /orders_terms_version_length/);
  await rejects("versão sem data de aceite é recusada",
    () => db.query("update public.orders set terms_version = $1 where id = $2", [TERMS, legacy.order_id]),
    /orders_terms_acceptance_pair/);
  await rejects("data de aceite sem versão é recusada",
    () => db.query("update public.orders set terms_accepted_at = now() where id = $1", [legacy.order_id]),
    /orders_terms_acceptance_pair/);

  for (const role of ["anon", "authenticated"]) {
    await rejects(`${role} não chama create_checkout_order`,
      () => checkout(role, ", p_terms_version => $6", [TERMS]),
      /permission denied/);
  }
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTudo certo." : `\n${failures} falha(s).`);
process.exit(failures === 0 ? 0 : 1);
