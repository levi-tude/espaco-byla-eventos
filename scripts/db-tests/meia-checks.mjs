// Conferência da meia-entrada na portaria (migration 20261127180000_meia_checks.sql) num
// Postgres temporário: aplica todas as migrations em ordem e confere permissões (equipe,
// dono, outro organizador, sem código do e-mail, anon, service_role), só meia, só com
// check-in, "recusado" desfazendo a entrada, idempotência, histórico de correção, valor da
// diferença, resumo por sessão e que a migration pode rodar duas vezes. Não usa banco real.
//
// Uso (como em abandoned-reminders.mjs): numa pasta temporária, npm i embedded-postgres@17.10.0-beta.17
// pg@8.23.1, crie as extensões falsas de pg_cron e pg_net (FAKE_EXTENSIONS daquele arquivo) e rode
//   BYLA_PG_TOOLS=<pasta temporária> node scripts/db-tests/meia-checks.mjs

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
const MIGRATION = "20261127180000_meia_checks.sql";
const PORT = 54927;
const DATA_DIR = join(TOOLS, "data-meia-checks");
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

  const hasTz = (await db.query("select count(*)::int as n from pg_timezone_names where name = 'America/Sao_Paulo'")).rows[0].n > 0;
  const migrationSql = (file) => {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    return hasTz ? text : text.replaceAll("'America/Sao_Paulo'", "'UTC'");
  };
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  check("a migration da meia é a última", files.at(-1) === MIGRATION, files.at(-1));
  for (const file of files) await db.query(migrationSql(file));
  console.log(`aplicadas ${files.length} migrations`);
  await db.query(migrationSql(MIGRATION));
  check("migration roda de novo sem erro (idempotente)", true);

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
  const anon = (sql, params) => run("anon", { role: "anon" }, sql, params);
  const asUser = (user, sql, params = [], sid = user.sid) =>
    run("authenticated", { sub: user.id, session_id: sid, role: "authenticated" }, sql, params);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];

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
  const newStaff = async (email, name) => {
    const id = await newUser(email);
    await q("insert into public.staff_profiles (user_id, display_name, role) values ($1, $2, 'admin')", [id, name]);
    return { id, sid: await newSession(id, true), sidNv: await newSession(id, false) };
  };
  const newOrganizer = async (email, publicName) => {
    const id = await newUser(email);
    await q(`insert into public.organizer_profiles (user_id, full_name, public_name, phone, pix_key_type, pix_key,
      pix_holder_name, pix_holder_document, terms_version, terms_accepted_at, invite_id, status)
      values ($1, 'Fulana de Tal', $2, '71900000001', 'cpf', '52998224725', 'Fulana de Tal', '52998224725',
              '2026-10-14', now(), gen_random_uuid(), 'ativo')`, [id, publicName]);
    return { id, sid: await newSession(id, true) };
  };

  const staff = await newStaff("equipe@exemplo.com", "Ana Portaria");
  const orgA = await newOrganizer("dona@exemplo.com", "Produtora A");
  const orgB = await newOrganizer("outra@exemplo.com", "Produtora B");
  const outsider = { id: await newUser("qualquer@exemplo.com") };
  outsider.sid = await newSession(outsider.id, true);
  await q("update public.organizer_settings set enabled = true");

  const types = [
    { preset: "inteira", price_cents: 4000, max_units: null },
    { preset: "meia", price_cents: 2000, max_units: null },
  ];
  async function newEvent(name, organizerId) {
    // Evento de organizador já aprovado: só o "fluxo próprio" grava o dono (trava do banco).
    await db.query("begin");
    await db.query("set local byla.organizer_flow = 'on'");
    const { rows } = await db.query(
      `insert into public.events (slug, name, venue, starts_at, capacity, sales_open, organizer_id)
       values ($1, $2, 'Local Teste', now() + interval '1 day', 70, true, $3) returning id`,
      [randomUUID(), name, organizerId],
    );
    await db.query("commit");
    const eventId = rows[0].id;
    await svc("select public.save_event_ticket_types($1, $2::jsonb)", [eventId, JSON.stringify(types)]);
    const tt = await q("select id, preset from public.ticket_types where event_id = $1", [eventId]);
    const session = await one("select id from public.event_sessions where event_id = $1", [eventId]);
    return { eventId, sessionId: session.id, t: Object.fromEntries(tt.map((r) => [r.preset, r.id])) };
  }
  async function newTicket(ev, kind, sessionId = ev.sessionId) {
    const price = kind === "meia" ? 2000 : 4000;
    const order = await one(
      `insert into public.orders (event_id, session_id, buyer_name, buyer_email, total_cents, status, public_token, payment_provider, paid_at)
       values ($1, $2, 'Comprador Teste', 'comprador@exemplo.com', $3, 'pago', $4, 'mercadopago', now()) returning id`,
      [ev.eventId, sessionId, price, randomUUID()]);
    const item = await one(
      `insert into public.order_items (order_id, ticket_type_id, name, kind, unit_price_cents, people_per_unit, quantity, line_total_cents)
       values ($1, $2, $3, $4, $5, 1, 1, $5) returning id`,
      [order.id, ev.t[kind], kind === "meia" ? "Meia-entrada" : "Inteira", kind, price]);
    const code = randomUUID();
    const ticket = await one(
      `insert into public.tickets (order_id, event_id, session_id, ticket_type_id, order_item_id, kind, status, code, buyer_name, price_cents)
       values ($1, $2, $3, $4, $5, $6, 'pago', $7, 'Comprador Teste', $8) returning id`,
      [order.id, ev.eventId, sessionId, ev.t[kind], item.id, kind, code, price]);
    return { id: ticket.id, code, orderId: order.id };
  }
  const checkIn = (ev, code, actor = staff.id) =>
    svc("select * from public.check_in_ticket($1, $2, $3, $4)", [ev.eventId, ev.sessionId, code, actor]).then((r) => r[0]);
  const mark = (user, eventId, ticketId, result, sid) =>
    asUser(user, "select * from public.record_meia_check($1, $2, $3)", [eventId, ticketId, result], sid).then((r) => r[0]);
  const summary = (user, eventId, sessionId, sid) =>
    asUser(user, "select * from public.meia_check_summary($1, $2)", [eventId, sessionId], sid).then((r) => r[0]);
  const ticketRow = (id) => one("select status, checked_in_at, checked_in_by from public.tickets where id = $1", [id]);

  const ev = await newEvent("Cápsulas Teste", orgA.id);
  const other = await newEvent("Outro Evento", orgB.id);

  // ---------- 1) permissões ----------
  const m1 = await newTicket(ev, "meia");
  check("check-in da meia (função de sempre)", (await checkIn(ev, m1.code)).outcome === "ok");

  await rejects("anon não executa", () => anon("select * from public.record_meia_check($1, $2, 'comprovante_ok')", [ev.eventId, m1.id]), /permission denied/);
  await rejects("service_role não executa (sem service_role exposto)",
    () => svc("select * from public.record_meia_check($1, $2, 'comprovante_ok')", [ev.eventId, m1.id]), /permission denied/);
  await rejects("service_role não lê a tabela", () => svc("select * from public.meia_checks"), /permission denied/);
  await rejects("service_role não executa o resumo", () => svc("select * from public.meia_check_summary($1, null)", [ev.eventId]), /permission denied/);
  await rejects("equipe sem o código do e-mail confirmado: recusa",
    () => mark(staff, ev.eventId, m1.id, "comprovante_ok", staff.sidNv), /MEIA_ACESSO/);
  await rejects("conta que não é equipe nem organizador: recusa",
    () => mark(outsider, ev.eventId, m1.id, "comprovante_ok"), /MEIA_ACESSO/);
  let r = await mark(orgB, ev.eventId, m1.id, "comprovante_ok");
  check("organizador de outro evento: não encontrado (nada registrado)", r.outcome === "nao_encontrado");
  r = await mark(orgB, other.eventId, m1.id, "comprovante_ok");
  check("ingresso de outro evento: não encontrado", r.outcome === "nao_encontrado");
  await rejects("resultado inválido: recusa", () => mark(staff, ev.eventId, m1.id, "talvez"), /MEIA_DADOS/);
  check("nada gravado depois das recusas", (await one("select count(*)::int as n from public.meia_checks")).n === 0);
  await rejects("authenticated não grava direto na tabela",
    () => asUser(staff, "insert into public.meia_checks (ticket_id, event_id, session_id, result, actor_kind) values ($1, $2, $3, 'comprovante_ok', 'equipe')",
      [m1.id, ev.eventId, ev.sessionId]), /permission denied/);

  // ---------- 2) marcar, idempotência, correção ----------
  r = await mark(staff, ev.eventId, m1.id, "comprovante_ok");
  check("equipe marca comprovante ok", r.outcome === "ok" && r.result === "comprovante_ok" && r.checked_in === true);
  r = await mark(staff, ev.eventId, m1.id, "comprovante_ok");
  check("tocar de novo não duplica", r.outcome === "ok" && (await one("select count(*)::int as n from public.meia_checks where ticket_id = $1", [m1.id])).n === 1);
  r = await mark(orgA, ev.eventId, m1.id, "pagou_diferenca");
  check("dono do evento corrige para 'pagou a diferença' (inteira 40 − meia 20 = 20)", r.outcome === "ok" && r.diff_cents === 2000, JSON.stringify(r));
  const hist = await q("select result, actor_kind, actor_user_id from public.meia_checks where ticket_id = $1 order by created_at, id", [m1.id]);
  check("histórico guarda quem marcou (equipe e dono)",
    hist.length === 2 && hist[0].actor_kind === "equipe" && hist[0].actor_user_id === staff.id
      && hist[1].actor_kind === "dono" && hist[1].actor_user_id === orgA.id);
  check("equipe verificada lê a tabela (RLS)", (await asUser(staff, "select count(*)::int as n from public.meia_checks"))[0].n === 2);
  check("organizador não lê a tabela direto (só pelo resumo)", (await asUser(orgA, "select count(*)::int as n from public.meia_checks"))[0].n === 0);
  check("equipe sem código não lê a tabela", (await asUser(staff, "select count(*)::int as n from public.meia_checks", [], staff.sidNv))[0].n === 0);

  // ---------- 3) só meia, só com check-in ----------
  const i1 = await newTicket(ev, "inteira");
  await checkIn(ev, i1.code);
  check("ingresso inteira: nao_meia", (await mark(staff, ev.eventId, i1.id, "comprovante_ok")).outcome === "nao_meia");
  const m2 = await newTicket(ev, "meia");
  check("meia sem check-in: sem_entrada", (await mark(staff, ev.eventId, m2.id, "comprovante_ok")).outcome === "sem_entrada");

  // ---------- 4) recusado desfaz o check-in ----------
  await checkIn(ev, m2.code);
  r = await mark(staff, ev.eventId, m2.id, "recusado");
  let t = await ticketRow(m2.id);
  check("recusado: registra e desfaz a entrada", r.outcome === "ok" && r.checked_in === false
    && t.status === "pago" && t.checked_in_at === null && t.checked_in_by === null, JSON.stringify(t));
  check("recusado de novo (sem entrada): sem_entrada, mostra a última marcação",
    (await mark(staff, ev.eventId, m2.id, "recusado")).result === "recusado");
  let s = await summary(staff, ev.eventId, ev.sessionId);
  check("resumo depois da recusa", s.meias_lidas === 2 && s.comprovante_ok === 0 && s.pagou_diferenca === 1
    && Number(s.diferenca_total_cents) === 2000 && s.recusadas === 1 && s.nao_registradas === 0, JSON.stringify(s));
  check("volta com comprovante: o QR entra de novo pela função de sempre", (await checkIn(ev, m2.code)).outcome === "ok");
  s = await summary(staff, ev.eventId, ev.sessionId);
  check("lida de novo sem marcar: conta como não registrada", s.recusadas === 0 && s.nao_registradas === 1, JSON.stringify(s));
  await mark(staff, ev.eventId, m2.id, "comprovante_ok");
  const m3 = await newTicket(ev, "meia");
  await checkIn(ev, m3.code);
  s = await summary(orgA, ev.eventId, null);
  check("dono vê o resumo do evento inteiro", s.meias_lidas === 3 && s.comprovante_ok === 1 && s.pagou_diferenca === 1 && s.nao_registradas === 1, JSON.stringify(s));
  await rejects("resumo: organizador de outro evento recusa", () => summary(orgB, ev.eventId, null), /MEIA_ACESSO/);
  await rejects("resumo: sessão de outro evento recusa", () => summary(staff, ev.eventId, other.sessionId), /MEIA_DADOS/);
  await rejects("resumo: sem código do e-mail recusa", () => summary(staff, ev.eventId, null, staff.sidNv), /MEIA_ACESSO/);

  // ---------- 5) já usado continua igual ----------
  check("check-in de sempre segue recusando o ja_usado", (await checkIn(ev, m1.code)).outcome === "ja_usado");

  // ---------- 6) permissões no catálogo ----------
  const grants = await q(`select grantee, privilege_type from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name in ('record_meia_check', 'meia_check_summary') and grantee in ('anon','authenticated','service_role','PUBLIC')`);
  check("funções: só authenticated executa", grants.length === 2 && grants.every((g) => g.grantee === "authenticated"), JSON.stringify(grants));
  const definer = await q("select proname, prosecdef from pg_proc where proname in ('record_meia_check', 'meia_check_summary')");
  check("funções SECURITY DEFINER", definer.length === 2 && definer.every((p) => p.prosecdef));
  const tgrants = await q(`select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'meia_checks'`);
  check("tabela: só select para authenticated", tgrants.filter((g) => g.grantee !== "postgres").every((g) => g.grantee === "authenticated" && g.privilege_type === "SELECT")
    && tgrants.some((g) => g.grantee === "authenticated"), JSON.stringify(tgrants));

  await db.end();
} catch (error) {
  failures += 1;
  console.log(`FAIL - interrompido: ${error.message}`);
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(`\n${passes} ok, ${failures} falha(s)`);
process.exit(failures ? 1 : 0);
