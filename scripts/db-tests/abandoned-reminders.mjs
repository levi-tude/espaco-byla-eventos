// Testa as migrations do lembrete num Postgres temporário, aplicando TODAS as
// migrations em ordem. Não usa banco real.
//
// Como rodar (fora do repositório, sem mudar o package.json):
//   1. numa pasta temporária: npm i embedded-postgres@17.10.0-beta.17 pg@8.23.1
//   2. nessa mesma pasta, crie extensões falsas de pg_cron e pg_net em
//      node_modules/@embedded-postgres/<plataforma>/native/share/extension
//      (o Postgres local não traz essas extensões da Supabase; ver FAKE_EXTENSIONS abaixo)
//   3. BYLA_PG_TOOLS=<pasta temporária> node scripts/db-tests/abandoned-reminders.mjs
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Conteúdo das extensões falsas (o teste confere que existem). */
export const FAKE_EXTENSIONS = {
  "pg_cron.control": "default_version = '1.0'\nrelocatable = false\nschema = pg_catalog",
  "pg_cron--1.0.sql": "create schema cron; create table cron.job (...); cron.schedule / cron.unschedule",
  "pg_net.control": "default_version = '1.0'\nrelocatable = false",
  "pg_net--1.0.sql": "create schema net; create table net.http_request_queue (...); net.http_post",
};

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
// BYLA_MIGRATIONS_DIR permite testar junto com migrations de outra branch.
const MIGRATIONS = process.env.BYLA_MIGRATIONS_DIR ?? join(ROOT, "supabase", "migrations");
const SCHEDULE_MIGRATION = "20261010110000_abandoned_reminders_schedule.sql";
const PORT = 54891;
const DATA_DIR = join(TOOLS, "data");
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

const connect = async () => {
  const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: PASSWORD, database: "byla" });
  c.on("error", () => {});
  await c.connect();
  return c;
};

try {
  const db = await connect();

  // Mínimo do ambiente Supabase que as migrations usam.
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
  check("a migration de agendamento é a última", files.at(-1) === SCHEDULE_MIGRATION, files.at(-1));
  for (const file of files.filter((f) => f !== SCHEDULE_MIGRATION)) await apply(file);
  console.log(`aplicadas ${files.length - 1} migrations (sem a de agendamento)`);

  // ---------- dados ----------
  async function newEvent({ salesOpen = true, startsInDays = 7, capacity = 100, name = "Show Teste" } = {}) {
    const { rows } = await db.query(
      `insert into public.events (slug, name, venue, starts_at, capacity, sales_open)
       values ($1, $2, 'Local Teste', now() + make_interval(days => $3), $4, $5) returning id`,
      [randomUUID(), name, startsInDays, capacity, salesOpen],
    );
    const eventId = rows[0].id;
    const { rows: types } = await db.query(
      `insert into public.ticket_types (event_id, kind, price_cents, name, preset, sort_order)
       values ($1, 'inteira', 5000, 'Inteira', 'inteira', 0) returning id`,
      [eventId],
    );
    return { eventId, typeId: types[0].id };
  }

  async function newOrder(ev, {
    email = `comprador-${randomUUID().slice(0, 8)}@example.com`,
    status = "pendente",
    createdMinAgo = 70,
    expiresMinAgo = 55,
    policy = POLICY,
    cancelReason = null,
    ticketStatus = "nao_pago",
    total = 5000,
  } = {}) {
    const decisionReason = status === "aguardando_decisao" ? "sem_vaga" : null;
    const { rows: o } = await db.query(
      `insert into public.orders (event_id, buyer_name, buyer_email, total_cents, status, public_token,
         created_at, expires_at, privacy_policy_version, privacy_accepted_at, cancel_reason, payment_provider,
         decision_reason, paid_at)
       values ($1, 'Comprador Teste', $2, $3, $4, $5,
         now() - make_interval(mins => $6), now() - make_interval(mins => $7),
         $8, case when $8::text is null then null else now() end, $9, 'mercadopago',
         $10, case when $4::public.order_status in ('pago', 'aguardando_decisao') then now() end)
       returning id, public_token`,
      [ev.eventId, email, total, status, randomUUID(), createdMinAgo, expiresMinAgo, policy, cancelReason, decisionReason],
    );
    const { rows: i } = await db.query(
      `insert into public.order_items (order_id, ticket_type_id, name, kind, unit_price_cents,
         people_per_unit, quantity, line_total_cents)
       values ($1, $2, 'Inteira', 'inteira', 5000, 1, 1, 5000) returning id`,
      [o[0].id, ev.typeId],
    );
    await db.query(
      `insert into public.tickets (order_id, event_id, ticket_type_id, order_item_id, kind, status,
         code, buyer_name, price_cents)
       values ($1, $2, $3, $4, 'inteira', $5, $6, 'Comprador Teste', 5000)`,
      [o[0].id, ev.eventId, ev.typeId, i[0].id, ticketStatus, randomUUID()],
    );
    return { id: o[0].id, publicToken: o[0].public_token, email };
  }

  async function asRole(client, role, sql, params = []) {
    await client.query("begin");
    try {
      await client.query(`set local role ${role}`);
      const result = await client.query(sql, params);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  const claim = (limit = 50, cap = 100, client = db, policy = POLICY) =>
    asRole(client, "service_role", "select * from public.claim_abandoned_order_reminders($1, $2, $3)", [limit, cap, policy])
      .then((r) => r.rows);
  const svc = (sql, params) => asRole(db, "service_role", sql, params).then((r) => r.rows[0]);
  const orderRow = async (id) =>
    (await db.query("select reminder_claimed_at, reminder_sent_at, reminder_attempts, reminder_optout_token from public.orders where id = $1", [id])).rows[0];
  // Isola cada cenário: os pedidos de antes deixam de ser candidatos.
  const resetCandidates = () => db.query(
    "update public.orders set reminder_sent_at = coalesce(reminder_sent_at, now() - interval '2 days'), reminder_claimed_at = coalesce(reminder_claimed_at, now() - interval '2 days')",
  );
  const ids = (rows) => rows.map((r) => r.order_id).sort();

  // ---------- quem recebe ----------
  const ev = await newEvent();
  const eligible = await newOrder(ev);
  const expired = await newOrder(ev, { status: "expirado" });
  const tooRecent = await newOrder(ev, { createdMinAgo: 30, expiresMinAgo: 15 });
  const tooOld = await newOrder(ev, { createdMinAgo: 25 * 60, expiresMinAgo: 25 * 60 - 15 });
  const stillHeld = await newOrder(ev, { expiresMinAgo: -5 });
  const changed = await newOrder(ev, { status: "cancelado", cancelReason: "alterado_pelo_comprador" });
  const paid = await newOrder(ev, { status: "pago", ticketStatus: "pago" });
  const decision = await newOrder(ev, { status: "aguardando_decisao" });
  const oldPolicy = await newOrder(ev, { policy: "2026-09-30" });
  const noPolicy = await newOrder(ev, { policy: null });
  const free = await newOrder(ev, { total: 0 });

  let rows = await claim();
  check("pendente vencido e expirado recebem; os demais não",
    JSON.stringify(ids(rows)) === JSON.stringify([eligible.id, expired.id].sort()),
    JSON.stringify(ids(rows)));
  const first = rows.find((r) => r.order_id === eligible.id);
  check("devolve dados do e-mail e do evento",
    first?.public_token === eligible.publicToken && first?.buyer_email === eligible.email
      && first?.event_name === "Show Teste" && first?.event_venue === "Local Teste" && Boolean(first?.event_slug),
    JSON.stringify(first));
  check("devolve os itens do pedido", JSON.stringify(first?.items) === JSON.stringify([{ name: "Inteira", quantity: 1 }]));
  check("token de descadastro aleatório de 64 hex", /^[0-9a-f]{64}$/.test(first?.optout_token ?? ""));
  const claimedRow = await orderRow(eligible.id);
  check("reivindicação marca horário e tentativa", claimedRow.reminder_claimed_at !== null && claimedRow.reminder_attempts === 1
    && claimedRow.reminder_sent_at === null);
  check("segunda execução não pega o que já está reivindicado", (await claim()).length === 0);
  for (const [name, order] of [["muito recente", tooRecent], ["mais de 24 h", tooOld], ["reserva ainda ativa", stillHeld],
    ["cancelado por Alterar seleção", changed], ["pago", paid], ["pago sem vaga", decision],
    ["política antiga", oldPolicy], ["sem aceite da política", noPolicy], ["pedido grátis", free]]) {
    check(`${name}: não reivindicado`, (await orderRow(order.id)).reminder_claimed_at === null);
  }

  // ---------- envio, falha e nova tentativa ----------
  check("marcar enviado", (await svc("select public.mark_abandoned_reminder_sent($1) as r", [eligible.id])).r === true);
  check("marcar enviado de novo não faz nada", (await svc("select public.mark_abandoned_reminder_sent($1) as r", [eligible.id])).r === false);
  check("liberar pedido já enviado não faz nada", (await svc("select public.release_abandoned_reminder($1) as r", [eligible.id])).r === false);
  check("marcar enviado sem reivindicação falha", (await svc("select public.mark_abandoned_reminder_sent($1) as r", [tooRecent.id])).r === false);

  const expiredToken = (await orderRow(expired.id)).reminder_optout_token;
  check("liberar após falha", (await svc("select public.release_abandoned_reminder($1) as r", [expired.id])).r === true);
  rows = await claim();
  check("liberado volta a ser reivindicado", JSON.stringify(ids(rows)) === JSON.stringify([expired.id]));
  check("token de descadastro não muda entre tentativas", rows[0]?.optout_token === expiredToken);
  await svc("select public.release_abandoned_reminder($1)", [expired.id]);
  await claim();
  await svc("select public.release_abandoned_reminder($1)", [expired.id]);
  check("após 3 tentativas não reivindica mais", (await claim()).length === 0
    && (await orderRow(expired.id)).reminder_attempts === 3);

  // ---------- reivindicação travada (envio que caiu no meio) ----------
  await resetCandidates();
  const stale = await newOrder(ev);
  await claim();
  check("reivindicação recente não é refeita", (await claim()).length === 0);
  await db.query("update public.orders set reminder_claimed_at = now() - interval '31 minutes' where id = $1", [stale.id]);
  rows = await claim();
  check("reivindicação com mais de 30 min é refeita", JSON.stringify(ids(rows)) === JSON.stringify([stale.id])
    && (await orderRow(stale.id)).reminder_attempts === 2);

  // ---------- 1 por e-mail e evento; compra mais nova ----------
  await resetCandidates();
  const older = await newOrder(ev, { email: "maria@example.com", createdMinAgo: 120, expiresMinAgo: 105 });
  const newer = await newOrder(ev, { email: "  MARIA@example.com ", createdMinAgo: 90, expiresMinAgo: 75 });
  rows = await claim();
  check("só o pedido mais novo do mesmo e-mail (sem diferenciar maiúsculas/espaços)",
    JSON.stringify(ids(rows)) === JSON.stringify([newer.id]), JSON.stringify(ids(rows)));
  await svc("select public.mark_abandoned_reminder_sent($1)", [newer.id]);
  const later = await newOrder(ev, { email: "maria@example.com", createdMinAgo: 65, expiresMinAgo: 50 });
  check("já houve lembrete para o e-mail neste evento: não manda outro", (await claim()).length === 0
    && (await orderRow(later.id)).reminder_claimed_at === null);
  check("pedido antigo continua sem lembrete", (await orderRow(older.id)).reminder_claimed_at === null);

  await resetCandidates();
  const abandoned = await newOrder(ev, { email: "joao@example.com", createdMinAgo: 120, expiresMinAgo: 105 });
  await newOrder(ev, { email: "joao@example.com", status: "pago", ticketStatus: "pago", createdMinAgo: 100, expiresMinAgo: 85 });
  check("comprou (pago) depois: não manda", (await claim()).length === 0
    && (await orderRow(abandoned.id)).reminder_claimed_at === null);

  await resetCandidates();
  const pendingNow = await newOrder(ev, { email: "ana@example.com", createdMinAgo: 120, expiresMinAgo: 105 });
  await newOrder(ev, { email: "ana@example.com", createdMinAgo: 5, expiresMinAgo: -10 });
  check("está comprando de novo agora (pedido mais novo pendente): não manda", (await claim()).length === 0
    && (await orderRow(pendingNow.id)).reminder_claimed_at === null);

  const otherEvent = await newEvent({ name: "Outro Show" });
  await resetCandidates();
  const sameEmailOtherEvent = await newOrder(otherEvent, { email: "maria@example.com" });
  rows = await claim();
  check("mesmo e-mail em outro evento recebe", JSON.stringify(ids(rows)) === JSON.stringify([sameEmailOtherEvent.id]));

  // ---------- evento ----------
  const soldOutEvent = await newEvent({ capacity: 1 });
  await newOrder(soldOutEvent, { status: "pago", ticketStatus: "pago", createdMinAgo: 200, expiresMinAgo: 185 });
  await resetCandidates();
  const closed = await newOrder(await newEvent({ salesOpen: false }));
  const started = await newOrder(await newEvent({ startsInDays: -1 }));
  const soldOut = await newOrder(soldOutEvent);
  check("vendas fechadas, evento começado ou esgotado: não manda", (await claim()).length === 0);
  for (const [name, order] of [["vendas fechadas", closed], ["evento começou", started], ["esgotado", soldOut]]) {
    check(`${name}: continua sem reivindicação`, (await orderRow(order.id)).reminder_claimed_at === null);
  }
  await db.query("update public.events set sales_open = true where id = (select event_id from public.orders where id = $1)", [closed.id]);
  rows = await claim();
  check("vendas reabertas dentro da janela: manda", JSON.stringify(ids(rows)) === JSON.stringify([closed.id]));

  // ---------- descadastro ----------
  await resetCandidates();
  const optToken = (await orderRow(sameEmailOtherEvent.id)).reminder_optout_token;
  check("token inexistente: recusado", (await svc("select public.register_reminder_optout($1) as r", ["a".repeat(64)])).r === false);
  check("token mal formado: recusado", (await svc("select public.register_reminder_optout($1) as r", ["x' or 1=1 --"])).r === false);
  check("token nulo: recusado", (await svc("select public.register_reminder_optout(null) as r")).r === false);
  check("descadastro com token válido", (await svc("select public.register_reminder_optout($1) as r", [optToken])).r === true);
  check("descadastro repetido continua ok", (await svc("select public.register_reminder_optout($1) as r", [optToken])).r === true);
  const hashes = (await db.query("select email_hash from public.email_reminder_optouts")).rows;
  check("guarda só o hash do e-mail", hashes.length === 1 && /^[0-9a-f]{64}$/.test(hashes[0].email_hash)
    && !JSON.stringify(hashes).includes("@"));
  const third = await newEvent({ name: "Terceiro Show" });
  const optedOut = await newOrder(third, { email: " Maria@Example.com" });
  check("e-mail descadastrado não recebe em nenhum evento", (await claim()).length === 0
    && (await orderRow(optedOut.id)).reminder_claimed_at === null);

  // ---------- teto diário e limite por execução ----------
  await resetCandidates();
  await db.query("update public.orders set reminder_claimed_at = null where reminder_sent_at is null");
  await db.query("update public.orders set reminder_claimed_at = now() - interval '2 days', reminder_sent_at = now() - interval '2 days' where reminder_sent_at is not null");
  const batch = [];
  for (let n = 0; n < 4; n += 1) batch.push(await newOrder(await newEvent()));
  rows = await claim(1, 3);
  check("limite por execução", rows.length === 1);
  rows = await claim(50, 3);
  check("teto diário conta o que já foi reivindicado", rows.length === 2, String(rows.length));
  check("teto atingido: nada mais", (await claim(50, 3)).length === 0);
  await svc("select public.release_abandoned_reminder($1)", [rows[0].order_id]);
  check("liberar devolve uma vaga do teto", (await claim(50, 3)).length === 1);

  // ---------- execuções simultâneas ----------
  await resetCandidates();
  for (let n = 0; n < 6; n += 1) await newOrder(await newEvent());
  const a = await connect();
  const b = await connect();
  const watcher = await connect();
  await a.query("begin");
  await a.query("set local role service_role");
  const firstRun = (await a.query("select * from public.claim_abandoned_order_reminders(4, 100, $1)", [POLICY])).rows;
  const secondRun = (async () => {
    await b.query("begin");
    await b.query("set local role service_role");
    const res = (await b.query("select * from public.claim_abandoned_order_reminders(4, 100, $1)", [POLICY])).rows;
    await b.query("commit");
    return res;
  })();
  let waiting = false;
  for (let i = 0; i < 50 && !waiting; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { rows: w } = await watcher.query(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%claim_abandoned_order_reminders%'",
    );
    waiting = w[0].n === 1;
  }
  check("segunda execução espera a primeira", waiting);
  await a.query("commit");
  const second = await secondRun;
  const overlap = firstRun.filter((r) => second.some((s) => s.order_id === r.order_id));
  check("execuções simultâneas não repetem pedidos", firstRun.length === 4 && second.length === 2 && overlap.length === 0,
    `${firstRun.length}/${second.length}/${overlap.length}`);
  await a.end(); await b.end(); await watcher.end();

  // ---------- entradas inválidas ----------
  await rejects("limite 0 recusado", () => claim(0, 10), /LEMBRETE_LIMITE_INVALIDO/);
  await rejects("limite acima de 50 recusado", () => claim(51, 10), /LEMBRETE_LIMITE_INVALIDO/);
  await rejects("teto 0 recusado", () => claim(5, 0), /LEMBRETE_TETO_INVALIDO/);
  await rejects("versão da política inválida", () => claim(5, 10, db, "x"), /LEMBRETE_POLITICA_INVALIDA/);

  // ---------- permissões ----------
  const fns = [
    "public.reminder_email_hash(text)",
    "public.claim_abandoned_order_reminders(integer, integer, text)",
    "public.mark_abandoned_reminder_sent(uuid)",
    "public.release_abandoned_reminder(uuid)",
    "public.register_reminder_optout(text)",
  ];
  for (const fn of fns) {
    const { rows: p } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role', $1, 'execute') as svc,
              (select prosecdef from pg_proc where oid = $1::regprocedure) as definer,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`, [fn]);
    check(`${fn}: só service_role executa, invoker, search_path vazio`,
      !p[0].anon && !p[0].auth && p[0].svc && !p[0].definer
        && JSON.stringify(p[0].config) === JSON.stringify(['search_path=""']), JSON.stringify(p[0]));
  }
  await rejects("anon não chama o claim", () => asRole(db, "anon", "select * from public.claim_abandoned_order_reminders(1, 1, '2026-10-03')"), /permission denied/);
  await rejects("authenticated não descadastra direto", () => asRole(db, "authenticated", "select public.register_reminder_optout($1)", [optToken]), /permission denied/);
  await rejects("anon não lê descadastros", () => asRole(db, "anon", "select * from public.email_reminder_optouts"), /permission denied/);
  await rejects("authenticated não grava descadastros", () => asRole(db, "authenticated", "insert into public.email_reminder_optouts (email_hash) values ($1)", ["b".repeat(64)]), /permission denied/);
  const { rows: rls } = await db.query("select relrowsecurity from pg_class where oid = 'public.email_reminder_optouts'::regclass");
  check("RLS ligada em email_reminder_optouts", rls[0].relrowsecurity === true);
  const { rows: pol } = await db.query("select count(*)::int as n from pg_policies where tablename = 'email_reminder_optouts'");
  check("sem políticas (só service_role)", pol[0].n === 0);

  // ---------- agendamento (extensões falsas de pg_cron/pg_net) ----------
  await apply(SCHEDULE_MIGRATION);
  console.log("aplicada a migration de agendamento");
  const { rows: exts } = await db.query(
    "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pg_cron', 'pg_net') order by 1");
  check("pg_cron em pg_catalog e pg_net em extensions",
    JSON.stringify(exts) === JSON.stringify([{ extname: "pg_cron", nspname: "pg_catalog" }, { extname: "pg_net", nspname: "extensions" }]),
    JSON.stringify(exts));
  check("migration não agenda nenhum job", (await db.query("select count(*)::int as n from cron.job")).rows[0].n === 0);
  await apply(SCHEDULE_MIGRATION);
  check("migration de agendamento pode ser reaplicada", true);

  const queue = async () => (await db.query("select url, headers, timeout_milliseconds from net.http_request_queue order by id")).rows;
  const invoke = async () => (await db.query("select public.invoke_abandoned_reminders() as r")).rows[0].r;
  check("sem segredo no Vault: não chama o site", (await invoke()) === null && (await queue()).length === 0);
  await db.query("insert into vault.secrets values ('reminder_cron_secret', 'curto')");
  check("segredo curto demais: não chama o site", (await invoke()) === null && (await queue()).length === 0);
  const secret = randomUUID() + randomUUID();
  await db.query("update vault.secrets set secret = $1 where name = 'reminder_cron_secret'", [secret]);
  check("com segredo: chama o site", (await invoke()) !== null);
  let q = await queue();
  check("POST no endereço de produção com o segredo no cabeçalho",
    q.length === 1 && q[0].url === "https://espaco-byla-eventos.vercel.app/api/cron/abandoned-reminders"
      && q[0].headers.Authorization === `Bearer ${secret}` && q[0].timeout_milliseconds === 30000, JSON.stringify(q[0]?.url));
  await db.query("insert into vault.secrets values ('reminder_cron_url', 'https://ingressos.exemplo.com.br/api/cron/abandoned-reminders')");
  await invoke();
  q = await queue();
  check("endereço trocado pelo Vault", q.at(-1).url === "https://ingressos.exemplo.com.br/api/cron/abandoned-reminders");
  await db.query("update vault.secrets set secret = 'http://inseguro.exemplo/api/cron/abandoned-reminders' where name = 'reminder_cron_url'");
  check("endereço sem https: não chama", (await invoke()) === null);
  await db.query("update vault.secrets set secret = 'https://exemplo.com/outra-rota' where name = 'reminder_cron_url'");
  check("endereço de outra rota: não chama", (await invoke()) === null);
  await db.query("delete from vault.secrets where name = 'reminder_cron_url'");

  const { rows: inv } = await db.query(
    `select has_function_privilege('anon', 'public.invoke_abandoned_reminders()', 'execute') as anon,
            has_function_privilege('authenticated', 'public.invoke_abandoned_reminders()', 'execute') as auth,
            has_function_privilege('service_role', 'public.invoke_abandoned_reminders()', 'execute') as svc`);
  check("invoke: nem anon, nem authenticated, nem service_role executam", !inv[0].anon && !inv[0].auth && !inv[0].svc, JSON.stringify(inv[0]));
  await rejects("service_role não dispara o job", () => asRole(db, "service_role", "select public.invoke_abandoned_reminders()"), /permission denied/);

  // Os mesmos comandos do guia de ativação.
  const doc = readFileSync(join(ROOT, "docs", "superpowers", "plans", "2026-10-03-lembrete-ativacao.md"), "utf8");
  const scheduleSql = doc.match(/```sql\r?\n(select cron\.schedule\([\s\S]*?\);)\r?\n```/)?.[1];
  const unscheduleSql = doc.match(/```sql\r?\n(select cron\.unschedule\([\s\S]*?\);)\r?\n```/)?.[1];
  check("guia tem os comandos de ligar e desligar", Boolean(scheduleSql && unscheduleSql));
  await db.query(scheduleSql);
  const { rows: jobs } = await db.query("select jobname, schedule, command from cron.job");
  check("ligar: job a cada 15 min chamando a função", jobs.length === 1 && jobs[0].jobname === "abandoned-reminders"
    && jobs[0].schedule === "*/15 * * * *" && jobs[0].command.includes("public.invoke_abandoned_reminders()"), JSON.stringify(jobs));
  await db.query(jobs[0].command);
  check("o comando do job roda", (await queue()).length === q.length + 1);
  await db.query(unscheduleSql);
  check("desligar: job removido", (await db.query("select count(*)::int as n from cron.job")).rows[0].n === 0);

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTUDO OK" : `\nFALHAS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
