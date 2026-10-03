// Testa as migrations das sessões (spec 2026-10-03-sessoes-design) num Postgres
// temporário, aplicando TODAS as migrations em ordem. Não usa banco real.
//
// Como rodar: o mesmo preparo de scripts/db-tests/abandoned-reminders.mjs
// (embedded-postgres + pg e as extensões falsas numa pasta fora do repositório):
//   BYLA_PG_TOOLS=<pasta temporária> node scripts/db-tests/sessions.mjs
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOLS = process.env.BYLA_PG_TOOLS;
if (!TOOLS) {
  console.error("Defina BYLA_PG_TOOLS com a pasta onde embedded-postgres e pg estão instalados.");
  process.exit(2);
}
const toolsRequire = createRequire(join(TOOLS, "package.json"));
const load = async (name) => (await import(pathToFileURL(toolsRequire.resolve(name)).href)).default;
const EmbeddedPostgres = await load("embedded-postgres");
const pg = await load("pg");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = process.env.BYLA_MIGRATIONS_DIR ?? join(ROOT, "supabase", "migrations");
const SESSIONS_MIGRATION = "20261011100000_event_sessions.sql";
const CHECKIN_MIGRATION = "20261011110000_check_in_sessions.sql";
const PORT = 54892;
const DATA_DIR = join(TOOLS, "data-sessoes");
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const connect = async () => {
  const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: "byla" });
  c.on("error", () => {});
  await c.connect();
  return c;
};

try {
  const db = await connect();

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
  const apply = (file) => db.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  const sessionsIdx = files.indexOf(SESSIONS_MIGRATION);
  check("migrations das sessões depois de todas as anteriores",
    sessionsIdx > 0 && files[sessionsIdx - 1] === "20261010110000_abandoned_reminders_schedule.sql"
      && files[sessionsIdx + 1] === CHECKIN_MIGRATION, files.slice(-3).join(","));
  for (const file of files.slice(0, sessionsIdx)) await apply(file);
  console.log(`aplicadas ${sessionsIdx} migrations anteriores às sessões`);

  // ---------- auxiliares ----------
  async function asRole(client, role, sql, params = [], claims = null) {
    await client.query("begin");
    try {
      await client.query(`set local role ${role}`);
      if (claims) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [claims]);
      const result = await client.query(sql, params);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  const svc = (sql, params) => asRole(db, "service_role", sql, params).then((r) => r.rows);
  const one = async (sql, params) => (await svc(sql, params))[0];

  const staffId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [staffId]);
  await db.query("insert into public.staff_profiles (user_id, display_name) values ($1, 'Equipe Teste')", [staffId]);
  const outsiderId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [outsiderId]);

  const typesPayload = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
    { preset: "casadinha", price_cents: 9000, max_units: 2 },
    { id: null, name: "VIP", people_per_unit: 1, price_cents: 12000, max_units: null },
  ];

  async function newEvent({ name = "Show Teste", capacity = 10, inteira = null, meia = null, startsMin = 7 * 24 * 60, salesOpen = true, types = typesPayload } = {}) {
    const { rows } = await db.query(
      `insert into public.events (slug, name, venue, starts_at, capacity, sales_open, inteira_quota, meia_quota)
       values ($1, $2, 'Local Teste', now() + make_interval(mins => $3), $4, $5, $6, $7) returning id`,
      [randomUUID(), name, startsMin, capacity, salesOpen, inteira, meia],
    );
    const eventId = rows[0].id;
    await svc("select public.save_event_ticket_types($1, $2::jsonb)", [eventId, JSON.stringify(types)]);
    const { rows: tt } = await db.query(
      "select id, coalesce(preset, lower(name)) as key from public.ticket_types where event_id = $1 and archived_at is null",
      [eventId],
    );
    const t = Object.fromEntries(tt.map((r) => [r.key, r.id]));
    return { eventId, t };
  }

  const checkoutSql = (withSession) => `select * from public.create_checkout_order(
      p_event_id => $1, p_buyer_name => 'Comprador Teste', p_buyer_email => 'comprador@example.com',
      p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
      p_items => $3::jsonb, p_privacy_policy_version => $4${withSession ? ", p_session_id => $5" : ""})`;
  const checkoutParams = (ev, items, sessionId, privacy) => {
    const params = [ev.eventId, randomUUID(), JSON.stringify(items), privacy];
    if (sessionId !== undefined) params.push(sessionId);
    return params;
  };
  const checkout = async (ev, items, { sessionId, privacy = POLICY, client = db } = {}) =>
    (await asRole(client, "service_role", checkoutSql(sessionId !== undefined), checkoutParams(ev, items, sessionId, privacy))).rows[0];
  const item = (typeId, qty = 1) => ({ ticket_type_id: typeId, qty });
  const pay = (orderId) => one("select public.mark_order_paid_by_external('mercadopago', $1) as r", [orderId]).then((r) => r.r);
  const courtesy = (ev, sessionId) => sessionId === undefined
    ? one("select * from public.issue_courtesy_ticket($1, 'Convidado Teste', 'convidado@example.com', $2)", [ev.eventId, randomUUID()])
    : one("select * from public.issue_courtesy_ticket($1, 'Convidado Teste', 'convidado@example.com', $2, $3)", [ev.eventId, randomUUID(), sessionId]);
  const codesOf = async (orderId) => (await db.query("select code from public.tickets where order_id = $1 order by id", [orderId])).rows.map((r) => r.code);
  const orderRow = async (id) => (await db.query("select * from public.orders where id = $1", [id])).rows[0];
  const stripNew = (a) => a && ({
    capacity: a.capacity, sold: a.sold, held: a.held, remaining: a.remaining, categories: a.categories,
    types: a.types.map((t) => {
      const rest = { ...t };
      delete rest.price_cents;
      delete rest.on_sale;
      return rest;
    }),
  });

  // ---------- 1) dados de antes (código antigo) ----------
  const legacy = await newEvent({ name: "Evento Antigo", capacity: 12, inteira: 8, meia: 3 });
  const lo1 = await checkout(legacy, [item(legacy.t.inteira, 2)]);
  await pay(lo1.order_id);
  await checkout(legacy, [item(legacy.t.casadinha, 1)]);
  const lo3 = await checkout(legacy, [item(legacy.t.meia, 1)]);
  await pay(lo3.order_id);
  await one("select * from public.check_in_ticket($1, $2, $3)", [legacy.eventId, (await codesOf(lo3.order_id))[0], staffId]);
  const lo4 = await checkout(legacy, [item(legacy.t.vip, 1)]);
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1", [lo4.order_id]);
  const lo5 = await checkout(legacy, [item(legacy.t.inteira, 1)]);
  await pay(lo5.order_id);
  const refundId = randomUUID();
  const { rows: lo5t } = await db.query("select id from public.tickets where order_id = $1", [lo5.order_id]);
  await db.query(
    `insert into public.order_refunds (id, order_id, amount_cents, idempotency_key, previous_order_status,
       previous_ticket_statuses, requested_by, requested_by_name, reason)
     values ($1::uuid, $2, 5000, $3, 'pago', jsonb_build_object($4::text, 'pago'), $5, 'Equipe Teste', 'Pedido do comprador')`,
    [refundId, lo5.order_id, refundId, lo5t[0].id, staffId],
  );
  await db.query("update public.tickets set status = 'estornado' where order_id = $1", [lo5.order_id]);
  await db.query("update public.orders set status = 'estornado' where id = $1", [lo5.order_id]);
  await courtesy(legacy);
  // Tipo arquivado com vendas não ganha preço na sessão.
  await svc("select public.save_event_ticket_types($1, $2::jsonb)",
    [legacy.eventId, JSON.stringify(typesPayload.filter((t) => t.name !== "VIP"))]);
  const closedLegacy = await newEvent({ name: "Evento Fechado", salesOpen: false });

  const snapshot = async (eventId) => ({
    availability: stripNew((await one("select public.event_availability($1) as a", [eventId])).a),
    occupied: (await one("select public.event_occupied_count($1) as n", [eventId])).n,
  });
  const before = { legacy: await snapshot(legacy.eventId), closed: await snapshot(closedLegacy.eventId) };
  const counts = async () => (await db.query(
    "select (select count(*) from public.orders)::int as orders, (select count(*) from public.tickets)::int as tickets, (select count(*) from public.order_items)::int as items, (select count(*) from public.events)::int as events, (select count(*) from public.ticket_types)::int as types",
  )).rows[0];
  const countsBefore = await counts();

  // ---------- 2) migração ----------
  await apply(SESSIONS_MIGRATION);
  await apply(CHECKIN_MIGRATION);
  console.log("aplicadas as migrations das sessões");

  check("nada apagado (pedidos, ingressos, itens, eventos, tipos)", JSON.stringify(await counts()) === JSON.stringify(countsBefore));
  const { rows: perEvent } = await db.query(
    "select e.id, count(s.id)::int as n from public.events e left join public.event_sessions s on s.event_id = e.id group by e.id");
  check("cada evento virou exatamente 1 sessão", perEvent.every((r) => r.n === 1), JSON.stringify(perEvent));
  const legacySession = (await db.query("select * from public.event_sessions where event_id = $1", [legacy.eventId])).rows[0];
  check("sessão com horário, lotação e cotas do evento",
    legacySession.capacity === 12 && legacySession.inteira_quota === 8 && legacySession.meia_quota === 3
      && legacySession.status === "ativa" && legacySession.sales_open === true && legacySession.name === null);
  const { rows: nullSessions } = await db.query(
    "select (select count(*) from public.orders where session_id is null)::int + (select count(*) from public.tickets where session_id is null)::int as n");
  check("todo pedido e ingresso aponta para uma sessão", nullSessions[0].n === 0);
  const after = {
    legacy: stripNew((await one("select public.session_availability($1) as a", [legacySession.id])).a),
    closed: stripNew((await one("select public.event_availability($1) as a", [closedLegacy.eventId])).a),
    occupied: (await one("select public.session_occupied_count($1) as n", [legacySession.id])).n,
  };
  check("vendidos, reservados, restantes, cotas e tipos iguais antes/depois",
    JSON.stringify(after.legacy) === JSON.stringify(before.legacy.availability),
    `\n antes ${JSON.stringify(before.legacy.availability)}\n depois ${JSON.stringify(after.legacy)}`);
  check("ocupação igual antes/depois (inclui estorno em andamento)", after.occupied === before.legacy.occupied
    && Number(after.occupied) === 2 + 2 + 1 + 1 + 1, `${after.occupied}`);
  check("evento fechado também confere", JSON.stringify(after.closed) === JSON.stringify(before.closed.availability));
  const { rows: prices } = await db.query(
    `select tt.coalesce_key, stt.price_cents, stt.max_units from (
       select id, coalesce(preset, lower(name)) as coalesce_key from public.ticket_types where event_id = $1
     ) tt left join public.session_ticket_types stt on stt.ticket_type_id = tt.id order by 1`, [legacy.eventId]);
  const priceMap = Object.fromEntries(prices.map((p) => [p.coalesce_key, p]));
  check("preços e limites copiados para a sessão",
    priceMap.inteira.price_cents === 5000 && priceMap.meia.price_cents === 2500
      && priceMap.casadinha.price_cents === 9000 && priceMap.casadinha.max_units === 2,
    JSON.stringify(priceMap));
  check("cortesia e tipo arquivado sem preço na sessão", priceMap.cortesia.price_cents === null && priceMap.vip.price_cents === null);
  const legacyAvailability = (await one("select public.event_availability($1) as a", [legacy.eventId])).a;
  check("event_availability (código antigo) continua respondendo, com selling",
    legacyAvailability.capacity === 12 && legacyAvailability.selling === true
      && legacyAvailability.types.find((t) => t.ticket_type_id === legacy.t.inteira)?.price_cents === 5000);

  // ---------- 3) compatibilidade com o código antigo ----------
  const single = await newEvent({ name: "Sessão Única", capacity: 5 });
  const singleSession = (await db.query("select * from public.event_sessions where event_id = $1", [single.eventId])).rows;
  check("evento criado pelo formulário atual ganha a sessão única", singleSession.length === 1 && singleSession[0].capacity === 5);
  const { rows: singlePrices } = await db.query(
    "select count(*)::int as n from public.session_ticket_types where session_id = $1", [singleSession[0].id]);
  check("tipos salvos pelo editor atual ganham preço na sessão única", singlePrices[0].n === 4);
  const oldOrder = await checkout(single, [{ kind: "inteira", qty: 1 }]);
  check("checkout antigo (sem sessão, formato kind) usa a sessão única",
    (await orderRow(oldOrder.order_id)).session_id === singleSession[0].id && oldOrder.total_cents === 5000);
  const oldCourtesy = await courtesy(single);
  check("cortesia antiga (4 parâmetros) usa a sessão única", (await orderRow(oldCourtesy.order_id)).session_id === singleSession[0].id);
  const { rows: tSessions } = await db.query("select distinct session_id from public.tickets where order_id = $1", [oldOrder.order_id]);
  check("ingressos herdam a sessão do pedido", tSessions.length === 1 && tSessions[0].session_id === singleSession[0].id);
  const newTypes = typesPayload.map((t) => (t.preset === "inteira" ? { ...t, price_cents: 6000, max_units: 3 } : t))
    .filter((t) => t.preset !== "meia")
    .concat([{ id: null, name: "Camarote", people_per_unit: 1, price_cents: 20000, max_units: null }]);
  await svc(
    `select public.update_event_with_capacity($1, 'Sessão Única', now() + interval '10 days', 'Local Teste', '',
       8, null, $2::jsonb, 6, null)`, [single.eventId, JSON.stringify(newTypes)]);
  const mirrored = (await db.query("select * from public.event_sessions where event_id = $1", [single.eventId])).rows[0];
  check("formulário atual: lotação, cota e horário espelhados na sessão",
    mirrored.capacity === 8 && mirrored.inteira_quota === 6 && mirrored.meia_quota === null
      && Math.abs(new Date(mirrored.starts_at) - (Date.now() + 10 * 864e5)) < 60_000);
  const { rows: mp } = await db.query(
    `select coalesce(tt.preset, lower(tt.name)) as k, stt.price_cents, stt.max_units, tt.archived_at is not null as archived
     from public.session_ticket_types stt join public.ticket_types tt on tt.id = stt.ticket_type_id
     where stt.session_id = $1`, [mirrored.id]);
  const mpm = Object.fromEntries(mp.map((r) => [r.k, r]));
  check("formulário atual: preço/limite novo e tipo novo espelhados",
    mpm.inteira?.price_cents === 6000 && mpm.inteira?.max_units === 3 && mpm.camarote?.price_cents === 20000, JSON.stringify(mpm));
  await rejects("tipo que saiu da venda: checkout recusa",
    () => checkout(single, [item(single.t.meia, 1)]), /TIPO_INDISPONIVEL/);
  const legacyInsert = await db.query(
    `insert into public.orders (event_id, buyer_name, buyer_email, total_cents, status, public_token, payment_provider)
     values ($1, 'Comprador Teste', 'comprador@example.com', 0, 'cancelado', $2, 'mercadopago') returning session_id`,
    [single.eventId, randomUUID()]);
  check("insert direto de pedido sem sessão (evento de sessão única) preenche a sessão",
    legacyInsert.rows[0].session_id === mirrored.id);

  // ---------- 4) evento com várias sessões ----------
  const multi = await newEvent({ name: "Evento Multi", capacity: 10 });
  const s1 = (await db.query("select * from public.event_sessions where event_id = $1", [multi.eventId])).rows[0];
  const { rows: s2rows } = await db.query(
    `insert into public.event_sessions (event_id, name, starts_at, ends_at, capacity, meia_quota)
     values ($1, 'Sessão infantil', now() + interval '8 days', now() + interval '8 days 2 hours', 8, 1) returning *`,
    [multi.eventId]);
  const s2 = s2rows[0];
  await db.query(
    `insert into public.session_ticket_types (session_id, ticket_type_id, price_cents, max_units, on_sale) values
       ($1, $2, 3000, null, true), ($1, $3, 1500, null, true), ($1, $4, 5000, 1, true), ($1, $5, 9999, null, false)`,
    [s2.id, multi.t.inteira, multi.t.meia, multi.t.casadinha, multi.t.vip]);
  const { rows: s3rows } = await db.query(
    `insert into public.event_sessions (event_id, name, starts_at, capacity)
     values ($1, 'Sessão extra', now() + interval '9 days', 1) returning *`, [multi.eventId]);
  const s3 = s3rows[0];
  await db.query("insert into public.session_ticket_types (session_id, ticket_type_id, price_cents) values ($1, $2, 4000)",
    [s3.id, multi.t.inteira]);

  const m1 = await checkout(multi, [item(multi.t.inteira, 1)], { sessionId: s1.id });
  const m2 = await checkout(multi, [item(multi.t.inteira, 1)], { sessionId: s2.id });
  check("preço por sessão (sessão 1: 50,00; sessão 2: 30,00)", m1.total_cents === 5000 && m2.total_cents === 3000);
  const { rows: m2items } = await db.query("select unit_price_cents from public.order_items where order_id = $1", [m2.order_id]);
  check("item guarda o preço da sessão", m2items[0].unit_price_cents === 3000);
  await rejects("sem sessão em evento de várias sessões: recusa",
    () => checkout(multi, [item(multi.t.inteira, 1)]), /SESSAO_INDISPONIVEL/);
  await rejects("sessão de outro evento: recusa",
    () => checkout(multi, [item(multi.t.inteira, 1)], { sessionId: mirrored.id }), /SESSAO_INDISPONIVEL/);
  await rejects("sessão inexistente: recusa",
    () => checkout(multi, [item(multi.t.inteira, 1)], { sessionId: randomUUID() }), /SESSAO_INDISPONIVEL/);
  await rejects("tipo fora da venda nesta sessão: recusa",
    () => checkout(multi, [item(multi.t.vip, 1)], { sessionId: s2.id }), /TIPO_INDISPONIVEL/);
  const vipS1 = await checkout(multi, [item(multi.t.vip, 1)], { sessionId: s1.id });
  check("mesmo tipo à venda em outra sessão", vipS1.total_cents === 12000);
  await checkout(multi, [item(multi.t.meia, 1)], { sessionId: s2.id });
  await rejects("cota de meia por sessão", () => checkout(multi, [item(multi.t.meia, 1)], { sessionId: s2.id }),
    /ESGOTADO_CATEGORIA:meia:0/);
  check("cota de uma sessão não afeta a outra",
    Boolean(await checkout(multi, [item(multi.t.meia, 1)], { sessionId: s1.id })));
  await checkout(multi, [item(multi.t.casadinha, 1)], { sessionId: s2.id });
  await rejects("limite do tipo por sessão", () => checkout(multi, [item(multi.t.casadinha, 1)], { sessionId: s2.id }),
    /ESGOTADO_TIPO:.*:0/);
  check("limite de uma sessão não afeta a outra",
    Boolean(await checkout(multi, [item(multi.t.casadinha, 1)], { sessionId: s1.id })));
  await rejects("lotação da sessão (sessão 2 com 8 lugares, 4 ocupados)",
    () => checkout(multi, [item(multi.t.inteira, 5)], { sessionId: s2.id }), /ESGOTADO_EVENTO:4/);
  check("event_availability com várias sessões: null (usar por sessão)",
    (await one("select public.event_availability($1) as a", [multi.eventId])).a === null);
  const summary = (await one("select public.event_sessions_summary($1) as s", [multi.eventId])).s;
  check("resumo das sessões: 3 sessões em ordem, menor preço",
    summary.sessions.length === 3 && summary.sessions[0].id === s1.id && summary.sessions[1].name === "Sessão infantil"
      && summary.min_price_cents === 1500 && summary.sessions[1].min_price_cents === 1500, JSON.stringify(summary));
  await rejects("formulário atual recusa evento de várias sessões",
    () => svc(`select public.update_event_with_capacity($1, 'X', now() + interval '10 days', 'L', '', 8, null, $2::jsonb, null, null)`,
      [multi.eventId, JSON.stringify(typesPayload)]), /SESSAO_VARIAS/);
  await rejects("cortesia antiga (sem sessão) recusa evento de várias sessões", () => courtesy(multi), /SESSAO_INDISPONIVEL/);
  const multiCourtesy = await courtesy(multi, s2.id);
  check("cortesia na sessão escolhida", (await orderRow(multiCourtesy.order_id)).session_id === s2.id);
  await rejects("insert direto de pedido sem sessão em evento de várias sessões: recusa",
    () => db.query(
      `insert into public.orders (event_id, buyer_name, buyer_email, total_cents, status, public_token, payment_provider)
       values ($1, 'X', 'x@example.com', 0, 'cancelado', $2, 'mercadopago')`, [multi.eventId, randomUUID()]),
    /SESSAO_INDISPONIVEL/);

  // ---------- 5) reserva simultânea por sessão ----------
  const a = await connect();
  const b = await connect();
  const watcher = await connect();
  const waitingFor = async (pattern) => {
    for (let i = 0; i < 50; i += 1) {
      await sleep(100);
      const { rows: w } = await watcher.query(
        "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1", [pattern]);
      if (w[0].n >= 1) return true;
    }
    return false;
  };
  await a.query("begin");
  await a.query("set local role service_role");
  await a.query(checkoutSql(true), checkoutParams(multi, [item(multi.t.inteira, 1)], s3.id, POLICY));
  const second = (async () => {
    try {
      await b.query("begin");
      await b.query("set local role service_role");
      await b.query(checkoutSql(true), checkoutParams(multi, [item(multi.t.inteira, 1)], s3.id, POLICY));
      await b.query("commit");
      return "ok";
    } catch (error) {
      await b.query("rollback");
      return error.message;
    }
  })();
  check("mesma sessão: a segunda compra espera a primeira", await waitingFor("%create_checkout_order%"));
  await a.query("commit");
  const secondResult = await second;
  check("último lugar da sessão: só uma compra leva", /ESGOTADO_EVENTO:0/.test(secondResult), secondResult);

  await a.query("begin");
  await a.query("set local role service_role");
  await a.query(checkoutSql(true), checkoutParams(multi, [item(multi.t.inteira, 1)], s1.id, POLICY));
  await b.query("begin");
  await b.query("set local role service_role");
  await b.query("set local lock_timeout = '2s'");
  let otherSession = "ok";
  try {
    await b.query(checkoutSql(true), checkoutParams(multi, [item(multi.t.inteira, 1)], s2.id, POLICY));
    await b.query("commit");
  } catch (error) {
    otherSession = error.message;
    await b.query("rollback");
  }
  await a.query("commit");
  check("sessões diferentes não se esperam", otherSession === "ok", otherSession);

  // Editor do evento × compra: travas na mesma ordem, sem deadlock.
  const lockEv = await newEvent({ name: "Trava", capacity: 5 });
  await a.query("begin");
  await a.query("set local role service_role");
  await a.query(checkoutSql(false), checkoutParams(lockEv, [item(lockEv.t.inteira, 1)], undefined, POLICY));
  const editor = (async () => {
    try {
      await b.query("begin");
      await b.query("set local role service_role");
      await b.query(
        `select public.update_event_with_capacity($1, 'Trava', now() + interval '7 days', 'L', '', 6, null, $2::jsonb, null, null)`,
        [lockEv.eventId, JSON.stringify(typesPayload)]);
      await b.query("commit");
      return "ok";
    } catch (error) {
      await b.query("rollback");
      return error.message;
    }
  })();
  check("editor do evento espera a compra em andamento", await waitingFor("%update_event_with_capacity%"));
  await a.query("commit");
  check("editor termina depois, sem deadlock", (await editor) === "ok");
  await a.end(); await b.end(); await watcher.end();

  // ---------- 6) fim automático da venda (+5 min) ----------
  const timed = await newEvent({ name: "Horário", capacity: 10 });
  const ts = (await db.query("select id from public.event_sessions where event_id = $1", [timed.eventId])).rows[0].id;
  const setStart = (minutesFromNow) => db.query(
    "update public.event_sessions set starts_at = now() + make_interval(mins => $2) where id = $1", [ts, minutesFromNow]);
  const selling = async () => (await one("select public.session_is_selling($1) as s", [ts])).s;
  const pixAllowed = async (orderId) => (await one("select public.order_pix_allowed($1) as r", [orderId])).r;

  const pending = await checkout(timed, [item(timed.t.inteira, 1)]);
  const pixBefore = await checkout(timed, [item(timed.t.inteira, 1)]);
  check("PIX liberado enquanto a sessão vende", await pixAllowed(pixBefore.order_id));
  const extended = (await one("select public.extend_order_hold_for_pix($1, now() + interval '30 minutes') as e", [pixBefore.order_id])).e;
  check("PIX gerado antes do fim estende a reserva", new Date(extended) > new Date(pixBefore.expires_at));
  const lateExpired = await checkout(timed, [item(timed.t.inteira, 1)]);
  const expiredSelling = await checkout(timed, [item(timed.t.inteira, 1)]);

  await setStart(-4);
  check("4 min depois do início: ainda vende", (await selling()) === true);
  check("checkout 4 min depois do início", Boolean(await checkout(timed, [item(timed.t.inteira, 1)])));
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1", [expiredSelling.order_id]);
  check("pagamento tardio com a sessão ainda vendendo e com lugar: vira pago", (await pay(expiredSelling.order_id)) === "updated");

  await setStart(-6);
  check("6 min depois do início: parou de vender", (await selling()) === false);
  await rejects("checkout depois de início + 5 min: SESSAO_ENCERRADA (com a mensagem antiga)",
    () => checkout(timed, [item(timed.t.inteira, 1)]), /SESSAO_ENCERRADA: As vendas deste evento estão fechadas/);
  check("PIX novo recusado depois do fim", (await pixAllowed(pending.order_id)) === false);
  const notExtended = (await one("select public.extend_order_hold_for_pix($1, now() + interval '30 minutes') as e", [pending.order_id])).e;
  check("reserva não é estendida depois do fim",
    new Date(notExtended).getTime() === new Date(pending.expires_at).getTime()
      && (await orderRow(pending.order_id)).hold_extended_at === null);
  check("cartão dentro da reserva depois do fim: vira pago", (await pay(pending.order_id)) === "updated");
  check("PIX gerado antes do fim e pago dentro da reserva: vira pago", (await pay(pixBefore.order_id)) === "updated");
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1", [lateExpired.order_id]);
  check("pago depois da reserva vencida com a venda encerrada: aguardando decisão",
    (await pay(lateExpired.order_id)) === "needs_decision_sales_closed");
  const lateRow = await orderRow(lateExpired.order_id);
  check("motivo sessao_encerrada e ingressos sem ocupar lugar",
    lateRow.status === "aguardando_decisao" && lateRow.decision_reason === "sessao_encerrada"
      && (await db.query("select count(*)::int as n from public.tickets where order_id = $1 and status = 'nao_pago'", [lateExpired.order_id])).rows[0].n === 1);
  check("equipe pode aceitar o pago após o fim das vendas",
    (await one("select public.accept_paid_order($1, $2) as r", [lateExpired.order_id, staffId])).r === "accepted");
  check("cortesia depois do fim das vendas (a equipe emite)", Boolean(await courtesy(timed)));
  await setStart(60);
  await db.query("update public.event_sessions set sales_open = false where id = $1", [ts]);
  check("venda da sessão fechada pela equipe: não vende", (await selling()) === false);
  await db.query("update public.event_sessions set sales_open = true where id = $1", [ts]);
  await db.query("update public.events set sales_open = false where id = $1", [timed.eventId]);
  check("evento fechado: sessão não vende", (await selling()) === false);
  await db.query("update public.events set sales_open = true where id = $1", [timed.eventId]);
  check("tudo aberto e antes do horário: vende", (await selling()) === true);
  const avail = (await one("select public.session_availability($1) as a", [ts])).a;
  check("disponibilidade traz selling e closes_at",
    avail.selling === true && Math.abs(new Date(avail.closes_at) - (Date.now() + 65 * 60_000)) < 60_000);

  // ---------- 7) check-in por sessão ----------
  await pay(m1.order_id);
  await pay(m2.order_id);
  const s1code = (await codesOf(m1.order_id))[0];
  const s2code = (await codesOf(m2.order_id))[0];
  const checkIn = (eventId, sessionId, code, staff = staffId) =>
    one("select * from public.check_in_ticket($1, $2, $3, $4)", [eventId, sessionId, code, staff]);
  let r = await checkIn(multi.eventId, s1.id, s2code);
  check("sessão errada: recusa e devolve só nome e horário da sessão do ingresso",
    r.outcome === "sessao_errada" && r.other_session_name === "Sessão infantil"
      && new Date(r.other_session_starts_at).getTime() === new Date(s2.starts_at).getTime()
      && r.buyer_name === null && r.ticket_kind === null, JSON.stringify(r));
  check("sessão errada não marca entrada",
    (await db.query("select status from public.tickets where code = $1", [s2code])).rows[0].status === "pago");
  r = await checkIn(multi.eventId, s2.id, s1code);
  check("sessão errada sem nome: nome nulo e horário", r.outcome === "sessao_errada" && r.other_session_name === null
    && new Date(r.other_session_starts_at).getTime() === new Date(s1.starts_at).getTime());
  r = await checkIn(multi.eventId, s2.id, s2code);
  check("sessão certa: pode entrar, com sessão, horário e evento",
    r.outcome === "ok" && r.buyer_name === "Comprador Teste" && r.type_name === "Inteira"
      && r.session_name === "Sessão infantil" && r.event_name === "Evento Multi"
      && new Date(r.session_starts_at).getTime() === new Date(s2.starts_at).getTime(), JSON.stringify(r));
  check("segunda leitura: já usado", (await checkIn(multi.eventId, s2.id, s2code)).outcome === "ja_usado");
  check("ingresso de outro evento", (await checkIn(multi.eventId, s1.id, (await codesOf(oldOrder.order_id))[0])).outcome === "evento_errado");
  check("código inexistente", (await checkIn(multi.eventId, s1.id, "nao-existe")).outcome === "nao_encontrado");
  await rejects("sessão de outro evento: dados inválidos", () => checkIn(multi.eventId, mirrored.id, s1code), /CHECKIN_DADOS/);
  await rejects("sem sessão: dados inválidos", () => checkIn(multi.eventId, null, s1code), /CHECKIN_DADOS/);
  await rejects("fora da equipe: recusado", () => checkIn(multi.eventId, s1.id, s1code, outsiderId), /CHECKIN_EQUIPE/);
  r = await one("select * from public.check_in_ticket($1, $2, $3)", [multi.eventId, s1code, staffId]);
  check("check-in antigo recusa evento de várias sessões (sem marcar entrada)", r.outcome === "invalido"
    && (await db.query("select status from public.tickets where code = $1", [s1code])).rows[0].status === "pago");
  const singleCode = (await codesOf(oldCourtesy.order_id))[0];
  r = await one("select * from public.check_in_ticket($1, $2, $3)", [single.eventId, singleCode, staffId]);
  check("check-in antigo continua funcionando em evento de sessão única", r.outcome === "ok");

  // ---------- 8) sessão cancelada ----------
  const s2pendingPaid = await checkout(multi, [item(multi.t.inteira, 1)], { sessionId: s2.id });
  const s2pending = await checkout(multi, [item(multi.t.inteira, 1)], { sessionId: s2.id });
  const s2paidCode = (await codesOf(multiCourtesy.order_id))[0];
  await db.query(
    `update public.event_sessions set status = 'cancelada', cancelled_at = now(), cancelled_by = $2,
       cancelled_by_name = 'Equipe Teste', cancel_reason = 'Chuva forte no local' where id = $1`, [s2.id, staffId]);
  await db.query("update public.orders set status = 'cancelado', cancel_reason = 'sessao_cancelada' where id = $1", [s2pendingPaid.order_id]);
  check("pagamento que chega depois do cancelamento: nunca vira pago sozinho",
    (await pay(s2pendingPaid.order_id)) === "needs_decision_session_cancelled"
      && (await orderRow(s2pendingPaid.order_id)).decision_reason === "sessao_cancelada");
  check("pagamento dentro da reserva em sessão cancelada: aguardando decisão",
    (await pay(s2pending.order_id)) === "needs_decision_session_cancelled");
  await rejects("Aceitar mesmo assim recusado em sessão cancelada",
    () => one("select public.accept_paid_order($1, $2) as r", [s2pendingPaid.order_id, staffId]), /SESSAO_CANCELADA/);
  await rejects("checkout em sessão cancelada", () => checkout(multi, [item(multi.t.inteira, 1)], { sessionId: s2.id }), /SESSAO_INDISPONIVEL/);
  await rejects("cortesia em sessão cancelada", () => courtesy(multi, s2.id), /SESSAO_INDISPONIVEL/);
  r = await checkIn(multi.eventId, s2.id, s2paidCode);
  check("sessão cancelada: não liberar entrada", r.outcome === "sessao_cancelada" && r.buyer_name === null);
  r = await checkIn(multi.eventId, s1.id, s2paidCode);
  check("sessão cancelada é conferida antes da sessão errada", r.outcome === "sessao_cancelada");
  check("sessão cancelada não vende", (await one("select public.session_is_selling($1) as s", [s2.id])).s === false);

  // ---------- 9) integridade ----------
  await rejects("pedido não muda de sessão", () => db.query("update public.orders set session_id = $2 where id = $1", [m1.order_id, s3.id]), /SESSAO_IMUTAVEL/);
  await rejects("ingresso não muda de sessão", () => db.query("update public.tickets set session_id = $2 where order_id = $1", [m1.order_id, s3.id]), /SESSAO_IMUTAVEL/);
  await rejects("sessão não muda de evento", () => db.query("update public.event_sessions set event_id = $2 where id = $1", [s3.id, single.eventId]), /SESSAO_IMUTAVEL/);
  await rejects("ingresso em sessão diferente da do pedido: recusado",
    () => db.query(
      `insert into public.tickets (order_id, event_id, session_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents)
       select order_id, event_id, $2, ticket_type_id, order_item_id, kind, 'nao_pago', $3, 'X', 0 from public.tickets where order_id = $1 limit 1`,
      [m1.order_id, s3.id, randomUUID()]), /foreign key|violates/);
  await rejects("pedido com sessão de outro evento: recusado",
    () => db.query(
      `insert into public.orders (event_id, session_id, buyer_name, buyer_email, total_cents, status, public_token, payment_provider)
       values ($1, $2, 'X', 'x@example.com', 0, 'cancelado', $3, 'mercadopago')`, [multi.eventId, mirrored.id, randomUUID()]),
    /foreign key|violates/);
  await rejects("sessão com pedidos não pode ser apagada", () => db.query("delete from public.event_sessions where id = $1", [s1.id]), /foreign key|violates/);
  const disposable = await newEvent({ name: "Descartável" });
  await db.query("delete from public.events where id = $1", [disposable.eventId]);
  check("evento sem vendas pode ser desfeito (criação que falhou)",
    (await db.query("select count(*)::int as n from public.event_sessions where event_id = $1", [disposable.eventId])).rows[0].n === 0);
  await rejects("dois horários iguais no mesmo evento: recusado",
    () => db.query("insert into public.event_sessions (event_id, starts_at, capacity) select event_id, starts_at, 5 from public.event_sessions where id = $1", [s3.id]), /duplicate|unique/);
  await rejects("lotação 0: recusada",
    () => db.query("insert into public.event_sessions (event_id, starts_at, capacity) values ($1, now() + interval '20 days', 0)", [multi.eventId]), /check/);
  await rejects("preço 0 na sessão: recusado",
    () => db.query("update public.session_ticket_types set price_cents = 0 where session_id = $1", [s1.id]), /check/);

  // A API (PostgREST) recusa embutir tabelas com mais de uma chave entre elas; o
  // painel embute pedidos em ingressos e vice-versa.
  const { rows: fkCount } = await db.query(
    `select conrelid::regclass::text as t, confrelid::regclass::text as r, count(*)::int as n
     from pg_constraint where contype = 'f'
       and conrelid in ('public.tickets'::regclass, 'public.orders'::regclass, 'public.event_sessions'::regclass,
                        'public.session_ticket_types'::regclass)
     group by 1, 2`);
  check("no máximo uma chave entre cada par de tabelas (embutir na API sem ambiguidade)",
    fkCount.every((x) => x.n === 1), JSON.stringify(fkCount.filter((x) => x.n !== 1)));

  // ---------- 10) lembrete pela sessão ----------
  const remind = await newEvent({ name: "Lembrete", capacity: 10 });
  const rs = (await db.query("update public.event_sessions set name = 'Sessão da tarde' where event_id = $1 returning id", [remind.eventId])).rows[0].id;
  const abandoned = await checkout(remind, [item(remind.t.inteira, 1)]);
  await db.query("update public.orders set created_at = now() - interval '70 minutes', expires_at = now() - interval '55 minutes' where id = $1", [abandoned.order_id]);
  await db.query("update public.orders set reminder_sent_at = now() - interval '2 days', reminder_claimed_at = now() - interval '2 days' where id <> $1", [abandoned.order_id]);
  await db.query("update public.event_sessions set starts_at = now() - interval '10 minutes' where id = $1", [rs]);
  const claim = () => svc("select * from public.claim_abandoned_order_reminders(10, 100, $1)", [POLICY]);
  check("lembrete não vai para sessão que parou de vender", (await claim()).length === 0);
  await db.query("update public.event_sessions set starts_at = now() + interval '3 days' where id = $1", [rs]);
  const reminders = await claim();
  check("lembrete devolve nome e início da sessão",
    reminders.length === 1 && reminders[0].session_name === "Sessão da tarde" && reminders[0].session_id === rs
      && new Date(reminders[0].event_starts_at).getTime() === new Date(reminders[0].session_starts_at).getTime(), JSON.stringify(reminders.map((x) => x.session_name)));

  // ---------- 11) permissões e RLS ----------
  const fns = [
    "public.session_occupied_count(uuid, uuid)",
    "public.session_kind_occupied_count(uuid, public.ticket_kind, uuid)",
    "public.session_type_units_taken(uuid, uuid, uuid)",
    "public.event_single_session_id(uuid)",
    "public.session_sales_close_offset()",
    "public.session_is_selling(uuid)",
    "public.order_pix_allowed(uuid)",
    "public.session_availability(uuid)",
    "public.event_availability(uuid)",
    "public.event_sessions_summary(uuid)",
    "public.create_checkout_order(uuid, text, text, text, text, text, jsonb, text, uuid)",
    "public.extend_order_hold_for_pix(uuid, timestamptz)",
    "public.mark_order_paid_by_external(text, text, text, text)",
    "public.accept_paid_order(uuid, uuid)",
    "public.issue_courtesy_ticket(uuid, text, text, text, uuid)",
    "public.update_event_with_capacity(uuid, text, timestamptz, text, text, integer, text, jsonb, integer, integer)",
    "public.claim_abandoned_order_reminders(integer, integer, text)",
    "public.check_in_ticket(uuid, uuid, text, uuid)",
    "public.check_in_ticket(uuid, text, uuid)",
  ];
  for (const fn of fns) {
    const { rows: p } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as svc,
              (select prosecdef from pg_proc where oid = $1::regprocedure) as definer,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`, [fn]);
    check(`${fn}: só service_role, invoker, search_path vazio`,
      !p[0].anon && !p[0].auth && p[0].svc && !p[0].definer
        && JSON.stringify(p[0].config) === JSON.stringify(['search_path=""']), JSON.stringify(p[0]));
  }
  const triggerFns = [
    "public.forbid_session_id_change()", "public.forbid_session_event_change()", "public.orders_fill_session()",
    "public.tickets_fill_session()", "public.events_create_single_session()", "public.events_sync_single_session()",
    "public.ticket_types_sync_single_session()",
  ];
  for (const fn of triggerFns) {
    const { rows: p } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`, [fn]);
    check(`${fn}: ninguém chama direto, search_path vazio`,
      !p[0].anon && !p[0].auth && JSON.stringify(p[0].config) === JSON.stringify(['search_path=""']), JSON.stringify(p[0]));
  }
  const { rows: oldSignatures } = await db.query(
    `select count(*)::int as n from pg_proc where proname in ('create_checkout_order', 'issue_courtesy_ticket')
       and pronamespace = 'public'::regnamespace`);
  check("sem sobrecarga ambígua de checkout/cortesia", oldSignatures[0].n === 2);
  for (const table of ["event_sessions", "session_ticket_types"]) {
    const { rows: rls } = await db.query("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]);
    check(`RLS ligada em ${table}`, rls[0].relrowsecurity === true);
    const { rows: pol } = await db.query("select cmd from pg_policies where tablename = $1", [table]);
    check(`${table}: só política de leitura`, pol.length === 1 && pol[0].cmd === "SELECT", JSON.stringify(pol));
    await rejects(`anon não grava em ${table}`,
      () => asRole(db, "anon", `delete from public.${table}`), /permission denied/);
    await rejects(`equipe logada não grava em ${table}`,
      () => asRole(db, "authenticated", `update public.${table} set updated_at = now()`, [], staffId), /permission denied/);
  }
  const anonSessions = (await asRole(db, "anon", "select id from public.event_sessions where event_id = any($1)",
    [[closedLegacy.eventId, multi.eventId]])).rows.map((x) => x.id);
  check("anon não vê sessão de evento fechado; vê as do evento aberto",
    anonSessions.length === 3 && !anonSessions.includes((await db.query("select id from public.event_sessions where event_id = $1", [closedLegacy.eventId])).rows[0].id));
  await db.query("update public.event_sessions set archived_at = now() where id = $1", [s3.id]);
  const outsiderSees = (await asRole(db, "authenticated", "select id from public.event_sessions where id = $1", [s3.id], outsiderId)).rows.length;
  const staffSees = (await asRole(db, "authenticated", "select id from public.event_sessions where id = $1", [s3.id], staffId)).rows.length;
  check("sessão removida: só a equipe vê", outsiderSees === 0 && staffSees === 1);
  const anonPrices = (await asRole(db, "anon", "select price_cents from public.session_ticket_types where session_id = $1", [s2.id])).rows;
  check("anon vê só preços à venda", anonPrices.length === 3 && !anonPrices.some((p) => p.price_cents === 9999));
  await rejects("anon não chama check-in", () => asRole(db, "anon", "select * from public.check_in_ticket($1, $2, 'x', $3)", [multi.eventId, s1.id, staffId]), /permission denied/);
  await rejects("authenticated não chama checkout", () => asRole(db, "authenticated", checkoutSql(true), checkoutParams(multi, [item(multi.t.inteira, 1)], s1.id, POLICY), staffId), /permission denied/);

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTUDO OK" : `\nFALHAS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
