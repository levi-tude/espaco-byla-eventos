// Matriz de permissões das contas de organizador (spec 2026-10-13-contas-organizador-design;
// plano 2026-10-14-contas-organizador-fase2, tarefa 3) num Postgres temporário: aplica
// todas as migrations em ordem e confere a trava do evento, equipe × organizador, RLS,
// convites, link de senha, evento do organizador, pedidos, portaria, área desligada,
// histórico imutável e permissões das funções novas. No fim roda o ensaio de produção
// (supabase/tests/organizer_accounts_check.sql) num segundo banco, com as duas migrations
// coladas, e confere que ele termina com ENSAIO, só "ok", e não deixa nada para trás.
// Não usa banco real.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg instalados> node scripts/db-tests/organizer-accounts.mjs

import { createHash, randomUUID } from "node:crypto";
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
const ENSAIO_FILE = join(ROOT, "supabase", "tests", "organizer_accounts_check.sql");
const MIGRATION_A = "20261018100000_organizer_accounts.sql";
const MIGRATION_B = "20261018110000_organizer_operations.sql";
const PORT = 54913;
const DATA_DIR = join(TOOLS, "data-organizer-accounts");
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

async function openDb(name, withRoles) {
  await server.createDatabase(name);
  const client = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: name });
  client.on("error", () => {});
  await client.connect();
  if (withRoles) await client.query(ROLES);
  await client.query(STUBS);
  return client;
}

try {
  const db = await openDb("byla", true);

  // O Postgres embutido pode vir sem a base de fusos: só aqui troca Brasília por UTC.
  const hasTz = (await db.query("select count(*)::int as n from pg_timezone_names where name = 'America/Sao_Paulo'")).rows[0].n > 0;
  const migrationSql = (file) => {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    return hasTz ? text : text.replaceAll("'America/Sao_Paulo'", "'UTC'");
  };
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  check("as duas migrations novas são as últimas", files.at(-2) === MIGRATION_A && files.at(-1) === MIGRATION_B, files.slice(-3).join(","));
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
  const asUser = (user, sql, params = [], sid = user.sid) =>
    run("authenticated", { sub: user.id, session_id: sid, role: "authenticated" }, sql, params);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const hashOf = (text) => createHash("sha256").update(text).digest("hex");
  const newToken = () => hashOf(randomUUID() + randomUUID());

  const newUser = async (email) => {
    const id = randomUUID();
    await q("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    return id;
  };
  const newSession = async (userId, verified) => {
    const sid = randomUUID();
    await q("insert into auth.sessions (id, user_id) values ($1, $2)", [sid, userId]);
    if (verified) {
      await q(`insert into public.verified_sessions (session_id, user_id, method, expires_at)
               values ($1, $2, 'codigo', now() + interval '12 hours')`, [sid, userId]);
    }
    return sid;
  };
  const newStaff = async (email, name, role, isDeveloper = false) => {
    const id = await newUser(email);
    await q("insert into public.staff_profiles (user_id, display_name, role, is_developer) values ($1, $2, $3, $4)",
      [id, name, role, isDeveloper]);
    return { id, sid: await newSession(id, true) };
  };
  const newOrganizer = async (email, publicName, status = "ativo") => {
    const id = await newUser(email);
    await q(`insert into public.organizer_profiles (user_id, full_name, public_name, phone, pix_key_type, pix_key,
      pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id, status, status_reason)
      values ($1, 'Fulana de Tal', $2, '71999998888', 'cpf', '52998224725', 'Fulana de Tal', '52998224725',
              '2026-10-14', now(), gen_random_uuid(), $3, case when $3 = 'ativo' then null else 'Conta de teste parada' end)`,
    [id, publicName, status]);
    return { id, sid: await newSession(id, true) };
  };

  const admin = await newStaff("admin@exemplo.com", "Admin Teste", "admin");
  const dev = await newStaff("dev@exemplo.com", "Dev Teste", "admin", true);
  const sec = await newStaff("secretaria@exemplo.com", "Secretaria Teste", "secretaria");
  const orgA = await newOrganizer("fulana@exemplo.com", "Produtora A");
  orgA.sidNv = await newSession(orgA.id, false);
  const orgB = await newOrganizer("beltrana@exemplo.com", "Produtora B");
  const orgS = await newOrganizer("suspensa@exemplo.com", "Produtora Parada", "suspenso");
  await q("update public.organizer_settings set enabled = true");

  const COVER = "https://exemplo.com/capa.jpg";
  const types = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
  ];
  const days = (n, h = 19) => {
    const d = new Date(Date.now() + n * 86400000);
    d.setUTCHours(h + 3, 0, 0, 0);
    return d.toISOString();
  };
  const price = (type_index, price_cents, extra = {}) => ({ type_index, price_cents, max_units: null, on_sale: true, ...extra });
  const session = (o = {}) => ({
    id: null, name: null, starts_at: days(7), ends_at: null, capacity: 30, inteira_quota: null, meia_quota: null,
    prices: [price(0, 5000), price(1, 2500)],
    ...o,
  });
  const createOrgEvent = (org, slug, name, { sessions = [session()], cover = null } = {}) => scalar(
    "select public.create_organizer_event($1, $2, $3, 'Espaço Teste', 'desc', $4, $5::jsonb, $6::jsonb) as v",
    [org.id, slug, name, cover, JSON.stringify(types), JSON.stringify(sessions)]);
  const saveAs = (actorId, eventId, { name, venue = "Espaço Teste", description = "desc", cover = COVER, sessions, ticketTypes = types }) => svc(
    "select public.save_event_with_sessions($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)",
    [eventId, name, venue, description, cover, JSON.stringify(ticketTypes), JSON.stringify(sessions), actorId]);
  const submit = (org, eventId) => svc("select public.submit_event_for_approval($1, $2)", [org.id, eventId]);
  const decide = (staff, eventId, decision, publish = true, note = null) => svc(
    "select public.decide_event_approval($1, $2, $3, $4, $5)", [staff.id, eventId, decision, publish, note]);
  const approvedEvent = async (org, slug, name) => {
    const id = await createOrgEvent(org, slug, name, { cover: COVER });
    await submit(org, id);
    await decide(admin, id, "aprovar");
    return id;
  };
  const teamEvent = async (slug, name) => {
    const id = (await one(
      `insert into public.events (slug, name, venue, description, starts_at, capacity, sales_open)
       values ($1, $2, 'Espaço', '', $3, 30, true) returning id`, [slug, name, days(7)])).id;
    await saveAs(sec.id, id, { name, venue: "Espaço", description: "", cover: null, sessions: [session()] });
    return id;
  };
  const sessionsOf = async (eventId) => q(
    "select * from public.event_sessions where event_id = $1 and archived_at is null order by starts_at, id", [eventId]);
  const sessionOf = async (eventId) => (await sessionsOf(eventId))[0].id;
  const eventRow = (eventId) => one("select * from public.events where id = $1", [eventId]);
  let codeSeq = 0;
  const addOrder = async (eventId, { status = "pago", kind = "inteira", ticketStatus = "pago", tickets = 1, expires = null, sessionId = null } = {}) => {
    const sess = sessionId ?? await sessionOf(eventId);
    const tt = await one(
      "select id, name from public.ticket_types where event_id = $1 and kind = $2 order by archived_at nulls first limit 1", [eventId, kind]);
    const unit = kind === "cortesia" ? 0 : 5000;
    const order = (await one(
      `insert into public.orders (event_id, session_id, buyer_name, buyer_email, buyer_phone, total_cents, status, public_token, paid_at, expires_at)
       values ($1, $2, 'Comprador Teste', 'comprador@exemplo.com', '71988887777', $3, $4::public.order_status, $5,
               case when $4::text = 'pago' then now() end, $6) returning id`,
      [eventId, sess, unit * tickets, status, randomUUID(), expires])).id;
    const item = (await one(
      `insert into public.order_items (order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit, quantity, line_total_cents)
       values ($1, $2, $3, $4, $5, 1, $6, $7) returning id`,
      [order, tt.id, tt.name ?? "Inteira", kind, unit, tickets, unit * tickets])).id;
    for (let i = 0; i < tickets; i += 1) {
      codeSeq += 1;
      await q(`insert into public.tickets (order_id, event_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents)
               values ($1, $2, $3, $4, $5, $6, $7, 'Comprador Teste', $8)`,
      [order, eventId, tt.id, item, kind, ticketStatus, `COD-${codeSeq}`, unit]);
    }
    return order;
  };
  const codeOf = async (orderId) => (await one("select code from public.tickets where order_id = $1 limit 1", [orderId])).code;
  const addImage = async (eventId) => q(
    "insert into public.event_images (event_id, storage_path) values ($1, $2)", [eventId, `events/${eventId}/${randomUUID()}.webp`]);
  const countAs = async (user, table, eventId, sid) => (await asUser(user,
    table === "session_ticket_types"
      ? "select 1 from public.session_ticket_types stt join public.event_sessions s on s.id = stt.session_id where s.event_id = $1"
      : `select 1 from public.${table} where ${table === "events" ? "id" : "event_id"} = $1`,
    [eventId], sid)).length;

  // ======================= 1) TRAVA DO EVENTO =======================
  const espaco = await teamEvent("evento-do-espaco", "Evento do Espaço");
  const draftA = await createOrgEvent(orgA, "rascunho-a", "Rascunho A");
  const draftB = await createOrgEvent(orgB, "rascunho-b", "Rascunho B");
  check("rascunho nasce fechado e com dono",
    (await eventRow(draftA)).approval_status === "rascunho" && (await eventRow(draftA)).sales_open === false
      && (await eventRow(draftA)).organizer_id === orgA.id);
  check("secretaria verificada vê o rascunho pela política da equipe",
    (await asUser(sec, "select id from public.events where id = $1", [draftA])).length === 1);
  await rejects("1. secretaria aprova rascunho direto: ORG_ESTADO",
    () => asUser(sec, "update public.events set approval_status = 'aprovado' where id = $1", [draftA]), /^ORG_ESTADO/);
  await rejects("1. secretaria cria evento com organizer_id: ORG_ESTADO",
    () => asUser(sec, `insert into public.events (slug, name, venue, starts_at, capacity, organizer_id)
                       values ('pirata', 'Pirata', 'Espaço', now() + interval '7 days', 30, $1)`, [orgA.id]), /^ORG_ESTADO/);
  await rejects("1. secretaria cria evento já em análise: ORG_ESTADO",
    () => asUser(sec, `insert into public.events (slug, name, venue, starts_at, capacity, approval_status)
                       values ('pirata-2', 'Pirata', 'Espaço', now() + interval '7 days', 30, 'em_analise')`), /^ORG_ESTADO/);
  await rejects("1. servidor abre venda de rascunho: ORG_ESTADO",
    () => svc("update public.events set sales_open = true where id = $1", [draftA]), /^ORG_ESTADO/);
  await rejects("1. servidor exclui evento direto: ORG_ESTADO",
    () => svc("update public.events set deleted_at = now() where id = $1", [draftA]), /^ORG_ESTADO/);
  await rejects("1. troca de dono: ORG_DONO",
    () => asUser(sec, "update public.events set organizer_id = $2 where id = $1", [draftA, orgB.id]), /^ORG_DONO/);
  await rejects("1. evento do Espaço não ganha dono: ORG_DONO",
    () => svc("update public.events set organizer_id = $2 where id = $1", [espaco, orgA.id]), /^ORG_DONO/);
  check("1. equipe continua editando evento do Espaço direto",
    (await asUser(sec, "update public.events set description = 'nova' where id = $1 returning id", [espaco])).length === 1);
  check("1. sem sessão verificada a secretaria não altera nada",
    (await asUser(sec, "update public.events set description = 'x' where id = $1 returning id", [espaco], randomUUID())).length === 0);

  // ======================= 2) EQUIPE × ORGANIZADOR =======================
  await rejects("2. conta da equipe não vira organizador: ORG_ACESSO",
    () => q(`insert into public.organizer_profiles (user_id, full_name, public_name, phone, pix_key_type, pix_key,
             pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id)
             values ($1, 'Fulana de Tal', 'X', '71999998888', 'cpf', '52998224725', 'Fulana de Tal', '52998224725',
                     '2026-10-14', now(), gen_random_uuid())`, [sec.id]), /ORG_ACESSO/);
  await rejects("2. organizador não vira equipe: ORG_ACESSO",
    () => q("insert into public.staff_profiles (user_id, display_name) values ($1, 'X')", [orgA.id]), /ORG_ACESSO/);

  // ======================= 3) RLS =======================
  await addImage(draftA);
  await addImage(draftB);
  for (const table of ["events", "event_sessions", "ticket_types", "session_ticket_types", "event_images"]) {
    check(`3. A verificado lê o próprio rascunho: ${table}`, (await countAs(orgA, table, draftA)) >= 1);
    check(`3. A não lê o rascunho de B: ${table}`, (await countAs(orgA, table, draftB)) === 0);
    check(`3. A sem código não lê o próprio rascunho: ${table}`, (await countAs(orgA, table, draftA, orgA.sidNv)) === 0);
    check(`3. sessão de outra conta não vale: ${table}`, (await countAs(orgA, table, draftA, orgB.sid)) === 0);
    check(`3. anônimo não lê rascunho: ${table}`, (await anon(
      table === "session_ticket_types"
        ? "select 1 from public.session_ticket_types stt join public.event_sessions s on s.id = stt.session_id where s.event_id = $1"
        : `select 1 from public.${table} where ${table === "events" ? "id" : "event_id"} = $1`, [draftA])).length === 0);
    check(`3. suspenso não lê rascunho alheio: ${table}`, (await countAs(orgS, table, draftA)) === 0);
  }
  check("3. A lê o próprio rascunho mesmo com tipo cortesia (lista completa)",
    (await asUser(orgA, "select kind from public.ticket_types where event_id = $1", [draftA])).some((t) => t.kind === "cortesia"));

  // Vendas para a parte de pedidos: evento aprovado de A com pedido pago e estorno registrado.
  const evRls = await approvedEvent(orgA, "show-rls", "Show RLS");
  const rlsPaid = await addOrder(evRls, { tickets: 2 });
  const rlsRefund = await addOrder(evRls);
  await q("update public.orders set payment_provider = 'mercadopago' where id = $1", [rlsRefund]);
  await svc("select * from public.begin_order_refund($1, $2, 'Pedido do comprador')", [rlsRefund, sec.id]);
  for (const table of ["orders", "tickets", "order_items", "order_refunds"]) {
    const sql = table === "order_items" || table === "order_refunds"
      ? `select 1 from public.${table} x join public.orders o on o.id = x.order_id where o.event_id = $1`
      : `select 1 from public.${table} where event_id = $1`;
    const teamRows = (await asUser(sec, sql, [evRls])).length;
    check(`3. equipe verificada lê ${table} (controle)`, teamRows >= 1, String(teamRows));
    let ownerRows = -1;
    try {
      ownerRows = (await asUser(orgA, sql, [evRls])).length;
    } catch (error) {
      ownerRows = /permission denied/.test(error.message) ? 0 : -1;
    }
    check(`3. organizador não lê ${table} nem do próprio evento`, ownerRows === 0, String(ownerRows));
  }
  void rlsPaid;
  const profilesA = await asUser(orgA, "select user_id from public.organizer_profiles");
  check("3. organizer_profiles: A lê só a própria linha", profilesA.length === 1 && profilesA[0].user_id === orgA.id);
  check("3. organizer_profiles: sem código A não lê", (await asUser(orgA, "select 1 from public.organizer_profiles", [], orgA.sidNv)).length === 0);
  check("3. organizer_profiles: suspenso não lê", (await asUser(orgS, "select 1 from public.organizer_profiles")).length === 0);
  check("3. organizer_profiles: equipe não lê", (await asUser(sec, "select 1 from public.organizer_profiles")).length === 0);
  await rejects("3. organizer_profiles: anônimo sem acesso", () => anon("select 1 from public.organizer_profiles"), /permission denied/);
  await rejects("3. organizer_profiles: A não altera o próprio perfil",
    () => asUser(orgA, "update public.organizer_profiles set public_name = 'Outra' where user_id = $1", [orgA.id]), /permission denied/);
  check("3. my_account_kind do organizador", (await asUser(orgA, "select public.my_account_kind() as v"))[0].v === "organizador");
  check("3. my_account_kind da equipe", (await asUser(sec, "select public.my_account_kind() as v"))[0].v === "equipe");
  await q("update public.organizer_settings set enabled = false");
  check("3. área desligada: A não lê o perfil", (await asUser(orgA, "select 1 from public.organizer_profiles")).length === 0);
  check("3. área desligada: A não lê o rascunho", (await countAs(orgA, "events", draftA)) === 0);
  await q("update public.organizer_settings set enabled = true");
  for (const table of ["organizer_settings", "organizer_signup_requests", "organizer_invites", "organizer_ops_requests", "audit_log"]) {
    await rejects(`3. ${table}: organizador logado sem acesso`, () => asUser(orgA, `select 1 from public.${table}`), /permission denied/);
    await rejects(`3. ${table}: servidor sem acesso direto`, () => svc(`select 1 from public.${table}`), /permission denied/);
  }

  // ======================= 4) CONVITE =======================
  const invite = async (hash, staff = admin, kind = "convite", target = null) => scalar(
    "select public.create_organizer_invite($1, $2, $3, null, null, $4) as v", [staff.id, hash, kind, target]);
  const checkInvite = (hash) => scalar("select public.check_organizer_invite($1) as v", [hash]);
  const startCode = (hash, email, code) => scalar("select public.start_invite_email_code($1, $2, $3) as v", [hash, email, code]);
  const verifyCode = (hash, code) => scalar("select public.verify_invite_email_code($1, $2) as v", [hash, code]);
  const accept = (hash, userId, { type = "cpf", key = "52998224725", doc = "52998224725" } = {}) => svc(
    `select public.accept_organizer_invite($1, $2, 'Fulana de Tal', 'Produtora C', '71999998888', $3, $4,
            'Fulana de Tal', $5, '2026-10-14')`, [hash, userId, type, key, doc]);

  await rejects("4. hash fora do formato: ORG_CONVITE", () => invite("abc"), /^ORG_CONVITE/);
  await rejects("4. hash em maiúsculas: ORG_CONVITE", () => invite(newToken().toUpperCase()), /^ORG_CONVITE/);
  await rejects("4. secretaria gera convite: ORG_ACESSO", () => invite(newToken(), sec), /^ORG_ACESSO/);
  await rejects("4. organizador gera convite: ORG_ACESSO", () => invite(newToken(), orgA), /^ORG_ACESSO/);
  check("4. desenvolvedor (Admin) gera convite", typeof (await invite(newToken(), dev)) === "string");

  const hExpired = newToken();
  await invite(hExpired);
  check("4. convite novo é válido", (await checkInvite(hExpired)) === "valido");
  await q("update public.organizer_invites set expires_at = now() - interval '1 second' where token_hash = $1", [hExpired]);
  check("4. convite vencido: invalido", (await checkInvite(hExpired)) === "invalido");
  check("4. convite vencido não envia código", (await startCode(hExpired, "nova@exemplo.com", "123456")) === "invalido");
  const hRevoked = newToken();
  const revokedId = await invite(hRevoked);
  await rejects("4. secretaria não revoga", () => svc("select public.revoke_organizer_invite($1, $2)", [sec.id, revokedId]), /^ORG_ACESSO/);
  check("4. Admin revoga", (await scalar("select public.revoke_organizer_invite($1, $2) as v", [admin.id, revokedId])) === true);
  check("4. convite revogado: invalido", (await checkInvite(hRevoked)) === "invalido");

  const h1 = newToken();
  await invite(h1);
  check("4. e-mail já existente (outra caixa): email_indisponivel", (await startCode(h1, " ADMIN@Exemplo.com ", "111111")) === "email_indisponivel");
  check("4. código fora do formato não é enviado", (await startCode(h1, "nova@exemplo.com", "12345")) === "invalido");
  check("4. 1º envio", (await startCode(h1, "Nova@Exemplo.com", "111111")) === "ok");
  for (let i = 1; i <= 4; i += 1) {
    check(`4. código errado ${i}: invalido`, (await verifyCode(h1, "000000")) === "invalido");
  }
  check("4. 5º código errado: bloqueado", (await verifyCode(h1, "000000")) === "bloqueado");
  check("4. código certo depois do bloqueio: bloqueado", (await verifyCode(h1, "111111")) === "bloqueado");
  check("4. 2º envio", (await startCode(h1, "nova@exemplo.com", "222222")) === "ok");
  check("4. 3º envio", (await startCode(h1, "nova@exemplo.com", "333333")) === "ok");
  check("4. 4º envio: limite", (await startCode(h1, "nova@exemplo.com", "444444")) === "limite");
  check("4. código antigo não vale", (await verifyCode(h1, "222222")) === "invalido");
  const stored = await one("select email_code_hash, email_code_salt from public.organizer_invites where token_hash = $1", [h1]);
  check("4. código guardado só como hash com sal", stored.email_code_hash !== "333333" && stored.email_code_hash !== hashOf("333333")
    && /^[0-9a-f]{64}$/.test(stored.email_code_hash) && stored.email_code_salt.length >= 32);
  check("4. código certo do último envio: ok", (await verifyCode(h1, "333333")) === "ok");
  check("4. e-mail confirmado em minúsculas", (await scalar("select public.invite_verified_email($1) as v", [h1])) === "nova@exemplo.com");

  const h2 = newToken();
  await invite(h2);
  const userNoCode = await newUser("semcodigo@exemplo.com");
  await rejects("4. aceite sem e-mail confirmado: ORG_EMAIL", () => accept(h2, userNoCode), /^ORG_EMAIL/);
  const userOther = await newUser("outra@exemplo.com");
  await rejects("4. aceite com e-mail da conta diferente: ORG_EMAIL", () => accept(h1, userOther), /^ORG_EMAIL/);
  await rejects("4. aceite com conta inexistente: ORG_EMAIL", () => accept(h1, randomUUID()), /^ORG_EMAIL/);
  const orgCId = await newUser("nova@exemplo.com");
  await rejects("4. CPF inválido (52998224724): ORG_DADOS",
    () => accept(h1, orgCId, { key: "52998224724", doc: "52998224724" }), /^ORG_DADOS/);
  await rejects("4. chave tipo cpf diferente do documento: ORG_DADOS",
    () => accept(h1, orgCId, { key: "11144477735", doc: "52998224725" }), /^ORG_DADOS/);
  await rejects("4. chave tipo cnpj com documento de CPF: ORG_DADOS",
    () => accept(h1, orgCId, { type: "cnpj", key: "52998224725", doc: "52998224725" }), /^ORG_DADOS/);
  // Conta com o e-mail confirmado que já é da equipe: só a trava equipe × organizador barra.
  const hStaff = newToken();
  await invite(hStaff);
  check("4. equipe: envio para e-mail novo", (await startCode(hStaff, "equipe-nova@exemplo.com", "777777")) === "ok");
  check("4. equipe: código certo", (await verifyCode(hStaff, "777777")) === "ok");
  const staffNew = await newStaff("equipe-nova@exemplo.com", "Equipe Nova", "secretaria");
  await rejects("4. conta da equipe com o e-mail confirmado não aceita convite: ORG_ACESSO",
    () => accept(hStaff, staffNew.id), /^ORG_ACESSO/);
  check("4. equipe: convite continua sem uso e nenhum perfil criado", (await checkInvite(hStaff)) === "valido"
    && (await one("select count(*)::int as n from public.organizer_profiles where user_id = $1", [staffNew.id])).n === 0);
  await accept(h1, orgCId);
  const profC = await one("select status, pix_holder_document from public.organizer_profiles where user_id = $1", [orgCId]);
  check("4. aceite com CPF 52998224725: perfil ativo", profC?.status === "ativo" && profC.pix_holder_document === "52998224725");
  const usedInv = await one(
    "select used_at, used_by, email_code_salt, email_code_hash, email_code_expires_at from public.organizer_invites where token_hash = $1", [h1]);
  check("4. convite usado e campos do código apagados", usedInv.used_at !== null && usedInv.used_by === orgCId
    && usedInv.email_code_salt === null && usedInv.email_code_hash === null && usedInv.email_code_expires_at === null);
  check("4. convite usado: invalido", (await checkInvite(h1)) === "invalido");
  await rejects("4. segundo aceite com o mesmo token: ORG_CONVITE", () => accept(h1, orgCId), /^ORG_CONVITE/);
  check("4. histórico do aceite sem dado pessoal", (await one(
    "select count(*)::int as n from public.audit_log where organizer_id = $1 and action in ('convite_usado', 'conta_criada') and details::text !~ '@|5299822'",
    [orgCId])).n === 2);

  const h3 = newToken();
  await invite(h3);
  check("4. CNPJ: envio", (await startCode(h3, "empresa@exemplo.com", "555555")) === "ok");
  check("4. CNPJ: código", (await verifyCode(h3, "555555")) === "ok");
  const orgDId = await newUser("empresa@exemplo.com");
  await accept(h3, orgDId, { type: "cnpj", key: "11222333000181", doc: "11222333000181" });
  check("4. aceite com CNPJ 11222333000181: perfil criado",
    (await one("select pix_key_type from public.organizer_profiles where user_id = $1", [orgDId]))?.pix_key_type === "cnpj");
  const orgC = { id: orgCId, sid: await newSession(orgCId, true) };
  const orgD = { id: orgDId, sid: await newSession(orgDId, true) };

  // ======================= 5) LINK DE SENHA =======================
  const resetLink = (target, hash = newToken()) => invite(hash, admin, "redefinir_senha", target).then(() => hash);
  const consumeResetLink = (hash) => scalar("select public.use_password_reset_invite($1) as v", [hash]);
  await rejects("5. alvo da equipe: ORG_ACESSO", () => resetLink(sec.id), /^ORG_ACESSO/);
  await rejects("5. alvo inexistente: ORG_ACESSO", () => resetLink(randomUUID()), /^ORG_ACESSO/);
  await rejects("5. sem alvo: ORG_ACESSO", () => resetLink(null), /^ORG_ACESSO/);
  await rejects("5. organizador suspenso: ORG_CONVITE", () => resetLink(orgS.id), /^ORG_CONVITE/);
  await rejects("5. secretaria gera link: ORG_ACESSO", () => invite(newToken(), sec, "redefinir_senha", orgC.id), /^ORG_ACESSO/);
  const oldLink = await resetLink(orgC.id);
  const link = await resetLink(orgC.id);
  await rejects("5. link anterior revogado pelo novo: ORG_CONVITE", () => consumeResetLink(oldLink), /^ORG_CONVITE/);
  check("5. link de senha não vale como convite", (await checkInvite(link)) === "invalido");
  await newSession(orgC.id, true);
  await q("insert into public.trusted_devices (user_id, token_hash, expires_at) values ($1, $2, now() + interval '30 days')",
    [orgC.id, hashOf(randomUUID())]);
  check("5. uso devolve o alvo", (await consumeResetLink(link)) === orgC.id);
  check("5. uso apaga as sessões verificadas do alvo",
    (await one("select count(*)::int as n from public.verified_sessions where user_id = $1", [orgC.id])).n === 0);
  check("5. uso revoga os aparelhos do alvo",
    (await one("select count(*)::int as n from public.trusted_devices where user_id = $1 and revoked_at is null", [orgC.id])).n === 0);
  check("5. outras contas não perdem a sessão",
    (await one("select count(*)::int as n from public.verified_sessions where user_id = $1", [orgA.id])).n >= 1);
  await rejects("5. segundo uso: ORG_CONVITE", () => consumeResetLink(link), /^ORG_CONVITE/);
  await rejects("5. convite comum não troca senha: ORG_CONVITE", () => consumeResetLink(h3), /^ORG_CONVITE/);
  orgC.sid = await newSession(orgC.id, true);

  // Aparelhos (Task 1, correção): esquecer um aparelho derruba as outras sessões.
  const deviceToken = "x".repeat(43);
  const deviceId = (await one("insert into public.trusted_devices (user_id, token_hash, expires_at) values ($1, $2, now() + interval '30 days') returning id",
    [orgC.id, hashOf(deviceToken)])).id;
  const sidOtherC = await newSession(orgC.id, true);
  check("5. lista de aparelhos marca o atual", (await asUser(orgC, "select * from public.list_my_devices($1)", [deviceToken]))
    .find((d) => d.id === deviceId)?.is_current === true);
  check("5. esquecer aparelho", (await asUser(orgC, "select public.forget_my_device($1) as v", [deviceId]))[0].v === true);
  const leftC = (await q("select session_id from public.verified_sessions where user_id = $1", [orgC.id])).map((r) => r.session_id);
  check("5. outras sessões derrubadas, a atual fica", leftC.length === 1 && leftC[0] === orgC.sid && !leftC.includes(sidOtherC), JSON.stringify(leftC));
  check("5. esquecer de novo: falso", (await asUser(orgC, "select public.forget_my_device($1) as v", [deviceId]))[0].v === false);
  check("5. A não esquece aparelho de C", (await asUser(orgA, "select public.forget_my_device($1) as v", [deviceId]))[0].v === false);

  // ======================= 6) EVENTO DO ORGANIZADOR =======================
  await rejects("6. sessão com 101 lugares: ORG_LOTACAO:100",
    () => createOrgEvent(orgA, "show-grande", "Show Grande", { sessions: [session({ capacity: 101 })] }), /^ORG_LOTACAO:100$/);
  await rejects("6. suspenso não cria evento: ORG_ACESSO", () => createOrgEvent(orgS, "show-parado", "Show Parado"), /^ORG_ACESSO/);
  await rejects("6. equipe não cria evento de organizador: ORG_ACESSO", () => createOrgEvent(sec, "show-equipe", "Show Equipe"), /^ORG_ACESSO/);
  await rejects("6. slug repetido: ORG_DADOS:slug", () => createOrgEvent(orgA, "rascunho-a", "Outro"), /^ORG_DADOS:slug$/);
  await rejects("6. slug fora do formato: ORG_DADOS", () => createOrgEvent(orgA, "Show Feio", "Outro"), /^ORG_DADOS/);
  await rejects("6. sessão malformada: SESSAO_INVALIDA:1",
    () => createOrgEvent(orgA, "show-malformado", "Show", { sessions: [session({ starts_at: "xx" })] }), /^SESSAO_INVALIDA:1/);
  const trimmed = await createOrgEvent(orgA, "show-espacos", "  Show Espaços  ");
  check("6. dono grava nome sem espaços nas pontas", (await eventRow(trimmed)).name === "Show Espaços");
  await saveAs(admin.id, trimmed, { name: " Equipe ", venue: " Local ", cover: null, sessions: [session()] });
  check("6. equipe grava como antes", (await eventRow(trimmed)).name === " Equipe " && (await eventRow(trimmed)).venue === " Local ");

  const ev6 = await createOrgEvent(orgA, "show-seis", "Show Seis");
  const s6 = await sessionOf(ev6);
  await rejects("6. envio sem capa: ORG_ESTADO:capa", () => submit(orgA, ev6), /^ORG_ESTADO:capa$/);
  await rejects("6. B envia o evento de A: ORG_DONO", () => submit(orgB, ev6), /^ORG_DONO/);
  await rejects("6. dono não abre venda de rascunho: ORG_ESTADO:nao_aprovado",
    () => svc("select public.set_session_sales_open($1, true, $2)", [s6, orgA.id]), /^ORG_ESTADO:nao_aprovado$/);
  await saveAs(orgA.id, ev6, { name: "Show Seis", sessions: [session({ id: s6 })] });
  await submit(orgA, ev6);
  check("6. envio certo: em_analise", (await eventRow(ev6)).approval_status === "em_analise");
  await rejects("6. A salva em análise: ORG_ESTADO:em_analise",
    () => saveAs(orgA.id, ev6, { name: "Show Seis", sessions: [session({ id: s6 })] }), /^ORG_ESTADO:em_analise$/);
  await rejects("6. secretaria decide: ORG_ACESSO", () => decide(sec, ev6, "aprovar"), /^ORG_ACESSO/);
  await rejects("6. organizador decide: ORG_ACESSO", () => decide(orgA, ev6, "aprovar"), /^ORG_ACESSO/);
  await rejects("6. Admin recusa sem nota: ORG_DADOS", () => decide(admin, ev6, "recusar", false, null), /^ORG_DADOS/);
  await rejects("6. decisão inválida: ORG_DADOS", () => decide(admin, ev6, "talvez"), /^ORG_DADOS/);
  await q("update public.organizer_settings set max_session_capacity = 10");
  await rejects("6. aprovar reconfere a lotação: ORG_LOTACAO:10", () => decide(admin, ev6, "aprovar"), /^ORG_LOTACAO:10$/);
  await q("update public.organizer_settings set max_session_capacity = 100");
  await decide(admin, ev6, "aprovar", true);
  const ev6Row = await eventRow(ev6);
  check("6. Admin aprova e publica: aprovado, à venda, published_at",
    ev6Row.approval_status === "aprovado" && ev6Row.sales_open === true && ev6Row.published_at !== null
      && ev6Row.approval_decided_by === admin.id);
  await rejects("6. decidir de novo: ORG_ESTADO:estado", () => decide(admin, ev6, "aprovar"), /^ORG_ESTADO:estado$/);
  check("6. anônimo vê o evento aprovado", (await anon("select id from public.events where id = $1", [ev6])).length === 1);
  check("6. produção pública", (await anon("select public.public_event_producer($1) as v", [ev6]))[0].v === "Produtora A");
  check("6. rascunho sem produção pública", (await anon("select public.public_event_producer($1) as v", [draftA]))[0].v === null);

  await addOrder(ev6, { sessionId: s6 });
  check("6. sessão com venda", (await scalar("select public.session_has_live_orders($1) as v", [s6])) === true);
  const base6 = (o = {}, extra = {}) => ({ name: "Show Seis", sessions: [session({ id: s6, ...o })], ...extra });
  await rejects("6. com venda, muda nome: ORG_ESTADO:mudanca:nome",
    () => saveAs(orgA.id, ev6, base6({}, { name: "Show Novo" })), /^ORG_ESTADO:mudanca:nome$/);
  await rejects("6. com venda, muda local: ORG_ESTADO:mudanca:local",
    () => saveAs(orgA.id, ev6, base6({}, { venue: "Outro Lugar" })), /^ORG_ESTADO:mudanca:local$/);
  await rejects("6. com venda, muda horário: ORG_ESTADO:mudanca:horario",
    () => saveAs(orgA.id, ev6, base6({ starts_at: days(8) })), /^ORG_ESTADO:mudanca:horario$/);
  await rejects("6. com venda, muda preço: ORG_ESTADO:mudanca:preco",
    () => saveAs(orgA.id, ev6, base6({ prices: [price(0, 6000), price(1, 2500)] })), /^ORG_ESTADO:mudanca:preco$/);
  await rejects("6. com venda, reduz lugares: ORG_ESTADO:mudanca:lotacao",
    () => saveAs(orgA.id, ev6, base6({ capacity: 20 })), /^ORG_ESTADO:mudanca:lotacao$/);
  await rejects("6. com venda, tira tipo da lista: ORG_ESTADO:mudanca:preco",
    () => saveAs(orgA.id, ev6, base6({ prices: [price(0, 5000)] })), /^ORG_ESTADO:mudanca:preco$/);
  await rejects("6. com venda, pausa um tipo: ORG_ESTADO:mudanca:preco",
    () => saveAs(orgA.id, ev6, base6({ prices: [price(0, 5000), price(1, 2500, { on_sale: false })] })), /^ORG_ESTADO:mudanca:preco$/);
  await rejects("6. com venda, tipo arquivado agora (save_event_ticket_types): ORG_ESTADO:mudanca:preco",
    () => saveAs(orgA.id, ev6, { ...base6({ prices: [price(0, 5000)] }), ticketTypes: [types[0]] }), /^ORG_ESTADO:mudanca:preco$/);
  check("6. tipo arquivado agora: nada mudou (tudo desfeito)",
    (await one("select count(*)::int as n from public.ticket_types where event_id = $1 and kind = 'meia' and archived_at is null", [ev6])).n === 1);
  const violations = (sessions) => scalar("select public.organizer_change_violations($1, 'Show Seis', 'Espaço Teste', $2::jsonb) as v",
    [ev6, JSON.stringify(sessions)]);
  check("6. violações: id de sessão fora do formato UUID é ignorado",
    JSON.stringify(await violations([session({ id: "abc", starts_at: days(8), capacity: 1 })])) === "[]");
  check("6. violações: mesma sessão com id certo acusa horário e lotação",
    JSON.stringify(await violations([session({ id: s6, starts_at: days(8), capacity: 1 })])) === '["horario","lotacao"]');
  await rejects("6. com venda, cota de meia nova: ORG_ESTADO:mudanca:lotacao",
    () => saveAs(orgA.id, ev6, base6({ meia_quota: 10 })), /^ORG_ESTADO:mudanca:lotacao$/);
  await rejects("6. várias mudanças juntas", () => saveAs(orgA.id, ev6, base6({ capacity: 20 }, { name: "X", venue: "Y" })),
    /^ORG_ESTADO:mudanca:local,lotacao,nome$/);
  await rejects("6. data malformada: SESSAO_INVALIDA:1",
    () => saveAs(orgA.id, ev6, base6({ starts_at: "xx" })), /^SESSAO_INVALIDA:1/);
  const auditBefore = (await one("select count(*)::int as n from public.audit_log where event_id = $1 and action = 'evento_alterado_pos_aprovacao'", [ev6])).n;
  await saveAs(orgA.id, ev6, {
    name: "Show Seis", description: "Descrição nova",
    sessions: [session({ id: s6, capacity: 40 }), session({ starts_at: days(9) })],
  });
  check("6. descrição, lotação maior e sessão nova aceitas",
    (await eventRow(ev6)).description === "Descrição nova" && (await sessionsOf(ev6)).length === 2);
  const alt = await one(
    "select details from public.audit_log where event_id = $1 and action = 'evento_alterado_pos_aprovacao' order by created_at desc limit 1", [ev6]);
  check("6. histórico evento_alterado_pos_aprovacao com os campos",
    auditBefore === 0 && JSON.stringify(alt?.details) === '{"campos":["descricao","sessoes"]}', JSON.stringify(alt?.details));
  const ss6 = await sessionsOf(ev6);
  await rejects("6. B tenta salvar o evento de A: SESSAO_EQUIPE",
    () => saveAs(orgB.id, ev6, { name: "Show Seis", sessions: ss6.map((s) => session({ id: s.id, starts_at: s.starts_at.toISOString(), capacity: s.capacity })) }),
    /^SESSAO_EQUIPE/);
  await rejects("6. dono chama save_event_sessions direto: SESSAO_EQUIPE",
    () => svc("select public.save_event_sessions($1, $2::jsonb, $3)", [ev6, JSON.stringify([session({ id: s6 })]), orgA.id]), /^SESSAO_EQUIPE/);
  await rejects("6. equipe + evento inexistente: SESSAO_EVENTO",
    () => saveAs(sec.id, randomUUID(), { name: "X", sessions: [session()] }), /^SESSAO_EVENTO/);
  await rejects("6. estranho: SESSAO_EQUIPE",
    () => saveAs(randomUUID(), ev6, { name: "X", sessions: [session()] }), /^SESSAO_EQUIPE/);
  await rejects("6. sessão: estranho → SESSAO_EQUIPE", () => svc("select public.set_session_sales_open($1, true, $2)", [s6, randomUUID()]), /^SESSAO_EQUIPE/);
  await rejects("6. sessão: equipe + valor nulo → SESSAO_INVALIDA", () => svc("select public.set_session_sales_open($1, null, $2)", [s6, sec.id]), /^SESSAO_INVALIDA/);
  await rejects("6. sessão: equipe + inexistente → SESSAO_INDISPONIVEL", () => svc("select public.set_session_sales_open($1, true, $2)", [randomUUID(), sec.id]), /^SESSAO_INDISPONIVEL/);
  await rejects("6. sessão: B no evento de A → SESSAO_EQUIPE", () => svc("select public.set_session_sales_open($1, false, $2)", [s6, orgB.id]), /^SESSAO_EQUIPE/);
  check("6. dono pausa sessão aprovada", (await scalar("select public.set_session_sales_open($1, false, $2) as v", [s6, orgA.id])) === false);
  check("6. dono reabre sessão aprovada", (await scalar("select public.set_session_sales_open($1, true, $2) as v", [s6, orgA.id])) === true);
  check("6. equipe ainda muda o nome com venda", (await saveAs(admin.id, ev6, {
    name: "Show Seis Equipe", description: "Descrição nova",
    sessions: ss6.map((s) => session({ id: s.id, starts_at: s.starts_at.toISOString(), capacity: s.capacity })),
  })).length === 1 && (await eventRow(ev6)).name === "Show Seis Equipe");

  // Aprovar reconfere o envio (sessão que já passou, capa tirada).
  const ev6b = await createOrgEvent(orgA, "show-seis-b", "Show Seis B", { cover: COVER });
  await submit(orgA, ev6b);
  await q("alter table public.events disable trigger events_guard_organizer");
  await q("update public.event_sessions set starts_at = now() - interval '1 day' where event_id = $1", [ev6b]);
  await rejects("6. aprovar com sessão passada: ORG_ESTADO:sem_sessao_futura", () => decide(admin, ev6b, "aprovar"), /^ORG_ESTADO:sem_sessao_futura$/);
  await q("update public.event_sessions set starts_at = $2 where event_id = $1", [ev6b, days(9)]);
  await q("update public.events set cover_image_url = null where id = $1", [ev6b]);
  await rejects("6. aprovar sem capa: ORG_ESTADO:capa", () => decide(admin, ev6b, "aprovar"), /^ORG_ESTADO:capa$/);
  await q("alter table public.events enable trigger events_guard_organizer");
  const ev6c = await createOrgEvent(orgA, "show-seis-c", "Show Seis C", { cover: COVER });
  await submit(orgA, ev6c);
  await q(`update public.session_ticket_types stt set on_sale = false
           from public.event_sessions s where s.id = stt.session_id and s.event_id = $1`, [ev6c]);
  await rejects("6. aprovar sem tipo à venda: ORG_ESTADO:sem_preco", () => decide(admin, ev6c, "aprovar"), /^ORG_ESTADO:sem_preco$/);
  await decide(admin, ev6b, "recusar", false, "Falta a capa do show");
  const ev6bRow = await eventRow(ev6b);
  check("6. recusa com nota: recusado e fechado", ev6bRow.approval_status === "recusado" && ev6bRow.sales_open === false
    && ev6bRow.approval_note === "Falta a capa do show");

  // ======================= 7) OPERAÇÕES =======================
  const evB = await approvedEvent(orgB, "show-b", "Show B");
  const paidB = await addOrder(evB);
  const paid7 = await addOrder(ev6, { tickets: 2, sessionId: s6 });
  const courtesy7 = await addOrder(ev6, { kind: "cortesia", sessionId: s6 });
  const checked7 = await addOrder(ev6, { ticketStatus: "check_in", sessionId: s6 });
  const pending7 = await addOrder(ev6, { status: "pendente", ticketStatus: "nao_pago", expires: new Date(Date.now() + 600000).toISOString(), sessionId: s6 });
  const refundReq = (org, orderId, reason = "Cliente desistiu") => scalar(
    "select public.request_order_refund($1, $2, $3) as v", [org.id, orderId, reason]);

  const buyers = await svc("select * from public.organizer_event_orders($1, $2)", [orgA.id, ev6]);
  check("7. lista de compradores: colunas exatas, sem telefone/token/código/pagamento",
    JSON.stringify(Object.keys(buyers[0]).sort()) === JSON.stringify([
      "buyer_email", "buyer_name", "created_at", "is_courtesy", "items", "order_id", "refund_request_reason", "refund_request_status",
      "session_id", "session_name", "session_starts_at", "status", "tickets_checked_in", "tickets_subtotal_cents", "tickets_total",
    ].sort()), JSON.stringify(Object.keys(buyers[0])));
  check("7. lista de compradores: sem pendente", !buyers.some((r) => r.order_id === pending7) && buyers.some((r) => r.order_id === paid7));
  check("7. lista de compradores: cortesia, contagens e itens",
    buyers.find((r) => r.order_id === courtesy7)?.is_courtesy === true
      && buyers.find((r) => r.order_id === checked7)?.tickets_checked_in === 1
      && buyers.find((r) => r.order_id === paid7)?.tickets_total === 2
      && buyers.find((r) => r.order_id === paid7)?.items?.[0]?.quantity === 2);
  await rejects("7. B lê compradores de A: ORG_DONO", () => svc("select * from public.organizer_event_orders($1, $2)", [orgB.id, ev6]), /^ORG_DONO/);
  check("7. equipe lê compradores", (await svc("select * from public.organizer_event_orders($1, $2)", [sec.id, ev6])).length === buyers.length);
  check("7. sessão de outro evento: vazio", (await svc("select * from public.organizer_event_orders($1, $2, $3)", [orgA.id, ev6, await sessionOf(evB)])).length === 0);

  await rejects("7. B pede estorno de pedido de A: ORG_DONO", () => refundReq(orgB, paid7), /^ORG_DONO/);
  await rejects("7. A pede estorno de pedido de B: ORG_DONO", () => refundReq(orgA, paidB), /^ORG_DONO/);
  await rejects("7. estorno de cortesia: ORG_ESTADO:cortesia", () => refundReq(orgA, courtesy7), /^ORG_ESTADO:cortesia$/);
  await rejects("7. estorno com check-in: ORG_ESTADO:check_in", () => refundReq(orgA, checked7), /^ORG_ESTADO:check_in$/);
  await rejects("7. estorno de pendente: ORG_ESTADO:nao_pago", () => refundReq(orgA, pending7), /^ORG_ESTADO:nao_pago$/);
  await rejects("7. motivo curto: ORG_DADOS", () => refundReq(orgA, paid7, " abc "), /^ORG_DADOS/);
  const refund7 = await refundReq(orgA, paid7);
  check("7. pedido de estorno criado", typeof refund7 === "string");
  await rejects("7. estorno duas vezes: ORG_ESTADO:ja_pedido", () => refundReq(orgA, paid7), /^ORG_ESTADO:ja_pedido$/);
  const withReq = (await svc("select * from public.organizer_event_orders($1, $2)", [orgA.id, ev6])).find((r) => r.order_id === paid7);
  check("7. lista mostra o pedido de estorno", withReq.refund_request_status === "pendente" && withReq.refund_request_reason === "Cliente desistiu");
  await svc("update public.orders set status = 'estornado' where id = $1", [paid7]);
  const closed7 = await one("select status, decided_at from public.organizer_ops_requests where id = $1", [refund7]);
  check("7. pedido vira estornado: pedido de estorno atendido", closed7.status === "atendido" && closed7.decided_at !== null);
  const sys7 = await one("select actor_kind, actor_user_id from public.audit_log where action = 'pedido_atendido' and order_id = $1", [paid7]);
  check("7. histórico do sistema", sys7?.actor_kind === "sistema" && sys7.actor_user_id === null);
  check("7. pedido estornado continua na lista de compradores",
    (await svc("select * from public.organizer_event_orders($1, $2)", [orgA.id, ev6])).find((r) => r.order_id === paid7)?.status === "estornado");

  const change = (org, eventId, what = "Trocar o horário", reason = "Artista atrasou") => scalar(
    "select public.request_event_change($1, $2, $3, $4) as v", [org.id, eventId, what, reason]);
  await rejects("7. mudança em rascunho: ORG_ESTADO:nao_aprovado", () => change(orgA, draftA), /^ORG_ESTADO:nao_aprovado$/);
  await rejects("7. B pede mudança no evento de A: ORG_DONO", () => change(orgB, ev6), /^ORG_DONO/);
  const change1 = await change(orgA, ev6);
  const change2 = await change(orgA, ev6, "Trocar o preço", "Custos subiram");
  await rejects("7. secretaria recusa mudança: ORG_ACESSO", () => svc("select public.decline_ops_request($1, $2, 'Não dá agora')", [sec.id, change1]), /^ORG_ACESSO/);
  await rejects("7. recusa sem nota: ORG_DADOS", () => svc("select public.decline_ops_request($1, $2, 'x')", [admin.id, change1]), /^ORG_DADOS/);
  await svc("select public.decline_ops_request($1, $2, 'Não dá agora')", [admin.id, change1]);
  await rejects("7. recusar de novo: ORG_ESTADO:estado", () => svc("select public.decline_ops_request($1, $2, 'Não dá agora')", [admin.id, change1]), /^ORG_ESTADO:estado$/);
  await rejects("7. concluir mudança já recusada: ORG_ESTADO:estado", () => svc("select public.finish_event_change($1, $2)", [admin.id, change1]), /^ORG_ESTADO:estado$/);
  await rejects("7. secretaria conclui mudança: ORG_ACESSO", () => svc("select public.finish_event_change($1, $2)", [sec.id, change2]), /^ORG_ACESSO/);
  await svc("select public.finish_event_change($1, $2)", [admin.id, change2]);
  check("7. Admin conclui mudança", (await one("select status from public.organizer_ops_requests where id = $1", [change2])).status === "atendido");
  const paid7b = await addOrder(ev6, { sessionId: s6 });
  const refund7b = await refundReq(orgA, paid7b);
  await svc("select public.decline_ops_request($1, $2, 'Fora do prazo')", [sec.id, refund7b]);
  check("7. secretaria recusa estorno", (await one("select status from public.organizer_ops_requests where id = $1", [refund7b])).status === "recusado");
  const change3 = await change(orgA, ev6, "Trocar a capa", "Nova arte do show");
  await rejects("7. B cancela pedido de A: ORG_DONO", () => svc("select public.cancel_ops_request($1, $2)", [orgB.id, change3]), /^ORG_DONO/);
  check("7. A cancela o próprio pedido", (await scalar("select public.cancel_ops_request($1, $2) as v", [orgA.id, change3])) === true);
  check("7. cancelar de novo: falso", (await scalar("select public.cancel_ops_request($1, $2) as v", [orgA.id, change3])) === false);

  const change4 = await change(orgA, ev6, "Trocar o local", "Lugar maior");
  const paid7c = await addOrder(ev6, { sessionId: s6 });
  await refundReq(orgA, paid7c);
  const adminList = await svc("select * from public.list_ops_requests($1, 'pendente')", [admin.id]);
  const secList = await svc("select * from public.list_ops_requests($1, 'pendente')", [sec.id]);
  check("7. fila: Admin vê mudança e estorno", adminList.some((r) => r.id === change4) && adminList.some((r) => r.kind === "estorno"));
  check("7. fila: secretaria só estorno", secList.length >= 1 && secList.every((r) => r.kind === "estorno"));
  await rejects("7. fila: organizador → ORG_ACESSO", () => svc("select * from public.list_ops_requests($1, 'pendente')", [orgA.id]), /^ORG_ACESSO/);
  const countsAdmin = (await svc("select * from public.team_pending_counts($1)", [admin.id]))[0];
  const countsSec = (await svc("select * from public.team_pending_counts($1)", [sec.id]))[0];
  check("7. números do Admin", countsAdmin.changes === 1 && countsAdmin.refunds === 1, JSON.stringify(countsAdmin));
  check("7. números da secretaria: só estornos", countsSec.refunds === 1 && countsSec.changes === 0 && countsSec.approvals === 0
    && countsSec.deletions === 0 && countsSec.signup_requests === 0, JSON.stringify(countsSec));
  await rejects("7. números: organizador → ORG_ACESSO", () => svc("select * from public.team_pending_counts($1)", [orgA.id]), /^ORG_ACESSO/);
  check("7. dono vê os pedidos do evento", (await svc("select * from public.organizer_event_requests($1, $2)", [orgA.id, ev6])).length >= 6);
  await rejects("7. equipe não usa organizer_event_requests: ORG_DONO",
    () => svc("select * from public.organizer_event_requests($1, $2)", [admin.id, ev6]), /^ORG_DONO/);
  const hist = await svc("select * from public.organizer_event_history($1, $2)", [orgA.id, ev6]);
  check("7. histórico do evento sem quem fez nem detalhes",
    hist.some((h) => h.action === "evento_aprovado" && h.actor_kind === "admin")
      && JSON.stringify(Object.keys(hist[0]).sort()) === JSON.stringify(["action", "actor_kind", "created_at"]));
  const histTeam = await svc("select * from public.organizer_event_history($1, $2)", [sec.id, ev6]);
  check("7. equipe (secretaria) lê o histórico do evento", histTeam.length === hist.length && histTeam.length > 0);
  await rejects("7. B não vê histórico de A: ORG_DONO", () => svc("select * from public.organizer_event_history($1, $2)", [orgB.id, ev6]), /^ORG_DONO/);

  check("7. dono pausa o evento", (await scalar("select public.set_event_sales_open($1, $2, false) as v", [orgA.id, ev6])) === false);
  check("7. dono reabre o evento", (await scalar("select public.set_event_sales_open($1, $2, true) as v", [orgA.id, ev6])) === true);
  await rejects("7. rascunho não abre: ORG_ESTADO:nao_aprovado", () => svc("select public.set_event_sales_open($1, $2, true)", [orgA.id, draftA]), /^ORG_ESTADO:nao_aprovado$/);
  await rejects("7. B não mexe nas vendas de A: ORG_DONO", () => svc("select public.set_event_sales_open($1, $2, false)", [orgB.id, ev6]), /^ORG_DONO/);

  // Limite de pedidos por hora (conta nova, sem pedidos antes).
  const evD = await approvedEvent(orgD, "show-d", "Show D");
  let limitAt = null;
  for (let i = 1; i <= 31; i += 1) {
    try {
      await change(orgD, evD, `Mudança ${i}`, "Pedido repetido");
    } catch (error) {
      limitAt = /^ORG_LIMITE/.test(error.message) ? i : `erro ${error.message}`;
      break;
    }
  }
  check("7. 31º pedido na mesma hora: ORG_LIMITE", limitAt === 31, String(limitAt));
  await rejects("7. limite vale também para pedido de estorno", async () => refundReq(orgD, await addOrder(evD)), /^ORG_LIMITE/);
  const orgE = await newOrganizer("estornos@exemplo.com", "Produtora E");
  const evE = await approvedEvent(orgE, "show-e", "Show E");
  let refundLimitAt = null;
  for (let i = 1; i <= 31; i += 1) {
    const orderE = await addOrder(evE);
    try {
      await refundReq(orgE, orderE);
    } catch (error) {
      refundLimitAt = /^ORG_LIMITE/.test(error.message) ? i : `erro ${error.message}`;
      break;
    }
  }
  check("7. 31º pedido de estorno na mesma hora: ORG_LIMITE", refundLimitAt === 31, String(refundLimitAt));

  // Excluir e pedir exclusão.
  await rejects("7. A exclui evento com venda: ORG_ESTADO:com_vendas",
    () => svc("select public.delete_own_event($1, $2, 'Show Seis Equipe')", [orgA.id, ev6]), /^ORG_ESTADO:com_vendas$/);
  await rejects("7. nome errado: ORG_DADOS", () => svc("select public.delete_own_event($1, $2, 'Outro')", [orgA.id, draftA]), /^ORG_DADOS/);
  await rejects("7. B exclui rascunho de A: ORG_DONO", () => svc("select public.delete_own_event($1, $2, 'Rascunho A')", [orgB.id, draftA]), /^ORG_DONO/);
  const draftDel = await createOrgEvent(orgA, "rascunho-apagar", "Rascunho Apagar");
  check("7. A exclui rascunho sem pedidos: apagado",
    (await scalar("select public.delete_own_event($1, $2, '  rascunho apagar ') as v", [orgA.id, draftDel])) === "apagado");
  check("7. rascunho sumiu e o histórico ficou", (await q("select id from public.events where id = $1", [draftDel])).length === 0
    && (await one("select details from public.audit_log where event_id = $1 and action = 'evento_excluido'", [draftDel]))?.details?.modo === "apagado");
  const evExp = await approvedEvent(orgA, "show-expirado", "Show Expirado");
  await addOrder(evExp, { status: "expirado", ticketStatus: "cancelado" });
  await rejects("7. pedir exclusão sem vendas: ORG_ESTADO:sem_vendas",
    () => svc("select public.request_event_deletion($1, $2, 'Não vai mais rolar')", [orgA.id, evExp]), /^ORG_ESTADO:sem_vendas$/);
  check("7. só pedido expirado: excluido", (await scalar("select public.delete_own_event($1, $2, 'Show Expirado') as v", [orgA.id, evExp])) === "excluido");
  check("7. dono perde acesso ao excluído", (await scalar("select public.actor_event_access($1, $2) as v", [orgA.id, evExp])) === null
    && (await countAs(orgA, "events", evExp)) === 0 && (await anon("select id from public.events where id = $1", [evExp])).length === 0);
  const evRes = await approvedEvent(orgA, "show-reserva", "Show Reserva");
  const res = await addOrder(evRes, { status: "pendente", ticketStatus: "nao_pago", expires: new Date(Date.now() + 600000).toISOString() });
  const delRes = await scalar("select public.request_event_deletion($1, $2, 'Não vai mais rolar') as v", [orgA.id, evRes]);
  await rejects("7. reserva ativa conta como venda", () => svc("select public.delete_own_event($1, $2, 'Show Reserva')", [orgA.id, evRes]), /^ORG_ESTADO:com_vendas$/);
  await q("update public.orders set expires_at = now() - interval '1 minute' where id = $1", [res]);
  check("7. reserva vencida: excluido e pedido de exclusão cancelado",
    (await scalar("select public.delete_own_event($1, $2, 'Show Reserva') as v", [orgA.id, evRes])) === "excluido"
      && (await one("select status from public.organizer_ops_requests where id = $1", [delRes])).status === "cancelado");

  await rejects("7. pedido de exclusão com motivo curto: ORG_DADOS",
    () => svc("select public.request_event_deletion($1, $2, 'x')", [orgA.id, ev6]), /^ORG_DADOS/);
  const del7 = await scalar("select public.request_event_deletion($1, $2, 'Não vai mais rolar') as v", [orgA.id, ev6]);
  check("7. A pede exclusão: vendas fechadas", (await eventRow(ev6)).sales_open === false);
  await rejects("7. pedir exclusão duas vezes: ORG_ESTADO:ja_pedido",
    () => svc("select public.request_event_deletion($1, $2, 'Não vai mais rolar')", [orgA.id, ev6]), /^ORG_ESTADO:ja_pedido$/);
  await rejects("7. reabrir evento com exclusão pendente: ORG_ESTADO:exclusao_pendente",
    () => svc("select public.set_event_sales_open($1, $2, true)", [orgA.id, ev6]), /^ORG_ESTADO:exclusao_pendente$/);
  await rejects("7. reabrir sessão com exclusão pendente: ORG_ESTADO:exclusao_pendente",
    () => svc("select public.set_session_sales_open($1, true, $2)", [s6, orgA.id]), /^ORG_ESTADO:exclusao_pendente$/);
  check("7. pausar sessão com exclusão pendente funciona", (await scalar("select public.set_session_sales_open($1, false, $2) as v", [s6, orgA.id])) === false);
  check("7. números: 1 exclusão", (await svc("select * from public.team_pending_counts($1)", [admin.id]))[0].deletions === 1);
  await rejects("7. secretaria conclui exclusão: ORG_ACESSO", () => svc("select public.finish_event_deletion($1, $2)", [sec.id, del7]), /^ORG_ACESSO/);
  await rejects("7. Admin conclui com sessão ativa: ORG_ESTADO:sessoes_ativas",
    () => svc("select public.finish_event_deletion($1, $2)", [admin.id, del7]), /^ORG_ESTADO:sessoes_ativas$/);
  await q(`update public.event_sessions set status = 'cancelada', cancelled_at = now(), cancelled_by = $2, cancelled_by_name = 'Admin',
           cancel_reason = 'Show cancelado', sales_open = false where event_id = $1`, [ev6, admin.id]);
  const changeLeft = await change(orgA, ev6, "Trocar o local", "Lugar maior");
  await svc("select public.finish_event_deletion($1, $2)", [admin.id, del7]);
  const ev6Del = await eventRow(ev6);
  check("7. Admin conclui exclusão: excluído pelo Admin, pedido atendido",
    ev6Del.deleted_at !== null && ev6Del.deleted_by === admin.id && ev6Del.sales_open === false
      && (await one("select status from public.organizer_ops_requests where id = $1", [del7])).status === "atendido");
  const leftStatus = (await q("select status from public.organizer_ops_requests where id = any($1::uuid[])", [[changeLeft, change4]])).map((r) => r.status);
  check("7. conclusão cancela os outros pendentes", leftStatus.length === 2 && leftStatus.every((s) => s === "cancelado"), JSON.stringify(leftStatus));
  check("7. fila atendida mantém a exclusão", (await svc("select * from public.list_ops_requests($1, 'atendido', $2)", [admin.id, ev6])).some((r) => r.id === del7));
  // Pendentes que sobram num evento já excluído (a conclusão cancela os dela; estes entram
  // direto pelo dono do banco) não aparecem na fila nem nos números.
  const countsBeforeOrphans = (await svc("select * from public.team_pending_counts($1)", [admin.id]))[0];
  const secCountsBeforeOrphans = (await svc("select * from public.team_pending_counts($1)", [sec.id]))[0];
  const orphanOrder = await addOrder(ev6, { sessionId: s6 });
  const orphans = (await q(
    `insert into public.organizer_ops_requests (kind, event_id, order_id, reason, requested_by)
     values ('estorno', $1, $2, 'Pedido que sobrou', $3), ('mudanca', $1, null, 'Pedido que sobrou', $3),
            ('exclusao', $1, null, 'Pedido que sobrou', $3)
     returning id`, [ev6, orphanOrder, orgA.id])).map((r) => r.id);
  const pendingAll = (await svc("select id from public.list_ops_requests($1, 'pendente')", [admin.id])).map((r) => r.id);
  const pendingSec = (await svc("select id from public.list_ops_requests($1, 'pendente')", [sec.id])).map((r) => r.id);
  check("7. fila pendente (Admin e secretaria) ignora pendente de evento excluído",
    orphans.length === 3 && !orphans.some((id) => pendingAll.includes(id) || pendingSec.includes(id)), JSON.stringify(pendingAll));
  check("7. fila pendente filtrada pelo evento excluído: vazia",
    (await svc("select * from public.list_ops_requests($1, 'pendente', $2)", [admin.id, ev6])).length === 0);
  const countsAfterOrphans = (await svc("select * from public.team_pending_counts($1)", [admin.id]))[0];
  const secCountsAfterOrphans = (await svc("select * from public.team_pending_counts($1)", [sec.id]))[0];
  check("7. números ignoram pendente de evento excluído (estornos, mudanças, exclusões)",
    JSON.stringify(countsAfterOrphans) === JSON.stringify(countsBeforeOrphans)
      && JSON.stringify(secCountsAfterOrphans) === JSON.stringify(secCountsBeforeOrphans),
    `${JSON.stringify(countsBeforeOrphans)} → ${JSON.stringify(countsAfterOrphans)}`);
  await rejects("7. concluir de novo: ORG_ESTADO:estado", () => svc("select public.finish_event_deletion($1, $2)", [admin.id, del7]), /^ORG_ESTADO:estado$/);
  await rejects("7. evento excluído: mudança → ORG_DONO", () => change(orgA, ev6), /^ORG_DONO/);
  await rejects("7. evento excluído: vendas → ORG_DONO", () => svc("select public.set_event_sales_open($1, $2, false)", [orgA.id, ev6]), /^ORG_DONO/);
  await rejects("7. evento excluído: excluir → ORG_DONO", () => svc("select public.delete_own_event($1, $2, 'Show Seis Equipe')", [orgA.id, ev6]), /^ORG_DONO/);

  // Corrida: actor_event_access já passou, mas o evento foi excluído antes da trava.
  const evRace = await approvedEvent(orgA, "show-corrida", "Show Corrida");
  await q("alter table public.events disable trigger events_guard_organizer");
  await q("alter function public.actor_event_access(uuid, uuid) rename to actor_event_access_orig");
  await q("create function public.actor_event_access(a uuid, b uuid) returns text language sql as $$ select 'dono'::text $$");
  await q("grant execute on function public.actor_event_access(uuid, uuid) to service_role");
  await q("update public.events set deleted_at = now() where id = $1", [evRace]);
  try {
    for (const [name, sql] of [
      ["request_event_change", "select public.request_event_change($1, $2, 'Trocar a capa', 'Nova arte')"],
      ["request_event_deletion", "select public.request_event_deletion($1, $2, 'Não vai mais rolar')"],
      ["delete_own_event", "select public.delete_own_event($1, $2, 'Show Corrida')"],
      ["set_event_sales_open", "select public.set_event_sales_open($1, $2, false)"],
    ]) {
      await rejects(`7. releitura após a trava: ${name} → ORG_DONO`, () => svc(sql, [orgA.id, evRace]), /^ORG_DONO/);
    }
  } finally {
    await q("drop function public.actor_event_access(uuid, uuid)");
    await q("alter function public.actor_event_access_orig(uuid, uuid) rename to actor_event_access");
    await q("alter table public.events enable trigger events_guard_organizer");
  }

  // ======================= 8) PORTARIA =======================
  const evC = await approvedEvent(orgA, "show-c", "Show C");
  const sessC = await sessionOf(evC);
  const codeC = await codeOf(await addOrder(evC));
  const codeB = await codeOf(await addOrder(evB));
  const codeEspaco = await codeOf(await addOrder(espaco));
  const checkIn = (eventId, sessionId, code, actor) => svc("select * from public.check_in_ticket($1, $2, $3, $4)", [eventId, sessionId, code, actor]).then((r) => r[0]);
  const okC = await checkIn(evC, sessC, codeC, orgA.id);
  check("8. A faz check-in no próprio evento: ok", okC.outcome === "ok" && okC.event_name === "Show C", JSON.stringify(okC));
  check("8. checked_in_by = A", (await one("select checked_in_by from public.tickets where code = $1", [codeC])).checked_in_by === orgA.id);
  check("8. de novo: ja_usado", (await checkIn(evC, sessC, codeC, orgA.id)).outcome === "ja_usado");
  await rejects("8. A no evento do Espaço: CHECKIN_EQUIPE", async () => checkIn(espaco, await sessionOf(espaco), codeEspaco, orgA.id), /^CHECKIN_EQUIPE/);
  const wrongA = await checkIn(evC, sessC, codeB, orgA.id);
  check("8. A lê ingresso de outro evento: evento_errado sem nome", wrongA.outcome === "evento_errado" && wrongA.other_event_name === null, JSON.stringify(wrongA));
  const wrongEsp = await checkIn(evC, sessC, codeEspaco, orgA.id);
  check("8. A lê ingresso do Espaço: evento_errado sem nome", wrongEsp.outcome === "evento_errado" && wrongEsp.other_event_name === null);
  const wrongTeam = await checkIn(evC, sessC, codeB, sec.id);
  check("8. equipe na mesma situação: nome do outro evento", wrongTeam.outcome === "evento_errado" && wrongTeam.other_event_name === "Show B");
  check("8. ingresso de B não foi usado", (await one("select status from public.tickets where code = $1", [codeB])).status === "pago");
  await rejects("8. B no evento de A: CHECKIN_EQUIPE", () => checkIn(evC, sessC, codeC, orgB.id), /^CHECKIN_EQUIPE/);
  await rejects("8. estranho: CHECKIN_EQUIPE", () => checkIn(evC, sessC, codeC, randomUUID()), /^CHECKIN_EQUIPE/);
  await rejects("8. suspenso: CHECKIN_EQUIPE", () => checkIn(evC, sessC, codeC, orgS.id), /^CHECKIN_EQUIPE/);
  await rejects("8. equipe + evento inexistente: CHECKIN_DADOS", () => checkIn(randomUUID(), sessC, codeC, sec.id), /^CHECKIN_DADOS/);
  await rejects("8. A + sessão de outro evento: CHECKIN_DADOS", async () => checkIn(evC, await sessionOf(evB), codeC, orgA.id), /^CHECKIN_DADOS/);
  check("8. equipe faz check-in no evento do organizador", (await checkIn(evB, await sessionOf(evB), codeB, sec.id)).outcome === "ok");
  check("8. assinatura de 3 parâmetros não existe",
    (await one("select to_regprocedure('public.check_in_ticket(uuid,text,uuid)') is null as v")).v === true
      && (await one("select count(*)::int as n from pg_proc where proname = 'check_in_ticket'")).n === 1);

  // ======================= 9) ÁREA DESLIGADA =======================
  const hOff = newToken();
  await invite(hOff);
  await q("update public.organizer_settings set enabled = false");
  check("9. login de A: login_code_eligible falso", (await one("select public.login_code_eligible($1) as v", [orgA.id])).v === false);
  check("9. equipe continua com código", (await one("select public.login_code_eligible($1) as v", [sec.id])).v === true);
  check("9. is_organizer falso", (await asUser(orgA, "select public.is_organizer() as v"))[0].v === false);
  await rejects("9. create_organizer_event: ORG_ACESSO", () => createOrgEvent(orgA, "show-desligado", "Show Desligado"), /^ORG_ACESSO/);
  await rejects("9. submit_signup_request: ORG_DESLIGADO",
    () => svc("select public.submit_signup_request('Fulana', 'fulana@exemplo.com', 'Quero fazer um show', null, '2026-10-03')"), /^ORG_DESLIGADO/);
  check("9. Admin ainda gera convite", typeof (await invite(newToken())) === "string");
  check("9. convite não vale com a área desligada", (await checkInvite(hOff)) === "invalido"
    && (await startCode(hOff, "desligado@exemplo.com", "123456")) === "invalido");
  await rejects("9. portaria do dono: CHECKIN_EQUIPE", () => checkIn(evC, sessC, codeC, orgA.id), /^CHECKIN_EQUIPE/);
  await rejects("9. pedido de estorno: ORG_DONO", async () => refundReq(orgA, await addOrder(evC)), /^ORG_DONO/);
  check("9. evento aprovado continua público", (await anon("select id from public.events where id = $1", [evC])).length === 1);
  await q("update public.organizer_settings set enabled = true");
  check("9. religada: convite volta a valer", (await checkInvite(hOff)) === "valido");
  check("9. religada: pedido do site aceito", typeof (await scalar(
    "select public.submit_signup_request('Fulana', 'fulana@exemplo.com', 'Quero fazer um show', null, '2026-10-03') as v")) === "string");

  // ======================= 10) HISTÓRICO IMUTÁVEL =======================
  // O servidor nem tem acesso direto à tabela (permission denied); o dono do banco
  // esbarra no gatilho TAXA_IMUTAVEL.
  await rejects("10. servidor não altera o histórico", () => svc("update public.audit_log set action = 'evento_criado'"), /permission denied|TAXA_IMUTAVEL/);
  await rejects("10. servidor não apaga o histórico", () => svc("delete from public.audit_log"), /permission denied|TAXA_IMUTAVEL/);
  await rejects("10. dono do banco não altera: TAXA_IMUTAVEL", () => q("update public.audit_log set action = 'evento_criado'"), /TAXA_IMUTAVEL/);
  await rejects("10. dono do banco não apaga: TAXA_IMUTAVEL", () => q("delete from public.audit_log"), /TAXA_IMUTAVEL/);
  await rejects("10. truncate: TAXA_IMUTAVEL", () => q("truncate public.audit_log"), /TAXA_IMUTAVEL/);
  check("10. histórico sem e-mail, telefone, CPF/CNPJ", (await one(
    "select count(*)::int as n from public.audit_log where details::text ~ '@|52998224725|11222333000181|71999998888'")).n === 0);

  // ======================= 11) PERMISSÕES DAS FUNÇÕES NOVAS =======================
  const fnNames = new Set();
  for (const file of [MIGRATION_A, MIGRATION_B]) {
    for (const m of readFileSync(join(MIGRATIONS, file), "utf8").matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(/g)) {
      fnNames.add(m[1]);
    }
  }
  const forAnon = new Set(["organizer_area_enabled", "is_organizer", "owns_event", "public_event_producer", "event_is_past"]);
  const forAuth = new Set([...forAnon, "my_account_kind", "list_my_devices", "forget_my_device"]);
  const noServer = new Set(["organizer_is_active", "login_code_eligible", "staff_is_admin", "forbid_staff_and_organizer",
    "events_guard_organizer", "organizer_submission_problem", "orders_close_refund_request"]);
  const procs = await q(
    `select p.oid::regprocedure::text as sig, p.proname, p.proconfig,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('service_role', p.oid, 'execute') as svc
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`, [[...fnNames]]);
  check("11. todas as funções novas existem", new Set(procs.map((p) => p.proname)).size === fnNames.size, `${procs.length}/${fnNames.size}`);
  for (const p of procs) {
    const okAnon = p.anon === forAnon.has(p.proname);
    const okAuth = p.auth === forAuth.has(p.proname);
    const okSvc = p.svc === !noServer.has(p.proname);
    const okPath = JSON.stringify(p.proconfig) === JSON.stringify(['search_path=""']);
    check(`11. ${p.sig}: anon=${p.anon} authenticated=${p.auth} service_role=${p.svc}, search_path vazio`,
      okAnon && okAuth && okSvc && okPath, JSON.stringify(p));
  }
  for (const table of ["organizer_settings", "organizer_signup_requests", "organizer_invites", "organizer_profiles", "organizer_ops_requests", "audit_log"]) {
    const rls = await one("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`]);
    const pols = (await q("select policyname from pg_policies where schemaname = 'public' and tablename = $1", [table])).map((r) => r.policyname);
    const expected = table === "organizer_profiles" ? ["organizer_profiles_self_read"] : [];
    check(`11. ${table}: RLS ligada, políticas ${JSON.stringify(expected)}`,
      rls.relrowsecurity === true && JSON.stringify(pols) === JSON.stringify(expected), JSON.stringify(pols));
    await rejects(`11. ${table}: anônimo sem acesso`, () => anon(`select 1 from public.${table}`), /permission denied/);
  }

  await db.end();

  // ======================= 12) ENSAIO DE PRODUÇÃO (banco separado) =======================
  const ens = await openDb("byla_ensaio", false);
  const before = files.filter((f) => f !== MIGRATION_A && f !== MIGRATION_B);
  for (const file of before) await ens.query(migrationSql(file));
  for (const [email, name, role, isDev] of [["espaco@exemplo.com", "Espaço", "admin", false], ["dev@exemplo.com", "Dev", "admin", true]]) {
    const id = randomUUID();
    await ens.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await ens.query("insert into public.staff_profiles (user_id, display_name, role, is_developer) values ($1, $2, $3, $4)", [id, name, role, isDev]);
  }
  const marker = "-- >>> conteúdo das duas migrations aqui <<<";
  const ensaio = readFileSync(ENSAIO_FILE, "utf8");
  check("12. ensaio tem o lugar marcado para as migrations", ensaio.includes(marker));
  const fullScript = ensaio.replace(marker, () => `${migrationSql(MIGRATION_A)}\n${migrationSql(MIGRATION_B)}\n`);
  let ensaioMessage = "";
  try {
    await ens.query(fullScript);
  } catch (error) {
    ensaioMessage = error.message;
  }
  const tokens = ensaioMessage.replace(/^ENSAIO/, "").trim().split(/\s+/).filter(Boolean);
  const bad = tokens.filter((t) => !/^[a-z0-9_]+=ok$/.test(t));
  // Cada caso aparece em 1 ou 2 linhas `r := r || ' nome=` (ramo ok e ramo do erro);
  // "interrompido" só aparece quando algo quebra.
  const expectedNames = [...new Set([...ensaio.matchAll(/r := r \|\| ' ([a-z0-9_]+)=/g)].map((m) => m[1]))]
    .filter((n) => n !== "interrompido").sort();
  const gotNames = tokens.map((t) => t.split("=")[0]).sort();
  check("12. ensaio termina com ENSAIO e só casos ok", ensaioMessage.startsWith("ENSAIO") && bad.length === 0,
    `(problemas: ${bad.join(" ") || ensaioMessage})`);
  check(`12. ensaio devolve exatamente os ${expectedNames.length} casos do arquivo, cada um uma vez`,
    JSON.stringify(gotNames) === JSON.stringify(expectedNames), `(${tokens.length} recebidos)`);
  console.log(`     ensaio: ${tokens.length} de ${expectedNames.length} casos`);
  check("12. ensaio não imprime e-mail", !/@/.test(ensaioMessage));
  const left = (await ens.query(
    "select to_regclass('public.organizer_profiles') as t, to_regprocedure('public.check_in_ticket(uuid,text,uuid)') is not null as old_sig")).rows[0];
  check("12. nada ficou depois do ensaio (tabela nova ausente, portaria antiga intacta)", left.t === null && left.old_sig === true, JSON.stringify(left));
  check("12. nenhum usuário fictício ficou", (await ens.query("select count(*)::int as n from auth.users")).rows[0].n === 2);
  await ens.end();
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
