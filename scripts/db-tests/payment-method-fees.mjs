// Testa a migration da taxa por forma de pagamento num Postgres temporário.
// Uso: BYLA_PG_TOOLS=<pasta> node scripts/db-tests/payment-method-fees.mjs

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
const THIS_MIGRATION = "20261019203707_payment_method_fees.sql";
const PORT = 54897;
const DATA_DIR = join(TOOLS, "data-taxa-forma");
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
  const db = new pg.Client({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: PASSWORD,
    database: "byla",
  });
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
  for (const file of files) {
    await db.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  check("migration aplicada até payment_method_fees", files.includes(THIS_MIGRATION));

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
  const svc = (sql, params) => asRole("service_role", sql, params).then((r) => r.rows);
  const one = async (sql, params) => (await svc(sql, params))[0];

  const policy = await one("select * from public.service_fee_policy()");
  check("flag desligada por padrão", policy.per_method_enabled === false);
  check("defaults card/pix documentados", policy.card_rate_bps === 1000 && policy.pix_rate_bps === 556);

  const staffId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [staffId]);
  await db.query("insert into public.staff_profiles (user_id, display_name) values ($1, $2)", [
    staffId,
    "Staff",
  ]);

  const days = (n) => {
    const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    d.setUTCHours(22, 0, 0, 0);
    return d.toISOString();
  };
  const { rows: evRows } = await db.query(
    `insert into public.events (slug, name, venue, starts_at, capacity, sales_open)
     values ($1, 'Evento Forma', 'Local', now() + interval '7 days', 30, true) returning id`,
    [randomUUID()],
  );
  const eventId = evRows[0].id;
  await svc(
    "select public.save_event_with_sessions($1, $2, 'Local', 'Desc', null, $3::jsonb, $4::jsonb, $5)",
    [
      eventId,
      "Evento Forma",
      JSON.stringify([
        { preset: "inteira", price_cents: 5000, max_units: null },
        { preset: "meia", price_cents: 2500, max_units: null },
      ]),
      JSON.stringify([
        {
          id: null,
          name: null,
          starts_at: days(7),
          ends_at: null,
          capacity: 30,
          inteira_quota: null,
          meia_quota: null,
          prices: [
            { type_index: 0, price_cents: 5000, max_units: null, on_sale: true },
            { type_index: 1, price_cents: 2500, max_units: null, on_sale: true },
          ],
        },
      ]),
      staffId,
    ],
  );
  const session = (
    await db.query(
      "select id from public.event_sessions where event_id = $1 and archived_at is null",
      [eventId],
    )
  ).rows[0];
  const inteira = (
    await db.query(
      "select id from public.ticket_types where event_id = $1 and preset = 'inteira'",
      [eventId],
    )
  ).rows[0].id;

  await db.query("update public.service_fee_settings set enabled = true, rate_bps = 700 where id = 1");

  const checkout = async () =>
    (
      await asRole(
        "service_role",
        `select * from public.create_checkout_order(
           p_event_id => $1, p_buyer_name => 'C', p_buyer_email => 'c@example.com',
           p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
           p_items => $3::jsonb, p_privacy_policy_version => $4, p_session_id => $5,
           p_expected_fee_rate_bps => 700, p_expected_fee_min_cents => 100)`,
        [
          eventId,
          randomUUID(),
          JSON.stringify([{ ticket_type_id: inteira, qty: 1 }]),
          POLICY,
          session.id,
        ],
      )
    ).rows[0];

  const order = await checkout();
  const row = (
    await db.query("select * from public.orders where id = $1", [order.order_id])
  ).rows[0];
  check(
    "flag desligada: taxa única 7% e snapshots iguais a rate_bps",
    row.service_fee_cents === 350 &&
      row.total_cents === 5350 &&
      row.card_rate_bps_snapshot === 700 &&
      row.pix_rate_bps_snapshot === 700 &&
      row.payment_method === null,
    JSON.stringify(row),
  );

  const same = await one(
    "select * from public.set_order_payment_method($1, 'pix')",
    [order.order_id],
  );
  check("RPC com flag desligada mantém total (taxa única)", same.total_cents === 5350);
  check("RPC grava payment_method", same.payment_method === "pix");

  await rejects(
    "update direto de taxa bloqueado",
    () =>
      db.query("update public.orders set total_cents = 1 where id = $1", [order.order_id]),
    /TAXA_IMUTAVEL/,
  );

  await db.query(
    "update public.service_fee_settings set per_method_enabled = true, card_rate_bps = 1000, pix_rate_bps = 556 where id = 1",
  );
  const dual = await checkout();
  const dualRow = (
    await db.query("select * from public.orders where id = $1", [dual.order_id])
  ).rows[0];
  check(
    "flag ligada: checkout precifica como cartão (10%)",
    dualRow.service_fee_cents === 500 &&
      dualRow.total_cents === 5500 &&
      dualRow.card_rate_bps_snapshot === 1000 &&
      dualRow.pix_rate_bps_snapshot === 556,
    JSON.stringify(dualRow),
  );

  const asPix = await one(
    "select * from public.set_order_payment_method($1, 'pix')",
    [dual.order_id],
  );
  check("RPC Pix recalcula para 5,56%", asPix.total_cents === 5278 && asPix.service_fee_cents === 278);

  const asCard = await one(
    "select * from public.set_order_payment_method($1, 'card')",
    [dual.order_id],
  );
  check("RPC cartão volta para 10%", asCard.total_cents === 5500 && asCard.service_fee_cents === 500);

  const again = await one(
    "select * from public.set_order_payment_method($1, 'card')",
    [dual.order_id],
  );
  check("RPC idempotente", again.total_cents === 5500 && again.payment_method === "card");

  await one("select public.mark_order_paid_by_external('mercadopago', $1)", [dual.order_id]);
  await rejects(
    "RPC recusa pedido pago",
    () => one("select * from public.set_order_payment_method($1, 'pix')", [dual.order_id]),
    /FORMA_STATUS/,
  );

  // Corrida: duas chamadas simultâneas devem deixar estado consistente.
  const race = await checkout();
  const [a, b] = await Promise.all([
    one("select * from public.set_order_payment_method($1, 'pix')", [race.order_id]),
    one("select * from public.set_order_payment_method($1, 'card')", [race.order_id]),
  ]);
  const final = (
    await db.query(
      "select payment_method, total_cents, service_fee_cents from public.orders where id = $1",
      [race.order_id],
    )
  ).rows[0];
  check(
    "corrida: estado final é pix@5278 ou card@5500",
    (final.payment_method === "pix" && final.total_cents === 5278) ||
      (final.payment_method === "card" && final.total_cents === 5500),
    JSON.stringify({ a, b, final }),
  );

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

process.exit(failures ? 1 : 0);
