// Testa a migration do aviso de horário, do cancelamento de sessão e do "Estornar
// todos" (fases 5 e 6 da spec 2026-10-03-sessoes-design) num Postgres temporário,
// aplicando TODAS as migrations em ordem. Não usa banco real nem o provedor de
// pagamento: o estorno no provedor é simulado com begin/complete_order_refund.
//
// Uso: BYLA_PG_TOOLS=<pasta com embedded-postgres e pg instalados> node scripts/db-tests/session-notices-cancel.mjs

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
const THIS_MIGRATION = "20261012100000_session_notices_cancel.sql";
const PORT = 54894;
const DATA_DIR = join(TOOLS, "data-avisos-cancelamento");
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
  check("migration nova é a última, depois do editor de sessões",
    files.at(-1) === THIS_MIGRATION && files.at(-2) === "20261011120000_session_editor.sql", files.slice(-3).join(","));
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
  const scalar = async (sql, params) => Object.values((await svc(sql, params))[0])[0];

  const staffId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [staffId]);
  await db.query("insert into public.staff_profiles (user_id, display_name) values ($1, 'Equipe Teste')", [staffId]);
  const outsiderId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [outsiderId]);

  const types = [
    { preset: "inteira", price_cents: 5000, max_units: null },
    { preset: "meia", price_cents: 2500, max_units: null },
  ];
  const days = (n, h = 19, m = 0) => {
    const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    d.setUTCHours(h + 3, m, 0, 0);
    return d.toISOString();
  };
  const price = (type_index, price_cents) => ({ type_index, price_cents, max_units: null, on_sale: true });
  const session = (overrides = {}) => ({
    id: null, name: null, starts_at: days(7), ends_at: null, capacity: 20, inteira_quota: null, meia_quota: null,
    prices: [price(0, 5000), price(1, 2500)],
    ...overrides,
  });
  async function createEvent(name, sessions) {
    const { rows } = await db.query(
      `insert into public.events (slug, name, venue, starts_at, capacity, sales_open)
       values ($1, $2, 'Local Teste', now() + interval '7 days', 20, true) returning id`,
      [randomUUID(), name],
    );
    const id = rows[0].id;
    await save(id, sessions, name);
    return id;
  }
  const save = (eventId, sessions, name = "Evento") =>
    svc("select public.save_event_with_sessions($1, $2, 'Local Teste', 'Descrição', null, $3::jsonb, $4::jsonb, $5)",
      [eventId, name, JSON.stringify(types), JSON.stringify(sessions), staffId]);
  const sessionsOf = async (eventId) => (await db.query(
    "select * from public.event_sessions where event_id = $1 and archived_at is null order by starts_at", [eventId])).rows;
  const inteiraOf = async (eventId) => (await db.query(
    "select id from public.ticket_types where event_id = $1 and preset = 'inteira'", [eventId])).rows[0].id;
  const checkout = async (eventId, sessionId, typeId, qty = 1, email = "comprador@example.com") => (await asRole("service_role",
    `select * from public.create_checkout_order(
       p_event_id => $1, p_buyer_name => 'Comprador Teste', p_buyer_email => $6,
       p_buyer_phone => null, p_payment_provider => 'mercadopago', p_public_token => $2,
       p_items => $3::jsonb, p_privacy_policy_version => $4, p_session_id => $5)`,
    [eventId, randomUUID(), JSON.stringify([{ ticket_type_id: typeId, qty }]), POLICY, sessionId, email])).rows[0];
  const pay = async (orderId) => (await one("select public.mark_order_paid_by_external('mercadopago', $1) as r", [orderId])).r;
  const courtesy = async (eventId, sessionId) => (await one(
    `select * from public.issue_courtesy_ticket($1, 'Convidado Teste', 'convidado@example.com', $2, $3)`,
    [eventId, randomUUID(), sessionId])).order_id;
  const summary = async (sessionId) => (await one("select public.session_ops_summary($1) as s", [sessionId])).s;
  const queueSchedule = async (sessionId, staff = staffId) =>
    (await one("select public.queue_schedule_change_notice($1, $2) as r", [sessionId, staff])).r;
  const deliveriesOf = async (noticeId) => (await db.query(
    "select * from public.session_notice_deliveries where notice_id = $1 order by created_at, id", [noticeId])).rows;
  const claim = (limit, noticeId = null, orderId = null) =>
    svc("select * from public.claim_session_notice_deliveries($1, $2, $3)", [limit, noticeId, orderId]);
  const orderRow = async (id) => (await db.query("select * from public.orders where id = $1", [id])).rows[0];
  const refundNow = async (orderId, complete = true) => {
    const r = await one("select * from public.begin_order_refund($1, $2, 'Sessão cancelada: teste')", [orderId, staffId]);
    if (complete) await one("select public.complete_order_refund($1, 'REF-TESTE') as r", [r.refund_id]);
    return r.refund_id;
  };

  // ======================= A) AVISO DE MUDANÇA DE HORÁRIO =======================
  const evA = await createEvent("Evento Horário", [session({ starts_at: days(7, 19) })]);
  const [sA] = await sessionsOf(evA);
  const inteiraA = await inteiraOf(evA);
  const a1 = await checkout(evA, sA.id, inteiraA, 2, "a1@example.com");
  const a2 = await checkout(evA, sA.id, inteiraA, 1, "a2@example.com");
  await checkout(evA, sA.id, inteiraA, 1, "pendente@example.com");
  await pay(a1.order_id);
  await pay(a2.order_id);
  const ca = await courtesy(evA, sA.id);

  await rejects("sem mudança de horário: botão recusado", () => queueSchedule(sA.id), /AVISO_SEM_ALTERACAO/);
  check("painel sem alteração pendente", (await summary(sA.id)).schedule_change === null);

  await save(evA, [session({ id: sA.id, starts_at: days(7, 20) })], "Evento Horário");
  let s = await summary(sA.id);
  check("painel mostra a alteração com 3 compradores (2 pagos + cortesia; pendente fora)",
    s.schedule_change?.recipients === 3
      && new Date(s.schedule_change.previous_starts_at).getTime() === new Date(days(7, 19)).getTime()
      && new Date(s.schedule_change.new_starts_at).getTime() === new Date(days(7, 20)).getTime(),
    JSON.stringify(s.schedule_change));

  await rejects("quem não é da equipe não avisa", () => queueSchedule(sA.id, outsiderId), /AVISO_EQUIPE/);
  const n1 = await queueSchedule(sA.id);
  check("avisar compradores: 3 entregas", n1.queued === 3 && n1.already === false);
  const n1again = await queueSchedule(sA.id);
  check("segundo clique: mesmo comunicado, nada novo",
    n1again.already === true && n1again.notice_id === n1.notice_id && (await deliveriesOf(n1.notice_id)).length === 3);
  check("painel sem alteração pendente depois do aviso", (await summary(sA.id)).schedule_change === null);
  check("auditoria do aviso", (await scalar(
    "select count(*)::int from public.session_audit_log where session_id = $1 and action = 'aviso_horario_pedido'", [sA.id])) === 1);

  // Fila: reivindicar, enviar, falhar, pausar.
  const first = await claim(2, n1.notice_id);
  check("reivindica 2 com os dados do e-mail", first.length === 2 && first[0].kind === "alteracao_horario"
    && first[0].buyer_email && first[0].public_token && first[0].event_name === "Evento Horário"
    && first[0].previous_starts_at !== null, JSON.stringify(first.map((r) => r.kind)));
  const second = await claim(5, n1.notice_id);
  check("segunda reivindicação não repete as que estão sendo enviadas", second.length === 1
    && !first.some((r) => r.delivery_id === second[0].delivery_id));
  check("marcar enviado", (await one("select public.mark_session_notice_sent($1) as r", [first[0].delivery_id])).r === true);
  check("marcar enviado de novo não faz nada", (await one("select public.mark_session_notice_sent($1) as r", [first[0].delivery_id])).r === false);
  await one("select public.release_session_notice_delivery($1, 'cota', true) as r", [first[1].delivery_id]);
  const afterQuota = (await deliveriesOf(n1.notice_id)).find((d) => d.id === first[1].delivery_id);
  check("parou pela cota: volta para a fila sem gastar tentativa", afterQuota.status === "pendente" && afterQuota.attempts === 0);
  await one("select public.pause_session_notice_emails(now() + interval '2 hours') as r");
  check("fila pausada: não reivindica nada", (await claim(5)).length === 0);
  const progress = (await one("select public.session_notice_progress($1) as p", [n1.notice_id])).p;
  check("progresso: 1 enviado, 2 pendentes, pausa informada",
    progress.total === 3 && progress.sent === 1 && progress.pending === 2 && progress.paused_until !== null, JSON.stringify(progress));
  await rejects("pausa absurda recusada", () => one("select public.pause_session_notice_emails(now() + interval '3 days')"), /AVISO_PAUSA_INVALIDA/);
  await db.query("delete from public.email_quota_pause");

  // Falha 3 vezes → falhou → "Tentar de novo".
  let target = first[1].delivery_id;
  for (let i = 0; i < 3; i += 1) {
    const got = await claim(1, n1.notice_id, (await deliveriesOf(n1.notice_id)).find((d) => d.id === target).order_id);
    if (got[0]?.delivery_id !== target) break;
    await one("select public.release_session_notice_delivery($1, 'recusado', false) as r", [target]);
  }
  check("3 falhas: entrega falhou", (await deliveriesOf(n1.notice_id)).find((d) => d.id === target).status === "falhou");
  await rejects("tentar de novo exige equipe", () => one("select public.retry_failed_session_notices($1, $2)", [n1.notice_id, outsiderId]), /AVISO_EQUIPE/);
  check("tentar de novo volta 1 entrega", (await scalar("select public.retry_failed_session_notices($1, $2)", [n1.notice_id, staffId])) === 1);

  // Comprador novo, depois da 1ª mudança, e uma 2ª mudança.
  const a4 = await checkout(evA, sA.id, inteiraA, 1, "a4@example.com");
  await pay(a4.order_id);
  await save(evA, [session({ id: sA.id, starts_at: days(7, 21) })], "Evento Horário");
  const n2 = await queueSchedule(sA.id);
  const d2 = await deliveriesOf(n2.notice_id);
  check("2ª mudança: os 3 antigos + o comprador novo, cada um com o horário que conhecia",
    n2.queued === 4 && d2.every((d) => new Date(d.previous_starts_at).getTime() === new Date(days(7, 20)).getTime()),
    JSON.stringify(d2.map((d) => d.previous_starts_at)));
  await claim(10, n1.notice_id);
  check("aviso antigo ainda pendente é pulado (o comprador recebe só o horário mais novo)",
    (await deliveriesOf(n1.notice_id)).find((d) => d.id === target).status === "pulado");
  const a5 = await checkout(evA, sA.id, inteiraA, 1, "a5@example.com");
  await pay(a5.order_id);
  await save(evA, [session({ id: sA.id, starts_at: days(7, 22) })], "Evento Horário");
  await save(evA, [session({ id: sA.id, starts_at: days(7, 21) })], "Evento Horário");
  check("horário voltou ao anterior: ninguém para avisar",
    (await summary(sA.id)).schedule_change?.recipients === 0, JSON.stringify((await summary(sA.id)).schedule_change));
  await rejects("botão recusado sem destinatários", () => queueSchedule(sA.id), /AVISO_SEM_DESTINATARIOS/);

  // Pedido estornado antes do envio: aviso de horário é pulado.
  const pendingDelivery = (await deliveriesOf(n2.notice_id)).find((d) => d.order_id === a2.order_id);
  await refundNow(a2.order_id);
  await claim(10, n2.notice_id);
  check("pedido estornado: aviso de horário pulado (não envia)",
    (await deliveriesOf(n2.notice_id)).find((d) => d.id === pendingDelivery.id).status === "pulado");
  check("estorno em sessão ativa não entra na fila de 'valor devolvido'",
    (await one("select public.queue_cancellation_refund_notice($1) as r", [a2.order_id])).r === null);

  // ======================= B) CANCELAR SESSÃO =======================
  const evB = await createEvent("Evento Cancelado", [
    session({ starts_at: days(8, 19) }), session({ starts_at: days(8, 21) }),
  ]);
  const [sB, sBother] = await sessionsOf(evB);
  const inteiraB = await inteiraOf(evB);
  const p1 = await checkout(evB, sB.id, inteiraB, 2, "p1@example.com");
  const p2 = await checkout(evB, sB.id, inteiraB, 1, "p2@example.com");
  const p3 = await checkout(evB, sB.id, inteiraB, 1, "p3@example.com");
  const other = await checkout(evB, sBother.id, inteiraB, 1, "outra@example.com");
  await pay(p1.order_id);
  await pay(p2.order_id);
  await pay(other.order_id);
  const cb = await courtesy(evB, sB.id);
  const p2code = (await db.query("select code from public.tickets where order_id = $1", [p2.order_id])).rows[0].code;
  const checkIn = async (sessionId, code) => (await one(
    "select * from public.check_in_ticket($1, $2, $3, $4)", [evB, sessionId, code, staffId])).outcome;
  check("check-in antes do cancelamento", (await checkIn(sB.id, p2code)) === "ok");

  const impact = (await summary(sB.id)).impact;
  check("impacto calculado no banco", impact.paid_orders === 2 && impact.paid_cents === 15000
    && impact.pending_orders === 1 && impact.courtesy_orders === 1 && impact.checked_in_orders === 1, JSON.stringify(impact));

  const cancel = (args) => one("select public.cancel_event_session($1, $2, $3, $4, $5) as r",
    [args.session ?? sB.id, args.staff ?? staffId, args.reason ?? "Chuva forte, espaço alagado", args.confirm ?? "cancelar", args.notify ?? true]).then((r) => r.r);
  await rejects("confirmação errada", () => cancel({ confirm: "cancela" }), /CANCELAR_CONFIRMACAO/);
  await rejects("motivo curto", () => cancel({ reason: " abc " }), /CANCELAR_MOTIVO/);
  await rejects("quem não é da equipe", () => cancel({ staff: outsiderId }), /CANCELAR_EQUIPE/);
  await rejects("sessão inexistente", () => cancel({ session: randomUUID() }), /CANCELAR_SESSAO/);
  check("recusas não mudaram a sessão", (await sessionsOf(evB))[0].status === "ativa");

  const cancelled = await cancel({});
  const sBrow = (await db.query("select * from public.event_sessions where id = $1", [sB.id])).rows[0];
  check("sessão cancelada, venda fechada, quem/quando/motivo gravados",
    sBrow.status === "cancelada" && sBrow.sales_open === false && sBrow.cancelled_by === staffId
      && sBrow.cancelled_by_name === "Equipe Teste" && sBrow.cancel_reason === "Chuva forte, espaço alagado"
      && sBrow.cancel_notice_sent_at !== null);
  check("pendente cancelado e devolvido para encerrar a cobrança",
    cancelled.pending_orders.length === 1 && cancelled.pending_orders[0].id === p3.order_id
      && (await orderRow(p3.order_id)).status === "cancelado"
      && (await orderRow(p3.order_id)).cancel_reason === "sessao_cancelada");
  check("ingressos do pendente cancelados", (await scalar(
    "select count(*)::int from public.tickets where order_id = $1 and status = 'cancelado'", [p3.order_id])) === 1);
  check("pagos e cortesia intactos (não estorna sozinho)",
    (await orderRow(p1.order_id)).status === "pago" && (await orderRow(p2.order_id)).status === "pago"
      && (await orderRow(cb)).status === "pago");
  check("outra sessão do evento intacta",
    (await orderRow(other.order_id)).status === "pago" && (await sessionsOf(evB))[1].status === "ativa");
  check("aviso de cancelamento: 3 entregas (2 pagos + cortesia)", cancelled.queued === 3 && cancelled.notice_id);
  check("auditoria do cancelamento sem dados pessoais", (await scalar(
    `select count(*)::int from public.session_audit_log
     where session_id = $1 and action in ('cancelada', 'aviso_cancelamento_pedido')
       and details::text not like '%@%'`, [sB.id])) === 2);
  const again = await cancel({ reason: "Outro motivo qualquer" });
  check("cancelar de novo não faz nada", again.already === true && again.notice_id === cancelled.notice_id
    && (await db.query("select cancel_reason from public.event_sessions where id = $1", [sB.id])).rows[0].cancel_reason === "Chuva forte, espaço alagado");

  const p1code = (await db.query("select code from public.tickets where order_id = $1 limit 1", [p1.order_id])).rows[0].code;
  check("portaria recusa ingresso de sessão cancelada", (await checkIn(sB.id, p1code)) === "sessao_cancelada");
  check("portaria recusa mesmo escolhendo outra sessão", (await checkIn(sBother.id, p1code)) === "sessao_cancelada");
  const legacyOutcome = (await one("select * from public.check_in_ticket($1, $2, $3)", [evB, p1code, staffId])).outcome;
  check("portaria antiga também recusa", legacyOutcome !== "ok", legacyOutcome);
  await rejects("checkout recusado na sessão cancelada", () => checkout(evB, sB.id, inteiraB, 1), /SESSAO_INDISPONIVEL/);
  check("pagamento atrasado do pendente vai para 'decidir', nunca vira pago",
    (await pay(p3.order_id)) === "needs_decision_session_cancelled" && (await orderRow(p3.order_id)).status === "aguardando_decisao");
  await rejects("aviso de horário em sessão cancelada", () => queueSchedule(sB.id), /AVISO_SESSAO_CANCELADA/);

  // ======================= C) "ESTORNAR TODOS" =======================
  let r = (await summary(sB.id)).refund;
  check("estornáveis: p1 + p3 (aguardando); p2 pulado por entrada",
    r.orders === 2 && r.cents === 10000 + 5000 && r.skipped_check_in === 1, JSON.stringify(r));
  const start = (args) => one("select public.start_session_refund_batch($1, $2, $3, $4) as r",
    [args.session ?? sB.id, args.staff ?? staffId, args.reason ?? "Sessão cancelada: chuva", args.total ?? 15000]).then((x) => x.r);
  await rejects("total digitado diferente do banco", () => start({ total: 14000 }), /LOTE_TOTAL_MUDOU:15000/);
  await rejects("sessão ativa não tem lote", () => start({ session: sBother.id }), /LOTE_SESSAO_ATIVA/);
  await rejects("quem não é da equipe", () => start({ staff: outsiderId }), /LOTE_EQUIPE/);
  await rejects("motivo curto", () => start({ reason: "x" }), /LOTE_MOTIVO/);
  const batch = await start({});
  const items = async () => (await db.query(
    "select i.*, o.status as order_status from public.session_refund_batch_items i join public.orders o on o.id = i.order_id where batch_id = $1 order by o.created_at",
    [batch.batch_id])).rows;
  let it = await items();
  check("lote com 2 pendentes + 1 pulado (com entrada); cortesia e outra sessão fora",
    batch.expected_count === 2 && batch.expected_total_cents === 15000 && it.length === 3
      && it.filter((i) => i.status === "pendente").length === 2
      && it.find((i) => i.order_id === p2.order_id)?.code === "com_entrada", JSON.stringify(it.map((i) => [i.status, i.code])));
  const batchAgain = await start({ total: 1 });
  check("segundo 'Estornar todos': devolve o mesmo lote", batchAgain.already === true && batchAgain.batch_id === batch.batch_id);

  const claimItem = (staff = staffId) => one("select public.claim_session_refund_item($1, $2) as r", [batch.batch_id, staff]).then((x) => x.r);
  const finish = (itemId, status, code = null) => one("select public.finish_session_refund_item($1, $2, $3) as r", [itemId, status, code]).then((x) => x.r);
  await rejects("estornar o próximo exige equipe", () => claimItem(outsiderId), /LOTE_EQUIPE/);
  const c1 = await claimItem();
  check("1º pedido entregue com o motivo do lote", c1.state === "item" && c1.order_id === p1.order_id && c1.reason === "Sessão cancelada: chuva");
  check("outra aba espera (um por vez)", (await claimItem()).state === "busy");
  await refundNow(c1.order_id);
  const f1 = await finish(c1.item_id, "estornado");
  check("estornado registra o estorno do pedido", f1.status === "estornado" && (await items())[0].refund_id !== null);
  check("finalizar de novo não faz nada", (await finish(c1.item_id, "falhou", "x")).noop === true);
  const q1 = (await one("select public.queue_cancellation_refund_notice($1) as r", [p1.order_id])).r;
  const q1again = (await one("select public.queue_cancellation_refund_notice($1) as r", [p1.order_id])).r;
  check("e-mail 'valor devolvido' na fila uma vez só", q1.queued === true && q1again.queued === false && q1again.notice_id === q1.notice_id);
  const refundMail = await claim(5, q1.notice_id);
  check("e-mail de estorno traz valor e ingressos", refundMail.length === 1 && refundMail[0].kind === "estorno_cancelamento"
    && refundMail[0].refund_amount_cents === 10000 && refundMail[0].tickets.length === 2
    && refundMail[0].reason === "Chuva forte, espaço alagado");

  // Queda no meio: item preso em "processando" volta depois de 2 min.
  const c2 = await claimItem();
  check("2º pedido (aguardando decisão)", c2.state === "item" && c2.order_id === p3.order_id);
  await db.query("update public.session_refund_batch_items set claimed_at = now() - interval '3 minutes' where id = $1", [c2.item_id]);
  const c2b = await claimItem();
  check("depois de 2 min o mesmo item volta (aba fechada)", c2b.state === "item" && c2b.item_id === c2.item_id);
  // Provedor começou o estorno mas não respondeu: estorno "solicitado" continua estornável com a mesma chave.
  const pendingRefund = await refundNow(p3.order_id, false);
  const tmp = await finish(c2.item_id, "pendente", "erro_temporario");
  check("erro temporário: volta para a fila e conta erro seguido", tmp.status === "pendente" && tmp.consecutive_errors === 1);
  const c2c = await claimItem();
  check("tentativa 3 do mesmo item", c2c.item_id === c2.item_id);
  const sameKey = await one("select * from public.begin_order_refund($1, $2, 'Sessão cancelada: teste')", [p3.order_id, staffId]);
  check("nova tentativa reusa o mesmo estorno (mesma chave no provedor)", sameKey.refund_id === pendingRefund && sameKey.already_requested === true);
  const tmp2 = await finish(c2.item_id, "pendente", "erro_temporario");
  check("3 tentativas: falhou", tmp2.status === "falhou");
  const done = await claimItem();
  check("lote termina 'com falhas'", done.state === "done" && done.status === "concluido_com_falhas");
  check("auditoria do fim do lote", (await scalar(
    "select count(*)::int from public.session_audit_log where session_id = $1 and action = 'lote_estorno_concluido'", [sB.id])) === 1);

  await rejects("tentar de novo exige equipe", () => one("select public.retry_session_refund_failures($1, $2)", [batch.batch_id, outsiderId]), /LOTE_EQUIPE/);
  check("tentar de novo os que falharam: 1", (await scalar("select public.retry_session_refund_failures($1, $2)", [batch.batch_id, staffId])) === 1);
  const c3 = await claimItem();
  check("item que falhou volta", c3.state === "item" && c3.order_id === p3.order_id);
  await one("select public.complete_order_refund($1, 'REF-TESTE-2') as r", [pendingRefund]);
  await finish(c3.item_id, "estornado");
  check("lote concluído", (await claimItem()).status === "concluido");
  it = await items();
  check("relatório final: 2 estornados, 1 pulado", it.filter((i) => i.status === "estornado").length === 2
    && it.filter((i) => i.status === "pulado").length === 1);
  await rejects("nada mais para estornar", () => start({ total: 0 }), /LOTE_VAZIO/);
  const sBsum = await summary(sB.id);
  check("painel: lote e números de estorno", sBsum.batch?.status === "concluido" && sBsum.impact.refunded_orders === 2
    && sBsum.impact.refunded_cents === 15000 && sBsum.batch.items.length === 3, JSON.stringify(sBsum.impact));
  check("estorno em lote nunca duplicou", (await scalar(
    "select count(*)::int from public.order_refunds where order_id in ($1, $2) and status in ('solicitado', 'concluido')",
    [p1.order_id, p3.order_id])) === 2);

  // Estornado um por um depois de o lote ser criado: é pulado como "já estornado".
  const evC = await createEvent("Evento Lote", [session({ starts_at: days(9) })]);
  const [sC] = await sessionsOf(evC);
  const inteiraC = await inteiraOf(evC);
  const k1 = await checkout(evC, sC.id, inteiraC, 1, "k1@example.com");
  const k2 = await checkout(evC, sC.id, inteiraC, 1, "k2@example.com");
  await pay(k1.order_id);
  await pay(k2.order_id);
  await one("select public.cancel_event_session($1, $2, 'Motivo do teste', 'CANCELAR', false) as r", [sC.id, staffId]);
  check("cancelar sem avisar: nenhum comunicado", (await scalar(
    "select count(*)::int from public.session_notices where session_id = $1", [sC.id])) === 0);
  const batchC = (await one("select public.start_session_refund_batch($1, $2, 'Sessão cancelada', 10000) as r", [sC.id, staffId])).r;
  await refundNow(k1.order_id);
  const ck = (await one("select public.claim_session_refund_item($1, $2) as r", [batchC.batch_id, staffId])).r;
  const k1item = (await db.query("select * from public.session_refund_batch_items where batch_id = $1 and order_id = $2", [batchC.batch_id, k1.order_id])).rows[0];
  check("pedido estornado um por um é pulado ('já estornado') e o lote segue",
    ck.state === "item" && ck.order_id === k2.order_id && k1item.status === "pulado" && k1item.code === "ja_estornado" && k1item.refund_id !== null);

  await rejects("pedido não muda de sessão", () => db.query("update public.orders set session_id = $1 where id = $2", [sA.id, k2.order_id]), /SESSAO_IMUTAVEL|violates/);

  // ======================= D) PERMISSÕES E RLS =======================
  const fns = [
    "public.staff_display_name(uuid)",
    "public.session_schedule_recipients(uuid)",
    "public.session_refund_candidates(uuid)",
    "public.session_notice_progress(uuid)",
    "public.session_ops_summary(uuid)",
    "public.queue_schedule_change_notice(uuid, uuid)",
    "public.cancel_event_session(uuid, uuid, text, text, boolean)",
    "public.queue_cancellation_refund_notice(uuid)",
    "public.claim_session_notice_deliveries(integer, uuid, uuid)",
    "public.mark_session_notice_sent(uuid)",
    "public.release_session_notice_delivery(uuid, text, boolean)",
    "public.pause_session_notice_emails(timestamptz)",
    "public.retry_failed_session_notices(uuid, uuid)",
    "public.start_session_refund_batch(uuid, uuid, text, bigint)",
    "public.claim_session_refund_item(uuid, uuid)",
    "public.finish_session_refund_item(uuid, text, text)",
    "public.retry_session_refund_failures(uuid, uuid)",
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
  const tables = ["session_audit_log", "session_notices", "session_notice_deliveries", "email_quota_pause",
    "session_refund_batches", "session_refund_batch_items"];
  for (const table of tables) {
    const { rows: rls } = await db.query(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
    const { rows: pol } = await db.query("select cmd from pg_policies where tablename = $1", [table]);
    check(`${table}: RLS ligada e no máximo leitura`, rls[0].relrowsecurity === true && pol.every((x) => x.cmd === "SELECT"));
    await rejects(`${table}: anon não lê`, () => asRole("anon", `select 1 from public.${table}`), /permission denied/);
    await rejects(`${table}: equipe logada não grava`,
      () => asRole("authenticated", `delete from public.${table}`, [], staffId), /permission denied/);
  }
  await rejects("email_quota_pause: equipe logada não lê", () => asRole("authenticated", "select 1 from public.email_quota_pause", [], staffId), /permission denied/);
  const staffSees = (await asRole("authenticated", "select id from public.session_notices", [], staffId)).rows.length;
  const outsiderSees = (await asRole("authenticated", "select id from public.session_notices", [], outsiderId)).rows.length;
  check("só a equipe lê os comunicados", staffSees > 0 && outsiderSees === 0);
  await rejects("auditoria não é editada nem pelo servidor",
    () => asRole("service_role", "update public.session_audit_log set reason = 'x'"), /permission denied/);
  await rejects("auditoria não é apagada nem pelo servidor",
    () => asRole("service_role", "delete from public.session_audit_log"), /permission denied/);
  await rejects("authenticated não cancela sessão",
    () => asRole("authenticated", "select public.cancel_event_session($1, $2, 'motivo longo', 'CANCELAR', true)", [sBother.id, staffId], staffId),
    /permission denied/);

  await db.end();
} finally {
  await server.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTUDO OK" : `\nFALHAS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
