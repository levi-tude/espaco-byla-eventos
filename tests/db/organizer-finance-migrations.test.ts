import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { holidaySeedSql } from "@/lib/finance/business-days";

function migration(name: string) {
  return readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function functionBodies(sql: string) {
  return [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([\s\S]*?)\$\$;/g)].map(
    (match) => ({ name: match[1], text: match[0] }),
  );
}

function actionList(sql: string, opening: RegExp) {
  const start = sql.search(opening);
  expect(start, "lista de ações não encontrada").toBeGreaterThanOrEqual(0);
  const list = sql.slice(start, sql.indexOf("))", start));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const fees = migration("20261019100000_payment_fees_calendar.sql");
const accounts = migration("20261018100000_organizer_accounts.sql");

const PHASE3_ACTIONS = [
  "tarifa_lancada", "repasse_registrado", "repasse_compensado", "repasse_ajuste",
  "devolucao_recebida", "devolucao_pendente",
  "pix_troca_pedida", "pix_troca_cancelada", "pix_troca_confirmada", "pix_troca_recusada",
];

describe("migration payment_fees_calendar", () => {
  it("cria só as tabelas order_payment_fees e business_holidays", () => {
    const tables = [...fees.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(["order_payment_fees", "business_holidays"]);
  });

  it.each(["order_payment_fees", "business_holidays"])("%s tem RLS ligada e nenhum acesso direto", (table) => {
    expect(fees).toContain(`alter table public.${table} enable row level security;`);
    expect(fees).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role;`);
    expect(fees).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
    expect(fees).not.toMatch(new RegExp(`grant [^;]* on table public\\.${table}`));
  });

  it("toda função é security definer, search_path vazio e só service_role executa", () => {
    const fns = functionBodies(fees);
    expect(fns.map((fn) => fn.name).sort()).toEqual([
      "business_calendar_last_year", "event_fee_pending_orders", "event_payout_due_date", "nth_business_day",
      "order_has_bank_fee", "orders_missing_fee", "record_event_fee_total", "record_payment_fee",
      "record_payment_fee_failure", "record_payment_fee_manual",
    ]);
    for (const fn of fns) {
      expect(fn.text, fn.name).toContain("security definer");
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(fees, fn.name).toMatch(
        new RegExp(`revoke execute on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated;`),
      );
      expect(fees, fn.name).toMatch(new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to service_role;`));
      expect(fees, fn.name).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to [^;]*(anon|authenticated)`),
      );
    }
  });

  it("tarifa: gatilho bloqueia só apagar e truncate (as funções atualizam a linha)", () => {
    expect(fees).toMatch(
      /create trigger \w+\s+before delete on public\.order_payment_fees\s+for each row execute function public\.reject_finance_record_change\(\);/,
    );
    expect(fees).toMatch(
      /create trigger \w+\s+before truncate on public\.order_payment_fees\s+for each statement execute function public\.reject_finance_record_change\(\);/,
    );
    expect(fees).not.toMatch(/before (?:insert or )?update[^;]* on public\.order_payment_fees/);
  });

  it("feriados: gatilho bloqueia alterar, apagar e truncate", () => {
    expect(fees).toMatch(
      /create trigger \w+\s+before update or delete on public\.business_holidays\s+for each row execute function public\.reject_finance_record_change\(\);/,
    );
    expect(fees).toMatch(
      /create trigger \w+\s+before truncate on public\.business_holidays\s+for each statement execute function public\.reject_finance_record_change\(\);/,
    );
  });

  it("carga de feriados é exatamente holidaySeedSql(2026, 2030), antes dos gatilhos", () => {
    const seed = holidaySeedSql(2026, 2030);
    expect(fees).toContain(seed);
    expect(fees.split("insert into public.business_holidays").length - 1).toBe(1);
    expect(fees.indexOf(seed)).toBeLessThan(fees.search(/create trigger \w+\s+before update or delete on public\.business_holidays/));
  });

  it("histórico aceita todas as ações atuais e as novas da fase 3", () => {
    expect(fees).toContain("alter table public.audit_log drop constraint audit_log_action_check;");
    const current = actionList(accounts, /action text not null check \(action in \(/);
    const next = actionList(fees, /add constraint audit_log_action_check check \(action in \(/);
    expect(current.length).toBeGreaterThan(20);
    expect(next.sort()).toEqual([...new Set([...current, ...PHASE3_ACTIONS])].sort());
  });

  it("tarifa só para pedido pago pelo banco de pagamento", () => {
    const has = functionBodies(fees).find((fn) => fn.name === "order_has_bank_fee");
    expect(has?.text).toContain("o.status in ('pago', 'estornado', 'aguardando_decisao')");
    expect(has?.text).toContain("o.payment_provider = 'mercadopago'");
    expect(has?.text).toContain("o.total_cents > 0");
  });

  it("lançamento manual exige Admin que grava e registra no histórico", () => {
    const manual = functionBodies(fees).find((fn) => fn.name === "record_payment_fee_manual");
    expect(manual?.text).toContain("public.assert_finance_admin(p_admin, true)");
    expect(manual?.text).toContain("'tarifa_lancada'");
    const pending = functionBodies(fees).find((fn) => fn.name === "event_fee_pending_orders");
    expect(pending?.text).toContain("public.assert_finance_admin(p_admin, false)");
  });

  it("tarifa automática: 'manual' antes das checagens de valor, tarifa menor que o bruto e detalhamento limitado", () => {
    const auto = functionBodies(fees).find((fn) => fn.name === "record_payment_fee")?.text ?? "";
    const manualCheck = auto.indexOf("v_current.source = 'manual'");
    expect(manualCheck).toBeGreaterThan(0);
    expect(manualCheck).toBeLessThan(auto.indexOf("TARIFA_VALOR"));
    expect(auto).toContain("p_fee_cents >= p_gross_cents");
    expect(auto).toContain("octet_length(p_breakdown::text) > 2000");
    expect(auto).toMatch(/for update/);
  });

  it.each(["record_payment_fee", "record_payment_fee_manual", "record_event_fee_total"])(
    "%s só marca a reconferência de estorno em pedido já estornado",
    (name) => {
      const fn = functionBodies(fees).find((f) => f.name === name)?.text ?? "";
      expect(fn).toMatch(/case when [^;]*= 'estornado'[^;]* then now\(\) end/);
      expect(fn).not.toMatch(/refund_checked_at = now\(\)/);
    },
  );

  it("tarifa do evento pelo extrato: Admin que grava, trava o organizador e histórico só com valores", () => {
    const total = functionBodies(fees).find((fn) => fn.name === "record_event_fee_total")?.text ?? "";
    expect(total).toContain("public.assert_finance_admin(p_admin, true)");
    expect(total).toContain("pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0))");
    expect(total).toContain("public.order_has_bank_fee(o.id)");
    expect(total).toContain("for update");
    for (const code of ["TARIFA_VALOR", "TARIFA_NOTA", "TARIFA_NADA"]) expect(total).toContain(code);
    expect(total).toContain("'tarifa_lancada'");
    expect(total).toContain("jsonb_build_object('total_fee_cents', p_total_fee_cents, 'orders', v_count)");
    expect(total).toContain("source = 'manual'");
    expect(total).toMatch(/do update set[\s\S]*?where f\.fee_cents is null;/);
  });

  it("tarifa do evento confere a lista que a tela mostrou (TARIFA_NADA antes de TARIFA_MUDOU)", () => {
    const total = functionBodies(fees).find((fn) => fn.name === "record_event_fee_total")?.text ?? "";
    expect(total).toContain(
      "p_admin uuid, p_event_id uuid, p_expected_orders integer, p_expected_pending_cents bigint, p_total_fee_cents integer, p_note text",
    );
    expect(total).toContain("v_count is distinct from p_expected_orders or v_sum is distinct from p_expected_pending_cents");
    expect(total).toContain("raise exception 'TARIFA_MUDOU:%', v_count;");
    expect(total.indexOf("TARIFA_NADA")).toBeLessThan(total.indexOf("TARIFA_MUDOU"));
    expect(total.indexOf("TARIFA_MUDOU")).toBeLessThan(total.indexOf("O total passa do valor"));
    expect(fees).toContain(
      "revoke execute on function public.record_event_fee_total(uuid, uuid, integer, bigint, integer, text) from public, anon, authenticated;",
    );
    expect(fees).toContain(
      "grant execute on function public.record_event_fee_total(uuid, uuid, integer, bigint, integer, text) to service_role;",
    );
  });

  it("lançamento manual trava o dinheiro do organizador antes de travar o pedido", () => {
    const manual = functionBodies(fees).find((fn) => fn.name === "record_payment_fee_manual")?.text ?? "";
    const lock = manual.indexOf("pg_advisory_xact_lock(hashtextextended('organizer_payout:' || v_organizer::text, 0))");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(manual.indexOf("for update"));
  });

  it("valores em centavos inteiros (sem numeric/float)", () => {
    expect(fees).not.toMatch(/\b(numeric|real|double precision|float\d?|money)\b/);
  });
});

const payouts = migration("20261019110000_organizer_payouts.sql");
const payoutFn = (name: string) => functionBodies(payouts).find((fn) => fn.name === name)?.text ?? "";
const PAYOUT_TABLES = ["organizer_payouts", "organizer_payout_items", "organizer_balance_flags"];
const PAYOUT_FUNCTIONS = [
  "mark_balance_flag_notified", "mask_pix_key", "mask_tax_document", "organizer_event_balance",
  "organizer_event_finance", "organizer_finance_daily_summary", "organizer_finance_event_ids",
  "organizer_overdue_refunds", "organizer_payout_details", "organizer_payout_preview",
  "organizer_payouts_csv", "organizer_payouts_overview", "organizer_pending_discounts",
  "organizer_pix_change_pending", "record_organizer_payout", "record_organizer_payout_adjustment",
  "record_organizer_refund_received", "refresh_organizer_balance_flags", "resolve_balance_flags",
  "submit_event_for_approval",
];
const PAYOUT_WRITERS = ["record_organizer_payout", "record_organizer_payout_adjustment", "record_organizer_refund_received"];

describe("migration organizer_payouts", () => {
  it("cria só as tabelas de repasse, itens e marcações de saldo negativo", () => {
    const tables = [...payouts.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(PAYOUT_TABLES);
  });

  it.each(PAYOUT_TABLES)("%s tem RLS ligada e nenhum acesso direto", (table) => {
    expect(payouts).toContain(`alter table public.${table} enable row level security;`);
    expect(payouts).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role;`);
    expect(payouts).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
    expect(payouts).not.toMatch(new RegExp(`grant [^;]* on table public\\.${table}`));
  });

  it.each(["organizer_payouts", "organizer_payout_items"])("%s: gatilhos bloqueiam alterar, apagar e truncate", (table) => {
    expect(payouts).toMatch(new RegExp(
      `create trigger \\w+ before update or delete on public\\.${table}\\s+for each row execute function public\\.reject_finance_record_change\\(\\);`,
    ));
    expect(payouts).toMatch(new RegExp(
      `create trigger \\w+ before truncate on public\\.${table}\\s+for each statement execute function public\\.reject_finance_record_change\\(\\);`,
    ));
  });

  it("toda função é security definer, search_path vazio e só service_role executa", () => {
    const fns = functionBodies(payouts);
    expect(fns.map((fn) => fn.name).sort()).toEqual(PAYOUT_FUNCTIONS);
    for (const fn of fns) {
      expect(fn.text, fn.name).toContain("security definer");
      expect(fn.text, fn.name).toContain("set search_path = ''");
      expect(payouts, fn.name).toMatch(
        new RegExp(`revoke execute on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated;`),
      );
      expect(payouts, fn.name).toMatch(new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to service_role;`));
      expect(payouts, fn.name).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to [^;]*(anon|authenticated)`),
      );
    }
  });

  it.each(PAYOUT_WRITERS)("%s: Admin que grava e trava o dinheiro do organizador", (name) => {
    const fn = payoutFn(name);
    expect(fn).toContain("public.assert_finance_admin(p_admin, true)");
    expect(fn).toMatch(/pg_advisory_xact_lock\(hashtextextended\('organizer_payout:' \|\| [\w.]+::text, 0\)\)/);
    expect(fn.indexOf("assert_finance_admin")).toBeLessThan(fn.indexOf("pg_advisory_xact_lock"));
  });

  it("repasse: trava antes de calcular e confere o valor que a tela mostrou", () => {
    const fn = payoutFn("record_organizer_payout");
    expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(fn.indexOf("public.organizer_payout_preview("));
    for (const code of ["ORG_PRAZO", "ORG_NOTA", "ORG_TARIFA_PENDENTE", "ORG_NADA", "ORG_MUDOU", "ORG_DATA"]) {
      expect(fn, code).toContain(code);
    }
    expect(fn).toContain("raise exception 'ORG_MUDOU:%'");
    expect(fn).toContain("public.resolve_balance_flags(");
  });

  it("repasse: deixa o ponto marcado para a Migration C (troca de PIX pendente)", () => {
    const raw = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261019110000_organizer_payouts.sql"), "utf8");
    expect(raw).toContain("-- (a Migration C recria esta função com o bloco ORG_PIX_PENDENTE aqui)");
  });

  it("leituras de dinheiro: equipe só Admin; detalhes com chave PIX só Admin que grava", () => {
    expect(payoutFn("organizer_payouts_overview")).toContain("public.assert_finance_admin(p_admin, false)");
    expect(payoutFn("organizer_payouts_csv")).toContain("public.assert_finance_admin(p_admin, false)");
    expect(payoutFn("organizer_payout_details")).toContain("public.assert_finance_admin(p_admin, true)");
    for (const name of ["organizer_payouts_overview", "organizer_payouts_csv"]) {
      expect(payoutFn(name), name).toContain("ORG_PERIODO");
    }
  });

  it.each(["organizer_payouts_overview", "organizer_payouts_csv", "organizer_finance_daily_summary"])(
    "%s nunca lê chave PIX, titular ou documento",
    (name) => {
      expect(payoutFn(name)).not.toMatch(/pix_key(?!_changed)|pix_holder|_snapshot|buyer_|email/);
    },
  );

  it("visão do evento: só máscaras da chave e do documento", () => {
    const fn = payoutFn("organizer_event_finance");
    expect(fn).toContain("public.mask_pix_key(");
    expect(fn).toContain("public.mask_tax_document(");
    expect(fn).not.toMatch(/'pix_key'|'pix_holder_document'|_snapshot|buyer_|email/);
    expect(fn).toContain("public.actor_event_access(p_actor, p_event_id) = 'dono'");
    expect(fn).toContain("public.staff_finance_role(p_actor)");
    expect(fn).toContain("ORG_ACESSO");
  });

  it("máscaras são as mesmas de list_organizers", () => {
    const list = functionBodies(accounts).find((fn) => fn.name === "list_organizers")?.text ?? "";
    const keyMask = payoutFn("mask_pix_key");
    const docMask = payoutFn("mask_tax_document");
    expect(keyMask).toContain("immutable");
    expect(docMask).toContain("immutable");
    for (const piece of [
      "'•••@' || split_part(", "'•••.' || substr(", "'••.•••.' || substr(", "'•••• ' || right(",
    ]) {
      expect(list, piece).toContain(piece);
      expect(keyMask, piece).toContain(piece);
    }
    expect(docMask).toContain("'•••.' || substr(");
    expect(docMask).toContain("'••.•••.' || substr(");
  });

  it("histórico só com valores (sem dados pessoais)", () => {
    const calls = [...payouts.matchAll(/public\.log_audit\(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      const keys = [...call.matchAll(/jsonb_build_object\(([^)]*)\)/g)]
        .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((k) => k[1]));
      for (const key of keys) expect(["amount_cents", "discount_cents", "owed_cents"], call).toContain(key);
      expect(call).not.toMatch(/pix|document|holder|email|note|reason/);
    }
  });

  it("envio para aprovação recusa com devolução atrasada logo depois de conferir o dono", () => {
    expect(payouts).toContain("drop function public.submit_event_for_approval(uuid, uuid);");
    const fn = payoutFn("submit_event_for_approval");
    const owner = fn.indexOf("ORG_DONO");
    const refund = fn.indexOf("public.organizer_overdue_refunds(p_actor) > 0");
    expect(owner).toBeGreaterThan(0);
    expect(refund).toBeGreaterThan(owner);
    expect(fn).toContain("raise exception 'ORG_DEVOLUCAO: Há devolução ao Espaço Byla em atraso.';");
    expect(refund).toBeLessThan(fn.indexOf("for update"));
    // Corpo atual inteiro preservado.
    const current = functionBodies(accounts).find((f) => f.name === "submit_event_for_approval")?.text ?? "";
    for (const piece of ["ORG_ESTADO:estado", "public.organizer_submission_problem(p_event_id)",
      "approval_status = 'em_analise'", "'evento_enviado'"]) {
      expect(current, piece).toContain(piece);
      expect(fn, piece).toContain(piece);
    }
  });

  it("resumo diário do cron: sem ator e só contagens/somas", () => {
    const fn = payoutFn("organizer_finance_daily_summary");
    expect(fn).toMatch(/organizer_finance_daily_summary\(\)\s*returns jsonb/);
    for (const key of ["late_payouts", "late_payouts_cents", "late_refunds", "fees_pending_2d", "calendar_until"]) {
      expect(fn, key).toContain(`'${key}'`);
    }
    expect(fn).toContain("public.order_has_bank_fee(");
    expect(fn).toContain("public.business_calendar_last_year()");
    expect(fn).not.toMatch(/'(event_name|name|public_name|organizer_id|event_id)'/);
  });

  it("descontos do mais antigo: marcação aberta ou hoje (não a data do evento)", () => {
    const fn = payoutFn("organizer_pending_discounts");
    expect(fn).not.toContain("event_fee_due_date");
    expect(fn).toMatch(/where f\.event_id = e\.id and f\.resolved_at is null\),\s*\(now\(\) at time zone 'America\/Sao_Paulo'\)::date\),\s*e\.id;/);
  });

  it("devolução só com tarifas conferidas e saldo negativo de agora", () => {
    const refresh = payoutFn("refresh_organizer_balance_flags");
    expect(refresh).toMatch(/where b\.balance_cents < 0 and b\.pending_fee_orders = 0\s+and not exists/);
    expect(refresh).toMatch(/set return_due_date = v_today \+ 10[\s\S]*?pending_fee_orders from public\.organizer_event_balance\(f\.event_id\) b\) = 0[\s\S]*?returning/);
    const overdue = payoutFn("organizer_overdue_refunds");
    expect(overdue).toContain("public.organizer_event_balance(f.event_id) b");
    expect(overdue).toContain("b.balance_cents < 0 and b.pending_fee_orders = 0");
    expect(payoutFn("organizer_finance_daily_summary")).toContain("public.organizer_overdue_refunds(");
  });

  it("histórico do evento: motivo para todos, quem registrou só para a equipe", () => {
    const fn = payoutFn("organizer_event_finance");
    expect(fn).toContain("'note', p.note, 'reason', p.reason)");
    expect(fn).toContain("case when v_team then jsonb_build_object('created_by_name', p.created_by_name) else '{}'::jsonb end");
  });

  it("formato dos lançamentos e marcação aberta única por evento", () => {
    expect(payouts).toContain("kind text not null check (kind in ('repasse', 'compensacao', 'ajuste', 'devolucao'))");
    expect(payouts).toContain("constraint organizer_payouts_shape_check check (");
    expect(payouts).toContain(
      "create unique index organizer_balance_flags_open on public.organizer_balance_flags (event_id) where resolved_at is null;",
    );
    expect(payouts).toMatch(/created_by uuid not null,/);
  });

  it("valores em centavos inteiros (sem numeric/float)", () => {
    expect(payouts).not.toMatch(/\b(numeric|real|double precision|float\d?|money)\b/);
  });
});
