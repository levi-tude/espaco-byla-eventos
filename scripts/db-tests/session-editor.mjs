// Testa a migration do editor de sessões (fase 3 da spec 2026-10-03-sessoes-design)
// num Postgres temporário, aplicando TODAS as migrations em ordem. Não usa banco real.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg instalados> node scripts/db-tests/session-editor.mjs

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
const EDITOR_MIGRATION = "20261011120000_session_editor.sql";
const PORT = 54893;
const DATA_DIR = join(TOOLS, "data-editor-sessoes");
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
  const editorIdx = files.indexOf(EDITOR_MIGRATION);
  check("migration do editor depois da portaria por sessão",
    editorIdx > 0 && files[editorIdx - 1] === "20261011110000_check_in_sessions.sql", files.slice(-3).join(","));
  for (const file of files) await db.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  console.log(`aplicadas ${files.length} migrations`);

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

  const staffId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [staffId]);
  await db.query("insert into public.staff_profiles (user_id, display_name) values ($1, 'Equipe Teste')", [staffId]);
  const outsiderId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [outsiderId]);

  // Tipos na ordem da tela: 0 inteira, 1 meia, 2 casadinha, 3 VIP.
  const types = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
    { preset: "casadinha", price_cents: 9000, max_units: null },
    { id: null, name: "VIP", people_per_unit: 1, price_cents: 12000, max_units: null },
  ];
  const days = (n, h = 19, m = 0) => {
    const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    d.setUTCHours(h + 3, m, 0, 0);
    return d.toISOString();
  };
  const price = (type_index, price_cents, extra = {}) => ({ type_index, price_cents, max_units: null, on_sale: true, ...extra });
  const session = (overrides = {}) => ({
    id: null, name: null, starts_at: days(7), ends_at: null, capacity: 10, inteira_quota: null, meia_quota: null,
    prices: [price(0, 5000), price(1, 2500), price(2, 9000), price(3, 12000)],
    ...overrides,
  });

  async function createEvent(name = "Evento Editor") {
    const { rows } = await db.query(
      `insert into public.events (slug, name, venue, starts_at, capacity, sales_open)
       values ($1, $2, 'Local Teste', now() + interval '7 days', 10, true) returning id`,
      [randomUUID(), name],
    );
    return rows[0].id;
  }
  const save = (eventId, sessions, { staff = staffId, name = "Evento Editor", typeList = types } = {}) =>
    svc("select public.save_event_with_sessions($1, $2, 'Local Teste', 'Descrição', null, $3::jsonb, $4::jsonb, $5)",
      [eventId, name, JSON.stringify(typeList), JSON.stringify(sessions), staff]);
  const sessionsOf = async (eventId) => (await db.query(
    "select * from public.event_sessions where event_id = $1 and archived_at is null order by starts_at", [eventId])).rows;
  const typeIds = async (eventId) => Object.fromEntries((await db.query(
    "select id, coalesce(preset, lower(name)) as key from public.ticket_types where event_id = $1 and archived_at is null",
    [eventId])).rows.map((r) => [r.key, r.id]));
  const checkout = async (eventId, sessionId, typeId, qty = 1) => (await asRole("service_role",
    `select * from public.create_checkout_order(
       p_event_id => $1, p_buyer_name => 'Comprador Teste', p_buyer_email => 'comprador@example.com',
       p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
       p_items => $3::jsonb, p_privacy_policy_version => $4, p_session_id => $5)`,
    [eventId, randomUUID(), JSON.stringify([{ ticket_type_id: typeId, qty }]), POLICY, sessionId])).rows[0];
  const pay = (orderId) => one("select public.mark_order_paid_by_external('mercadopago', $1) as r", [orderId]).then((r) => r.r);
  const withIds = (rows, list) => list.map((item, i) => ({ ...item, id: rows[i]?.id ?? null }));

  // ---------- 1) criar evento com 2 sessões ----------
  const ev = await createEvent();
  const autoSession = (await sessionsOf(ev))[0];
  check("insert direto (código anterior) ainda ganha a sessão única", Boolean(autoSession));
  const first = session({ name: "Matinê", starts_at: days(7, 16), ends_at: days(7, 18), capacity: 8, meia_quota: 2,
    prices: [price(0, 4000), price(1, 2000), price(2, 7000, { max_units: 1 }), price(3, null, { on_sale: false })] });
  const second = session({ starts_at: days(7, 20, 30) });
  await save(ev, [first, second]);
  let rows = await sessionsOf(ev);
  check("2 sessões gravadas e a sessão automática apagada",
    rows.length === 2 && !rows.some((r) => r.id === autoSession.id), JSON.stringify(rows.map((r) => r.id)));
  check("nome, término, lotação e cota da sessão", rows[0].name === "Matinê" && rows[0].ends_at !== null
    && rows[0].capacity === 8 && rows[0].meia_quota === 2 && rows[1].name === null);
  const evRow = (await db.query("select * from public.events where id = $1", [ev])).rows[0];
  check("resumo do evento = primeira sessão", new Date(evRow.starts_at).getTime() === new Date(rows[0].starts_at).getTime()
    && evRow.capacity === 8 && evRow.meia_quota === 2);
  const t = await typeIds(ev);
  const pricesOf = async (sessionId) => Object.fromEntries((await db.query(
    "select ticket_type_id, price_cents, max_units, on_sale from public.session_ticket_types where session_id = $1",
    [sessionId])).rows.map((r) => [r.ticket_type_id, r]));
  const p1 = await pricesOf(rows[0].id);
  check("preços por sessão; tipo fora da venda sem preço não ganha linha",
    p1[t.inteira].price_cents === 4000 && p1[t.casadinha].max_units === 1 && !p1[t.vip], JSON.stringify(p1));
  const vipRow = (await db.query("select price_cents, max_units from public.ticket_types where id = $1", [t.vip])).rows[0];
  check("tipo continua com o preço-espelho (código anterior)", vipRow.price_cents === 12000 && vipRow.max_units === null);

  const [s1, s2] = rows;
  const o1 = await checkout(ev, s1.id, t.inteira, 2);
  const o2 = await checkout(ev, s2.id, t.inteira, 1);
  check("checkout usa o preço da sessão", o1.total_cents === 8000 && o2.total_cents === 5000);
  await rejects("tipo fora da venda na sessão: recusa no checkout", () => checkout(ev, s1.id, t.vip, 1), /TIPO_INDISPONIVEL/);
  await pay(o1.order_id);

  // ---------- 2) recusas ----------
  const edit = (a, b) => [{ ...first, ...a, id: s1.id }, { ...second, ...b, id: s2.id }];
  await rejects("lotação abaixo do ocupado", () => save(ev, edit({ capacity: 1, meia_quota: null }, {})), /SESSAO_LOTACAO_MENOR:1:2/);
  await rejects("cota abaixo do ocupado", () => save(ev, edit({ inteira_quota: 1 }, {})), /SESSAO_COTA_MENOR:1:inteira:2/);
  const casadinhas = await checkout(ev, s2.id, t.casadinha, 2);
  await rejects("limite abaixo do ocupado (2 Casadinhas reservadas)", () => save(ev, edit({}, {
    prices: [price(0, 5000), price(1, 2500), price(2, 9000, { max_units: 1 }), price(3, 12000)],
  })), /SESSAO_LIMITE_MENOR:2:2:Casadinha/);
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1", [casadinhas.order_id]);
  await rejects("tipo à venda sem preço", () => save(ev, edit({ prices: [price(0, null)] }, {})), /SESSAO_PRECO:1/);
  await rejects("sessão sem tipo à venda", () => save(ev, edit({}, { prices: [price(0, 5000, { on_sale: false })] })), /SESSAO_SEM_TIPO:2/);
  await rejects("horário repetido", () => save(ev, edit({}, { starts_at: first.starts_at })), /SESSAO_HORARIO_REPETIDO:2/);
  await rejects("mais de 20 sessões", () => save(ev, Array.from({ length: 21 }, (_, i) => session({ starts_at: days(10 + i) }))), /SESSAO_QUANTIDADE/);
  await rejects("lista vazia", () => save(ev, []), /SESSAO_QUANTIDADE/);
  await rejects("quem não é da equipe", () => save(ev, edit({}, {}), { staff: outsiderId }), /SESSAO_EQUIPE/);
  await rejects("data inválida", () => save(ev, edit({}, { starts_at: "amanhã" })), /SESSAO_INVALIDA:2/);
  await rejects("término antes do início", () => save(ev, edit({}, { ends_at: days(7, 10) })), /SESSAO_INVALIDA:2/);
  await rejects("cota maior que a lotação", () => save(ev, edit({}, { inteira_quota: 8, meia_quota: 8 })), /SESSAO_COTA_INVALIDA:2/);
  await rejects("tipo de outra posição inexistente", () => save(ev, edit({}, { prices: [price(9, 5000)] })), /SESSAO_INVALIDA:2/);
  await rejects("sessão de outro evento", async () => {
    const other = await createEvent("Outro");
    const otherSession = (await sessionsOf(other))[0];
    await save(ev, [{ ...first, id: otherSession.id }, { ...second, id: s2.id }]);
  }, /SESSAO_DESATUALIZADA/);
  await rejects("remover sessão com venda paga", () => save(ev, [{ ...second, id: s2.id }]), new RegExp(`SESSAO_COM_VENDAS:${s1.id}`));
  const nameAfter = (await db.query("select name from public.events where id = $1", [ev])).rows[0].name;
  await rejects("falha não grava nada (nome do evento)", () => save(ev, edit({ capacity: 1, meia_quota: null }, {}), { name: "Nome Novo" }), /SESSAO_LOTACAO_MENOR/);
  check("evento continua com o nome anterior", (await db.query("select name from public.events where id = $1", [ev])).rows[0].name === nameAfter);

  // ---------- 3) trocar horários, mudança de horário com venda ----------
  await save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }, { ...second, id: s2.id, starts_at: first.starts_at }]);
  rows = await sessionsOf(ev);
  check("troca de horário entre sessões", rows[0].id === s2.id && rows[1].id === s1.id);
  const changes = (await db.query("select * from public.session_schedule_changes order by created_at")).rows;
  check("mudança de horário só registrada para sessão com pedido pago",
    changes.length === 1 && changes[0].session_id === s1.id && changes[0].paid_orders >= 1
      && new Date(changes[0].previous_starts_at).getTime() === new Date(first.starts_at).getTime()
      && changes[0].changed_by === staffId, JSON.stringify(changes.map((c) => c.session_id)));
  await save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }, { ...second, id: s2.id, starts_at: first.starts_at }]);
  check("salvar sem mudar o horário não registra de novo",
    (await db.query("select count(*)::int as n from public.session_schedule_changes")).rows[0].n === 1);

  // ---------- 4) remover: apagar × arquivar ----------
  const third = session({ starts_at: days(9) });
  const fourth = session({ starts_at: days(10) });
  await save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }, { ...second, id: s2.id, starts_at: first.starts_at }, third, fourth]);
  rows = await sessionsOf(ev);
  const s3 = rows.find((r) => new Date(r.starts_at).getTime() === new Date(third.starts_at).getTime());
  const s4 = rows.find((r) => new Date(r.starts_at).getTime() === new Date(fourth.starts_at).getTime());
  check("+ sessões adicionadas", rows.length === 4 && s3 && s4);
  const expired = await checkout(ev, s3.id, t.inteira, 1);
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1", [expired.order_id]);
  await db.query("update public.tickets set status = 'cancelado' where order_id = $1", [expired.order_id]);
  const pendingO2 = await one("select status, expires_at > now() as live from public.orders where id = $1", [o2.order_id]);
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1 and status = 'pendente'", [o2.order_id]);
  check("pedido pendente de teste vencido", pendingO2.status === "pendente");
  await save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }, { ...second, id: s2.id, starts_at: first.starts_at }]);
  const s3After = (await db.query("select archived_at, sales_open from public.event_sessions where id = $1", [s3.id])).rows[0];
  const s4After = (await db.query("select id from public.event_sessions where id = $1", [s4.id])).rows;
  check("sessão só com pedido vencido: arquivada", s3After?.archived_at !== null && s3After?.sales_open === false);
  check("sessão sem nenhum pedido: apagada", s4After.length === 0);
  const live = await checkout(ev, s2.id, t.inteira, 1);
  await rejects("sessão com reserva ativa não sai", () => save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }]),
    new RegExp(`SESSAO_COM_VENDAS:${s2.id}`));
  await db.query("update public.orders set status = 'expirado', expires_at = now() - interval '1 minute' where id = $1", [live.order_id]);

  // ---------- 5) sessão cancelada ----------
  await db.query(
    `update public.event_sessions set status = 'cancelada', cancelled_at = now(), cancelled_by = $2,
       cancelled_by_name = 'Equipe Teste', cancel_reason = 'Motivo de teste', sales_open = false where id = $1`, [s2.id, staffId]);
  await rejects("editar sessão cancelada", () => save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }, { ...second, id: s2.id }]),
    /SESSAO_CANCELADA:2/);
  await save(ev, [{ ...first, id: s1.id, starts_at: second.starts_at, ends_at: null }]);
  check("sessão cancelada omitida continua como está",
    (await db.query("select status, archived_at from public.event_sessions where id = $1", [s2.id])).rows[0].status === "cancelada");
  await rejects("horário igual ao de sessão cancelada", () => save(ev, [{ ...first, id: s1.id, starts_at: first.starts_at }]),
    /SESSAO_HORARIO_REPETIDO:1/);

  // ---------- 6) encerrar venda da sessão ----------
  const selling = async (id) => (await one("select public.session_is_selling($1) as s", [id])).s;
  check("sessão vendendo antes", (await selling(s1.id)) === true);
  const closed = await one("select public.set_session_sales_open($1, false, $2) as r", [s1.id, staffId]);
  check("encerrar vendas da sessão", closed.r === false && (await selling(s1.id)) === false);
  await rejects("checkout recusado com a sessão encerrada", () => checkout(ev, s1.id, t.inteira, 1), /SESSAO_ENCERRADA/);
  await one("select public.set_session_sales_open($1, true, $2) as r", [s1.id, staffId]);
  check("reabrir vendas da sessão", (await selling(s1.id)) === true);
  await rejects("quem não é da equipe não encerra", () => one("select public.set_session_sales_open($1, false, $2)", [s1.id, outsiderId]), /SESSAO_EQUIPE/);
  await rejects("sessão cancelada não reabre", () => one("select public.set_session_sales_open($1, true, $2)", [s2.id, staffId]), /SESSAO_INDISPONIVEL/);
  await rejects("sessão inexistente", () => one("select public.set_session_sales_open($1, true, $2)", [randomUUID(), staffId]), /SESSAO_INDISPONIVEL/);

  // ---------- 7) código anterior continua funcionando ----------
  const legacy = await createEvent("Evento Antigo");
  await svc("select public.save_event_ticket_types($1, $2::jsonb)", [legacy, JSON.stringify(types)]);
  const legacySession = (await sessionsOf(legacy))[0];
  check("formulário anterior: tipos espelhados na sessão única",
    Object.keys(await pricesOf(legacySession.id)).length === 4);
  await svc(`select public.update_event_with_capacity($1, 'Evento Antigo', now() + interval '12 days', 'L', '', 7, null, $2::jsonb, null, null)`,
    [legacy, JSON.stringify(types)]);
  check("formulário anterior: lotação espelhada na sessão única", (await sessionsOf(legacy))[0].capacity === 7);
  check("chave do editor não vaza para a transação seguinte",
    (await one("select public.session_editor_active() as a")).a === false);

  // ---------- 8) editor numa sessão única (como hoje) ----------
  await save(legacy, [session({ id: legacySession.id, starts_at: days(12), capacity: 6,
    prices: [price(0, 6000), price(1, 3000), price(2, 9000), price(3, 12000)] })], { name: "Evento Antigo" });
  const legacyAfter = await sessionsOf(legacy);
  check("sessão única editada no lugar (mesmo id)", legacyAfter.length === 1 && legacyAfter[0].id === legacySession.id
    && legacyAfter[0].capacity === 6);
  const legacyTypes = await typeIds(legacy);
  check("preço novo na sessão única", (await pricesOf(legacySession.id))[legacyTypes.inteira].price_cents === 6000);

  // ---------- 9) permissões e RLS ----------
  const fns = [
    "public.session_editor_active()",
    "public.session_has_live_orders(uuid)",
    "public.save_event_sessions(uuid, jsonb, uuid)",
    "public.save_event_with_sessions(uuid, text, text, text, text, jsonb, jsonb, uuid)",
    "public.set_session_sales_open(uuid, boolean, uuid)",
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
  for (const fn of ["public.events_create_single_session()", "public.events_sync_single_session()", "public.ticket_types_sync_single_session()"]) {
    const { rows: p } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`, [fn]);
    check(`${fn}: continua sem acesso direto`, !p[0].anon && !p[0].auth
      && JSON.stringify(p[0].config) === JSON.stringify(['search_path=""']), JSON.stringify(p[0]));
  }
  const { rows: rls } = await db.query("select relrowsecurity from pg_class where oid = 'public.session_schedule_changes'::regclass");
  check("RLS ligada em session_schedule_changes", rls[0].relrowsecurity === true);
  const { rows: pol } = await db.query("select cmd from pg_policies where tablename = 'session_schedule_changes'");
  check("session_schedule_changes: só política de leitura", pol.length === 1 && pol[0].cmd === "SELECT");
  const staffSees = (await asRole("authenticated", "select id from public.session_schedule_changes", [], staffId)).rows.length;
  const outsiderSees = (await asRole("authenticated", "select id from public.session_schedule_changes", [], outsiderId)).rows.length;
  check("só a equipe lê as mudanças de horário", staffSees === 1 && outsiderSees === 0);
  await rejects("anon não lê mudanças de horário", () => asRole("anon", "select id from public.session_schedule_changes"), /permission denied/);
  await rejects("equipe logada não grava mudanças de horário",
    () => asRole("authenticated", "delete from public.session_schedule_changes", [], staffId), /permission denied/);
  await rejects("authenticated não chama o editor",
    () => asRole("authenticated", "select public.save_event_with_sessions($1, 'x', 'x', '', null, '[]'::jsonb, '[]'::jsonb, $2)", [ev, staffId], staffId),
    /permission denied/);

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTUDO OK" : `\nFALHAS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
